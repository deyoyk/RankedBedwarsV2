const STAT_ORDER = [
  ['elo', 'Elo'], ['peakElo', 'Peak elo'], ['wins', 'Wins'], ['losses', 'Losses'],
  ['games', 'Games'], ['winRate', 'Win rate'], ['kills', 'Kills'], ['deaths', 'Deaths'],
  ['kdr', 'KDR'], ['finalKills', 'Final kills'], ['finalDeaths', 'Final deaths'],
  ['bedBroken', 'Beds broken'], ['mvps', 'MVPs'], ['winstreak', 'Winstreak'],
  ['losestreak', 'Losestreak'], ['level', 'Level'], ['experience', 'Experience'],
  ['playtimeSeconds', 'Playtime'], ['diamonds', 'Diamonds'], ['irons', 'Iron'],
  ['gold', 'Gold'], ['emeralds', 'Emeralds'], ['blocksPlaced', 'Blocks placed'],
];

export const title = 'Player';

export async function render(main, segments, params, { apiGet, UI }) {
  const query = segments[1];
  if (!query) {
    main.replaceChildren(UI.errorBox('No player specified.', 'Use #/player/<discord id or IGN>.'));
    return;
  }

  const isNumeric = /^\d+$/.test(query);
  const head = UI.el('div', { class: 'page-head' },
    UI.el('h1', { text: isNumeric ? 'Player' : query }),
    UI.el('div', { class: 'sub' }, UI.skeleton('160px', '13px'))
  );
  const headerCard = UI.el('div', { class: 'card', style: 'margin-bottom:24px' }, UI.skeletonRows(2, '22px'));
  const statsCard = UI.el('div', { class: 'section' },
    UI.el('div', { class: 'section-title', text: 'Statistics' }),
    UI.skeletonRows(3)
  );
  const grid = UI.el('div', { class: 'grid-2' },
    UI.el('div', {}, UI.el('div', { class: 'section-title', text: 'Elo history' }), UI.el('div', { class: 'card' }, UI.skeleton('100%', '90px'))),
    UI.el('div', {}, UI.el('div', { class: 'section-title', text: 'Season history' }), UI.el('div', { class: 'card' }, UI.skeletonRows(4)))
  );
  const recent = UI.el('div', { class: 'section' },
    UI.el('div', { class: 'section-title', text: 'Recent games' }),
    UI.el('div', { class: 'card' }, UI.skeletonRows(5))
  );

  main.replaceChildren(head, headerCard, statsCard, grid, recent);

  // Resolve IGN → discordId when needed.
  let discordId = query;
  try {
    if (!isNumeric) {
      const user = await apiGet(`/rbw/api/user?ign=${encodeURIComponent(query)}`, { ttl: 30000 });
      discordId = user.discordId;
    }
  } catch (e) {
    head.querySelector('.sub').replaceChildren(
      UI.el('span', { class: 'muted', text: `Player "${query}" not found.` })
    );
    main.replaceChildren(head, UI.errorBox('Player not found.'));
    return;
  }

  const overview = await apiGet(`/rbw/api/user/${discordId}/overview`, { ttl: 30000 });
  const p = overview.profile;

  document.title = `${p.ign} — Ranked Bedwars`;

  // Rank from elo ranges.
  let rankName = null;
  let rankColor = null;
  try {
    const ranks = await apiGet('/rbw/api/eloranks', { ttl: 60000 });
    const match = ranks.find(r => p.elo >= r.startElo && p.elo <= r.endElo);
    if (match) {
      rankName = match.roleName || null;
      rankColor = match.roleColor || null;
    }
  } catch (e) {}

  const rankLine = rankName
    ? `Rank: <span style="color:${rankColor || '#fafafa'}">${rankName}</span>`
    : 'No rank assigned';

  head.replaceChildren(
    UI.el('h1', { text: p.ign }),
    UI.el('div', { class: 'sub' }, ''),
    UI.el('div', { class: 'sub', style: 'margin-top:4px' },
      UI.el('span', { text: `Level ${p.levelInfo?.level ?? p.level ?? 1} · ` }),
      UI.el('span', { class: 'muted', text: `${UI.formatNumber(p.wins ?? 0)}W / ${UI.formatNumber(p.losses ?? 0)}L · ${UI.timeAgo(overview.recentGames?.[0]?.date || null)}` })
    )
  );

  headerCard.replaceChildren(
    UI.el('div', { class: 'player-head' },
      UI.el('div', {},
        UI.el('div', { class: 'ign', text: p.ign }),
        UI.el('div', { class: 'rank-line' }, rankLine)
      ),
      UI.el('div', { class: 'elo' },
        UI.el('small', { text: 'Elo' }),
        UI.formatNumber(p.elo ?? 0)
      )
    )
  );

  const cells = STAT_ORDER.map(([key, label]) => {
    let value = p[key];
    let tone = '';
    if (key === 'elo') tone = 'accent';
    if (key === 'winstreak' && value > 0) tone = 'ok';
    if (key === 'losestreak' && value > 0) tone = 'bad';
    if (key === 'winRate' && typeof value === 'string' && value !== 'N/A') {
      const num = parseFloat(value);
      tone = num >= 60 ? 'ok' : num < 40 ? 'bad' : '';
    }
    return UI.statCell(label, UI.formatValue(key, value), tone);
  });
  statsCard.replaceChildren(
    UI.el('div', { class: 'section-title', text: 'Statistics' }),
    UI.el('div', { class: 'stat-grid' }, cells)
  );

  // Elo sparkline.
  (async () => {
    try {
      const daily = (overview.dailyElo || []).map(d => d.elo);
      const holder = grid.querySelector('.grid-2 > div:first-child > .card');
      holder.replaceChildren(
        daily.length >= 2
          ? UI.sparkline(daily, { width: 540, height: 90 })
          : UI.el('div', { class: 'muted', style: 'padding:16px;font-size:12.5px', text: 'Not enough data yet' })
      );
    } catch (e) {}
  })();

  // Season history.
  (async () => {
    try {
      const seasons = overview.seasonHistory?.seasons || [];
      const holder = grid.querySelector('.grid-2 > div:last-child > .card');
      if (!seasons.length) {
        holder.replaceChildren(UI.emptyBox('No season history yet.'));
        return;
      }
      const rows = seasons.map(s => [
        UI.el('span', { class: 'num', text: `${s.season}.${s.chapter}` }),
        { content: UI.formatNumber(s.elo), attrs: { class: 'num' } },
        { content: UI.formatNumber(s.peakElo ?? s.elo), attrs: { class: 'num' } },
        { content: UI.formatNumber(s.games), attrs: { class: 'num' } },
        { content: UI.formatNumber(s.wins), attrs: { class: 'num' } },
        { content: s.kdr, attrs: { class: 'num' } }
      ]);
      holder.replaceChildren(UI.table(
        [
          { label: 'Season' }, { label: 'Elo', align: 'num' }, { label: 'Peak', align: 'num' },
          { label: 'Games', align: 'num' }, { label: 'Wins', align: 'num' }, { label: 'KDR', align: 'num' }
        ],
        rows
      ));
    } catch (e) {}
  })();

  // Recent games (last 10 from overview).
  (async () => {
    const games = overview.recentGames || [];
    const holder = recent.querySelector('.card');
    if (!games.length) {
      holder.replaceChildren(UI.emptyBox('No games played yet.'));
      return;
    }
    const rows = games.map(g => [
      UI.link('#' + g.gameId, `#/game/${g.gameId}`),
      { content: g.map, attrs: { class: 'muted' } },
      UI.el('span', { class: g.won ? 'num' : 'num muted', text: g.won ? 'W' : 'L' }),
      UI.el('span', {
        class: 'num',
        text: g.eloGain >= 0 ? `+${g.eloGain}` : String(g.eloGain)
      }),
      { content: UI.formatNumber(g.kills ?? 0), attrs: { class: 'num' } },
      { content: UI.formatNumber(g.finalKills ?? 0), attrs: { class: 'num' } },
      { content: UI.formatNumber(g.bedBroken ?? 0), attrs: { class: 'num' } },
      { content: UI.timeAgo(g.date), attrs: { class: 'muted' } }
    ]);
    holder.replaceChildren(UI.table(
      [
        { label: 'Game' }, { label: 'Map' }, { label: 'Result' }, { label: 'Elo', align: 'num' },
        { label: 'Kills', align: 'num' }, { label: 'Finals', align: 'num' },
        { label: 'Beds', align: 'num' }, { label: 'When' }
      ],
      rows
    ));
  })();
}
