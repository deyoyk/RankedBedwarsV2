const MODES = [
  'elo', 'wins', 'losses', 'games', 'kills', 'deaths', 'finalKills', 'finalDeaths',
  'bedBroken', 'mvps', 'winstreak', 'losestreak', 'kdr', 'wlr',
  'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced',
  'level', 'experience', 'playtimeSeconds', 'peakElo',
];

export const title = 'Leaderboards';

export async function render(main, segments, params, { apiGet, UI }) {
  const mode = MODES.includes(params.get('mode')) ? params.get('mode') : 'elo';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);

  const head = UI.el('div', { class: 'page-head' },
    UI.el('h1', { text: 'Leaderboards' }),
    UI.el('div', { class: 'sub' }, 'Every stat, ranked. Click a mode to re-sort.')
  );
  const modes = UI.modeBar(MODES, mode, m => `#/leaderboard?mode=${m}&page=1`);
  const body = UI.el('div', { class: 'card' }, UI.skeletonRows(12));

  main.replaceChildren(head, modes, body);

  const data = await apiGet(`/rbw/api/leaderboard?mode=${mode}&page=${page}`, { ttl: 60000 });

  const entries = Object.entries(data || {})
    .map(([rank, v]) => ({ rank: parseInt(rank, 10), ign: v.ign, value: v.value }))
    .sort((a, b) => a.rank - b.rank);

  if (!entries.length) {
    body.replaceChildren(UI.emptyBox('No players on this board yet.'));
    return;
  }

  const rows = entries.map(e => [
    { content: e.rank, attrs: { class: `rank${e.rank <= 3 ? ' top' : ''}` } },
    UI.link(e.ign, `#/player/${encodeURIComponent(e.ign)}`),
    { content: UI.formatValue(mode, e.value), attrs: { class: 'num' } }
  ]);

  const totalPages = page + 1; // API doesn't return totals; next-page hint from row count
  body.replaceChildren(
    UI.table(
      [{ label: 'Rank', align: 'num' }, { label: 'Player' }, { label: mode, align: 'num' }],
      rows
    ),
    UI.pager({
      page,
      totalPages,
      canPrev: page > 1,
      canNext: entries.length === 10,
      onPage: (p) => { location.hash = `#/leaderboard?mode=${mode}&page=${Math.max(1, p)}`; }
    })
  );
}
