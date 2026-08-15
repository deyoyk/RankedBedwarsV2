const STATS = [
  ['elo', 'Elo'], ['wins', 'Wins'], ['losses', 'Losses'], ['kills', 'Kills'],
  ['deaths', 'Deaths'], ['kdr', 'KDR'], ['wlr', 'WLR'], ['level', 'Level'],
  ['mvps', 'MVPs'], ['bedBroken', 'Beds broken'], ['finalKills', 'Final kills'],
  ['finalDeaths', 'Final deaths'], ['games', 'Games'], ['winstreak', 'Winstreak'],
  ['losestreak', 'Losestreak'], ['peakElo', 'Peak elo'], ['playtimeSeconds', 'Playtime'],
];

export const title = 'Compare';

export async function render(main, segments, params, { apiGet, UI }) {
  const head = UI.el('div', { class: 'page-head' },
    UI.el('h1', { text: 'Compare' }),
    UI.el('div', { class: 'sub' }, 'Two players, head to head.')
  );
  const inputs = UI.el('div', { class: 'grid-2', style: 'margin-bottom:20px' },
    UI.el('input', { class: 'search-input', id: 'cmp-a', placeholder: 'Player A (discord id or IGN)' }),
    UI.el('input', { class: 'search-input', id: 'cmp-b', placeholder: 'Player B (discord id or IGN)' })
  );
  const body = UI.el('div', { class: 'card' }, UI.emptyBox('Enter two players to compare.'));
  main.replaceChildren(head, inputs, body);

  async function resolve(query) {
    if (/^\d+$/.test(query)) return query;
    const user = await apiGet(`/rbw/api/user?ign=${encodeURIComponent(query)}`, { ttl: 30000 });
    return user.discordId;
  }

  async function load(a, b) {
    body.replaceChildren(UI.skeletonRows(10));
    try {
      const [idA, idB] = await Promise.all([resolve(a), resolve(b)]);
      const [o1, o2, cmp] = await Promise.all([
        apiGet(`/rbw/api/user/${idA}/overview`, { ttl: 30000 }),
        apiGet(`/rbw/api/user/${idB}/overview`, { ttl: 30000 }),
        apiGet(`/rbw/api/user/${idA}/compare/${idB}`, { ttl: 30000 }),
      ]);
      const p1 = o1.profile;
      const p2 = o2.profile;
      const comp = cmp.comparisons || {};

      const fmt = (mode, v) => UI.formatValue(mode, v);
      const rows = STATS.map(([key, label]) => {
        const v1 = p1[key];
        const v2 = p2[key];
        let winnerClass = '';
        if (key === 'losses' || key === 'deaths' || key === 'finalDeaths' || key === 'losestreak') {
          if (v1 < v2) winnerClass = 'winner-a';
          else if (v2 < v1) winnerClass = 'winner-b';
        } else {
          if (v1 > v2) winnerClass = 'winner-a';
          else if (v2 > v1) winnerClass = 'winner-b';
        }
        return UI.el('div', { class: `compare-row ${winnerClass}` },
          UI.el('span', { class: 'a num', text: fmt(key, v1) }),
          UI.el('span', { class: 'mid', text: label }),
          UI.el('span', { class: 'b num', text: fmt(key, v2) })
        );
      });

      body.replaceChildren(
        UI.el('div', { class: 'compare-row', style: 'border-bottom:1px solid var(--border);padding:14px 16px;font-weight:600' },
          UI.el('span', { text: UI.link(p1.ign, `#/player/${idA}`) }),
          UI.el('span', { class: 'mid muted', text: 'player' }),
          UI.el('span', { text: UI.link(p2.ign, `#/player/${idB}`) })
        ),
        ...rows,
        UI.el('div', { class: 'muted', style: 'padding:12px 16px;font-size:12.5px' },
          'Green side leads each stat.'
        )
      );
    } catch (e) {
      body.replaceChildren(UI.errorBox('Comparison failed.', e.message));
    }
  }

  const a = segments[1];
  const b = segments[2];
  if (a && b) {
    document.getElementById('cmp-a').value = decodeURIComponent(a);
    document.getElementById('cmp-b').value = decodeURIComponent(b);
    load(decodeURIComponent(a), decodeURIComponent(b));
  }

  inputs.querySelector('#cmp-a').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const av = document.getElementById('cmp-a').value.trim();
      const bv = document.getElementById('cmp-b').value.trim();
      if (av && bv) location.hash = `#/compare/${encodeURIComponent(av)}/${encodeURIComponent(bv)}`;
    }
  });
  inputs.querySelector('#cmp-b').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const av = document.getElementById('cmp-a').value.trim();
      const bv = document.getElementById('cmp-b').value.trim();
      if (av && bv) location.hash = `#/compare/${encodeURIComponent(av)}/${encodeURIComponent(bv)}`;
    }
  });
}
