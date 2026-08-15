const MODES = [
  'elo', 'wins', 'losses', 'games', 'kills', 'deaths', 'finalKills', 'finalDeaths',
  'bedBroken', 'mvps', 'winstreak', 'losestreak', 'kdr', 'wlr',
  'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced',
  'level', 'experience', 'playtimeSeconds', 'peakElo',
];

export const title = 'Seasons';

export async function render(main, segments, params, { apiGet, UI }) {
  const season = segments[1];
  const chapter = segments[2];

  // Season list view.
  if (!season || !chapter) {
    const head = UI.el('div', { class: 'page-head' },
      UI.el('h1', { text: 'Seasons' }),
      UI.el('div', { class: 'sub' }, 'Season snapshots and their leaderboards.')
    );
    const body = UI.el('div', { class: 'card' }, UI.skeletonRows(6));
    main.replaceChildren(head, body);

    const seasons = await apiGet('/rbw/api/seasons', { ttl: 60000 });
    if (!seasons.length) {
      body.replaceChildren(UI.emptyBox('No seasons yet.'));
      return;
    }
    const rows = seasons.map(s => [
      UI.el('span', { class: 'num', text: `${s.seasonNumber}.${s.chapterNumber}` }),
      { content: s.name, attrs: { class: '' } },
      s.isActive ? { content: UI.pill('Active', 'ok') } : { content: '—' },
      { content: UI.formatDate(s.startDate), attrs: { class: 'muted' } },
      { content: s.endDate ? UI.formatDate(s.endDate) : '—', attrs: { class: 'muted' } },
      UI.el('span', {},
        UI.link('Leaderboard', `#/seasons/${s.seasonNumber}/${s.chapterNumber}?mode=elo&page=1`)
      )
    ]);
    body.replaceChildren(UI.table(
      [
        { label: 'Season' }, { label: 'Name' }, { label: 'Status' },
        { label: 'Started' }, { label: 'Ended' }, { label: '' }
      ],
      rows
    ));
    return;
  }

  // Season leaderboard view.
  const mode = MODES.includes(params.get('mode')) ? params.get('mode') : 'elo';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);

  const head = UI.el('div', { class: 'page-head' },
    UI.el('h1', { text: `Season ${season}.${chapter}` }),
    UI.el('div', { class: 'sub' }, 'Season snapshot leaderboard.')
  );
  const modes = UI.modeBar(MODES, mode, m => `#/seasons/${season}/${chapter}?mode=${m}&page=1`);
  const body = UI.el('div', { class: 'card' }, UI.skeletonRows(12));
  main.replaceChildren(head, modes, body);

  const data = await apiGet(`/rbw/api/seasons/${season}/${chapter}/leaderboard?mode=${mode}&page=${page}`, { ttl: 60000 });

  const entries = Object.entries(data || {})
    .map(([rank, v]) => ({ rank: parseInt(rank, 10), ign: v.ign, value: v.value }))
    .sort((a, b) => a.rank - b.rank);

  if (!entries.length) {
    body.replaceChildren(UI.emptyBox('No entries in this season yet.'));
    return;
  }

  const rows = entries.map(e => [
    { content: e.rank, attrs: { class: `rank${e.rank <= 3 ? ' top' : ''}` } },
    UI.link(e.ign, `#/player/${encodeURIComponent(e.ign)}`),
    { content: UI.formatValue(mode, e.value), attrs: { class: 'num' } }
  ]);

  body.replaceChildren(
    UI.table(
      [{ label: 'Rank', align: 'num' }, { label: 'Player' }, { label: mode, align: 'num' }],
      rows
    ),
    UI.pager({
      page,
      totalPages: page + 1,
      canPrev: page > 1,
      canNext: entries.length === 10,
      onPage: (p) => { location.hash = `#/seasons/${season}/${chapter}?mode=${mode}&page=${Math.max(1, p)}`; }
    })
  );
}
