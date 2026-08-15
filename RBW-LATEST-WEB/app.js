// Ranked Bedwars web app — router, API client with local caching, nav/search.
// Each route is a lazily-imported module, loaded only when visited.

(() => {
  const main = document.getElementById('main');

  // ---------------------------------------------------------------- config

  function loadConfig() {
    if (RBW_CONFIG && typeof RBW_CONFIG === 'object') {
      return RBW_CONFIG;
    }
    return { apiBase: '', apiKey: '' };
  }
  let cfg = loadConfig();

  // When served by the bot, pull the canonical config from /rbw/web/config.
  fetch('rbw/web/config')
    .then(r => (r.ok ? r.json() : null))
    .then(remote => {
      if (remote) {
        if (remote.apiBase) cfg.apiBase = remote.apiBase;
        if (!cfg.apiKey && remote.apiKeyRequired === false) cfg.apiKey = '';
        const status = document.getElementById('api-status');
        if (status) status.textContent = remote.apiKeyRequired ? 'API: key required' : 'API: public read mode';
      }
    })
    .catch(() => {});

  // ------------------------------------------------------------ api client

  const memoryCache = new Map();
  const LS_PREFIX = 'rbw-cache:';
  const LS_MAX = 80;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  function lsGet(key) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.expires < Date.now()) {
        localStorage.removeItem(LS_PREFIX + key);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, entry) {
    try {
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith(LS_PREFIX))
        .map(k => ({ k, expires: JSON.parse(localStorage.getItem(k)).expires }))
        .sort((a, b) => a.expires - b.expires);
      while (keys.length >= LS_MAX) {
        const victim = keys.shift();
        localStorage.removeItem(victim.k);
      }
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
    } catch (e) {
      // storage full or unavailable — in-memory cache still works
    }
  }

  async function apiGet(path, opts = {}) {
    const ttl = opts.ttl !== undefined ? opts.ttl : 30000;
    const url = (cfg.apiBase || '') + path;

    if (!opts.force) {
      const mem = memoryCache.get(url);
      if (mem && mem.expires > Date.now()) return mem.value;
      const ls = lsGet(url);
      if (ls) {
        memoryCache.set(url, ls);
        return ls.value;
      }
    }

    const headers = {};
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;

    let res;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      throw new ApiError('Cannot reach the Ranked Bedwars API.', 0);
    }

    if (res.status === 429) {
      throw new ApiError('Rate limited. Wait a moment and try again.', 429);
    }
    if (res.status === 401) {
      throw new ApiError('Unauthorized. The site needs an API key (see config.js) or RBW_PUBLIC_API=true on the bot.', 401);
    }
    if (!res.ok) {
      let msg = `API error (${res.status})`;
      try {
        const body = await res.json();
        if (body && body.error) msg = body.error;
      } catch (e) {}
      throw new ApiError(msg, res.status);
    }

    const value = await res.json();
    const entry = { value, expires: Date.now() + ttl };
    memoryCache.set(url, entry);
    if (ttl > 0) lsSet(url, entry);
    return value;
  }

  // ------------------------------------------------------------- rendering

  function renderError(err) {
    main.replaceChildren(UI.errorBox(err.message || 'Something went wrong.', ''));
  }

  function renderLoading() {
    main.replaceChildren(
      UI.el('div', { class: 'page-head' },
        UI.el('h1', {}, UI.skeleton('220px', '26px')),
        UI.el('div', { class: 'sub', style: 'margin-top:8px' }, UI.skeleton('140px', '14px'))
      ),
      UI.skeletonRows(4)
    );
  }

  // --------------------------------------------------------------- router

  const routes = {
    '': () => import('./routes/home.js'),
    home: () => import('./routes/home.js'),
    player: () => import('./routes/player.js'),
    game: () => import('./routes/game.js'),
    games: () => import('./routes/games.js'),
    leaderboard: () => import('./routes/leaderboard.js'),
    compare: () => import('./routes/compare.js'),
    seasons: () => import('./routes/seasons.js'),
  };

  async function navigate() {
    const hash = location.hash.slice(1) || '/';
    const [pathPart, queryPart] = hash.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    const params = new URLSearchParams(queryPart || '');
    const name = segments[0] || 'home';

    renderLoading();

    const loader = routes[name];
    if (!loader) {
      const notFound = await import('./routes/notfound.js');
      main.replaceChildren(notFound.render());
      return;
    }

    try {
      const mod = await loader();
      document.title = (mod.title ? mod.title + ' — ' : '') + 'Ranked Bedwars';
      await mod.render(main, segments, params, { apiGet, UI });
    } catch (err) {
      console.error('[rbw-web] route failed:', err);
      renderError(err);
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', navigate);
  window.addEventListener('DOMContentLoaded', navigate);

  // ---------------------------------------------------------- nav + search

  function highlightNav() {
    const seg = (location.hash.slice(1) || '/').split('?')[0].split('/')[1] || 'home';
    document.querySelectorAll('.nav-links a').forEach(a => {
      const key = a.getAttribute('data-nav');
      a.classList.toggle('active', key === seg);
    });
  }
  window.addEventListener('hashchange', highlightNav);
  window.addEventListener('DOMContentLoaded', highlightNav);

  const searchBox = document.getElementById('search');
  if (searchBox) {
    let debounceTimer = null;
    let dropdown = null;
    let querySeq = 0;

    function closeDropdown() {
      if (dropdown) { dropdown.remove(); dropdown = null; }
    }

    const input = UI.el('input', {
      class: 'search-input',
      type: 'search',
      placeholder: 'Search player…',
      autocomplete: 'off'
    });

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      closeDropdown();
      if (q.length < 2) return;

      debounceTimer = setTimeout(async () => {
        const seq = ++querySeq;
        try {
          const results = await apiGet(`/rbw/api/search/users?query=${encodeURIComponent(q)}&limit=6`, { ttl: 15000 });
          if (seq !== querySeq || input.value.trim() !== q) return;
          closeDropdown();
          if (!results.length) return;
          dropdown = UI.el('div', { class: 'search-results' },
            results.map(r => UI.el('a', { href: `#/player/${r.discordId}`, onclick: closeDropdown },
              UI.el('span', { text: r.ign }),
              UI.el('span', { class: 'muted', text: `${UI.formatNumber(r.elo)} elo` })
            ))
          );
          searchBox.append(dropdown);
        } catch (e) {
          // ignore search failures silently
        }
      }, 250);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeDropdown(); input.blur(); }
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (q.length >= 2) {
          closeDropdown();
          location.hash = `#/player/${encodeURIComponent(q)}`;
        }
      }
    });

    document.addEventListener('click', e => {
      if (!searchBox.contains(e.target)) closeDropdown();
    });

    searchBox.append(input);
  }

  window.RBW = { apiGet, UI };
})();
