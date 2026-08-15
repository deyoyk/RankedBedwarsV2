export const title = 'Home';

export async function render(main, segments, params, { apiGet, UI }) {
  const hero = UI.el('div', { class: 'hero' },
    UI.el('h1', { text: 'Ranked Bedwars' }),
    UI.el('p', { class: 'muted',
      text: 'ELO queues, live scoring and seasons — stats, recaps and leaderboards for every game.' }),
    UI.el('div', { class: 'search-box' },
      UI.el('input', {
        class: 'search-input', type: 'search', placeholder: 'Search a player…',
        onkeydown: (e) => {
          if (e.key === 'Enter' && e.target.value.trim().length >= 2) {
            location.hash = `#/player/${encodeURIComponent(e.target.value.trim())}`;
          }
        }
      })
    )
  );

  const statsSkeleton = UI.el('div', { class: 'stat-grid' },
    Array.from({ length: 3 }, () => UI.skeleton('100%', '52px', 'grid-column:span 1'))
  );

  const gamesSkeleton = UI.el('div', { class: 'card' }, UI.skeletonRows(6));
  const queuesSkeleton = UI.el('div', { class: 'card' }, UI.skeletonRows(4));

  const statsWrap = UI.el('div', { style: 'margin-bottom:28px' }, statsSkeleton);
  const grid = UI.el('div', { class: 'grid-2' },
    UI.el('div', {}, UI.el('div', { class: 'section-title', text: 'Recent games' }), gamesSkeleton),
    UI.el('div', {}, UI.el('div', { class: 'section-title', text: 'Live queues' }), queuesSkeleton)
  );

  main.replaceChildren(hero, statsWrap, grid);

  // --- quick stats (independent of everything else) ---
  (async () => {
    try {
      const [global, online] = await Promise.all([
        apiGet('/rbw/api/stats/global', { ttl: 15000 }),
        apiGet('/rbw/api/online-players', { ttl: 10000 })
      ]);
      const users = global && (global.totalUsers ?? global.users ?? global.count ?? 0);
      const games = global && (global.totalGames ?? global.games ?? 0);
      const cells = [
        UI.statCell('Registered players', UI.formatNumber(users ?? '—')),
        UI.statCell('Games played', UI.formatNumber(games ?? '—')),
        UI.statCell('In queue now', UI.formatNumber(online?.count ?? '—')),
      ];
      statsWrap.replaceChildren(UI.el('div', { class: 'stat-grid' }, cells));
    } catch (e) {
      statsWrap.replaceChildren(UI.errorBox('Could not load global stats.', e.message));
    }
  })();

  // --- recent games ---
  (async () => {
    try {
      const games = await apiGet('/rbw/api/games/recent?limit=8', { ttl: 30000 });
      if (!games.length) {
        gamesSkeleton.replaceWith(UI.emptyBox('No games played yet.'));
        return;
      }
      const rows = games.map(g => [
        UI.link('#' + g.gameId, `#/game/${g.gameId}`),
        { content: g.map, attrs: { class: 'muted' } },
        UI.el('span', {
          class: 'muted',
          text: g.duration !== null && g.duration !== undefined ? `${g.duration} min` : '—'
        }),
        UI.el('span', {
          class: 'muted',
          text: g.team1 && g.team2
            ? `${g.team1.length}v${g.team2.length}`
            : '—'
        }),
        { content: UI.timeAgo(g.date), attrs: { class: 'muted' } }
      ]);
      gamesSkeleton.replaceWith(UI.card(null, UI.table(
        [
          { label: 'Game' }, { label: 'Map' }, { label: 'Duration' },
          { label: 'Teams' }, { label: 'When' }
        ],
        rows
      ), UI.link('View all →', '#/games')));
    } catch (e) {
      gamesSkeleton.replaceWith(UI.errorBox('Could not load recent games.', e.message));
    }
  })();

  // --- live queues ---
  (async () => {
    try {
      const queues = await apiGet('/rbw/api/queues', { ttl: 15000 });
      if (!queues.length) {
        queuesSkeleton.replaceWith(UI.emptyBox('No queues configured.'));
        return;
      }
      const rows = queues.map(q => [
        UI.el('span', {
          class: 'muted num',
          text: `${UI.formatNumber(q.minElo)}–${UI.formatNumber(q.maxElo)}`
        }),
        { content: UI.pill(q.isRanked ? 'Ranked' : 'Unranked', q.isRanked ? 'ok' : '') },
        { content: UI.pill(q.ispicking ? 'Picking' : 'Random') },
        UI.el('span', { class: 'num', text: `${q.playerCount}/${q.maxPlayers}` }),
        UI.el('span', {
          class: 'muted',
          text: q.playerIGNs.length ? q.playerIGNs.join(', ') : 'Empty'
        })
      ]);
      queuesSkeleton.replaceWith(UI.card(null, UI.table(
        [
          { label: 'ELO range', align: 'num' }, { label: 'Mode' }, { label: 'Type' },
          { label: 'Players', align: 'num' }, { label: 'In queue' }
        ],
        rows
      )));
    } catch (e) {
      queuesSkeleton.replaceWith(UI.errorBox('Could not load queues.', e.message));
    }
  })();
}
