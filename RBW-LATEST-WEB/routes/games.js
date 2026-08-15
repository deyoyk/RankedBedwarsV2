export const title = 'Games';

export async function render(main, segments, params, { apiGet, UI }) {
  const head = UI.el('div', { class: 'page-head' },
    UI.el('h1', { text: 'Games' }),
    UI.el('div', { class: 'sub' }, 'Recent ranked matches.')
  );
  const body = UI.el('div', { class: 'card' }, UI.skeletonRows(10));
  main.replaceChildren(head, body);

  const limit = Math.min(Math.max(parseInt(params.get('limit') || '50', 10) || 50, 1), 100);
  const games = await apiGet(`/rbw/api/games/recent?limit=${limit}`, { ttl: 30000 });

  if (!games.length) {
    body.replaceChildren(UI.emptyBox('No games played yet.'));
    return;
  }

  const rows = games.map(g => {
    const winners = new Set((g.winners || []).map(w => w.ign ?? w));
    const teamText = (team) => {
      const players = (team || []).map(p => {
        const ign = p.ign ?? p;
        const won = winners.has(ign);
        const node = UI.link(ign, `#/player/${encodeURIComponent(ign)}`);
        if (won) node.style.color = 'var(--ok)';
        return node;
      });
      return UI.el('span', { class: 'muted' }, players.length ? players : '—');
    };
    return [
      UI.link('#' + g.gameId, `#/game/${g.gameId}`),
      { content: g.map, attrs: { class: 'muted' } },
      UI.el('span', {
        class: 'num',
        text: g.duration !== null && g.duration !== undefined ? `${g.duration} min` : '—'
      }),
      UI.el('span', { class: 'muted', text: `${g.team1?.length || 0}v${g.team2?.length || 0}` }),
      { content: teamText(g.team1) },
      { content: teamText(g.team2) },
      { content: UI.timeAgo(g.date), attrs: { class: 'muted' } }
    ];
  });

  body.replaceChildren(UI.table(
    [
      { label: 'Game' }, { label: 'Map' }, { label: 'Duration' },
      { label: 'Format' }, { label: 'Team 1' }, { label: 'Team 2' }, { label: 'When' }
    ],
    rows
  ));
}
