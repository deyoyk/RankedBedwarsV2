export const title = 'Game';

const TL_LABEL = {
  game_start: 'Start',
  player_join: 'Joined',
  player_leave: 'Left',
  kill: 'Kill',
  final_kill: 'Final kill',
  death: 'Death',
  bed_break: 'Bed broken',
  block_place: 'Block placed',
  resource_pickup: 'Pickup',
  game_end: 'End',
};

function fmtTime(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export async function render(main, segments, params, { apiGet, UI }) {
  const gameId = segments[1];
  if (!gameId || !/^\d+$/.test(gameId)) {
    main.replaceChildren(UI.errorBox('Invalid game id.', 'Use #/game/<gameId>.'));
    return;
  }

  const head = UI.el('div', { class: 'page-head' },
    UI.el('h1', { text: `Game #${gameId}` }),
    UI.el('div', { class: 'sub' }, UI.skeleton('200px', '13px'))
  );
  const teamsSkeleton = UI.el('div', { class: 'teams', style: 'margin-top:20px' },
    UI.el('div', { class: 'card' }, UI.skeletonRows(5)),
    UI.el('div', { class: 'card' }, UI.skeletonRows(5))
  );
  const statsSkeleton = UI.el('div', { class: 'stat-grid', style: 'margin-top:20px' },
    Array.from({ length: 4 }, () => UI.skeleton('100%', '48px'))
  );
  const timelineSkeleton = UI.el('div', { class: 'section' },
    UI.el('div', { class: 'section-title', text: 'Timeline' }),
    UI.el('div', { class: 'card' }, UI.skeletonRows(8, '20px'))
  );

  main.replaceChildren(head, teamsSkeleton, statsSkeleton, timelineSkeleton);

  const [game, timelineData] = await Promise.all([
    apiGet(`/rbw/api/game/${gameId}`, { ttl: 60000 }),
    apiGet(`/rbw/api/game/${gameId}/timeline`, { ttl: 60000 }),
  ]);

  document.title = `Game #${game.gameId} — Ranked Bedwars`;

  const statePill = game.state === 'scored' ? UI.pill('Scored', 'ok')
    : game.state === 'voided' ? UI.pill('Voided', 'bad')
    : UI.pill(game.state || 'Pending', 'warn');

  const duration = game.endTime
    ? UI.formatDuration(Math.floor((new Date(game.endTime).getTime() - new Date(game.startTime).getTime()) / 1000))
    : '—';

  head.replaceChildren(
    UI.el('h1', { text: `Game #${game.gameId}` }),
    UI.el('div', { class: 'sub' },
      UI.el('span', { text: game.map }),
      UI.el('span', { text: ' · ' }),
      statePill,
      UI.el('span', { text: ` · ${UI.formatDateTime(game.startTime)} · ${duration}` })
    )
  );

  // Stat strip.
  const winners = game.winnersign || [];
  const losers = game.losersign || [];
  const mvpCount = (game.mvpsign || []).length;
  const bedCount = (game.bedbreaksign || []).length;
  const playerCount = (game.team1ign || []).length + (game.team2ign || []).length;
  const statsStrip = UI.el('div', { class: 'stat-grid' }, [
    UI.statCell('Players', playerCount),
    UI.statCell('Winners', winners.length, 'ok'),
    UI.statCell('MVPs', mvpCount, 'accent'),
    UI.statCell('Beds broken', bedCount),
  ]);
  statsSkeleton.replaceWith(statsStrip);

  // Teams.
  function teamCard(title, igns, isWinner, playersInfo) {
    const body = igns.length
      ? igns.map(ign => {
          const info = playersInfo[ign] || {};
          const tags = [];
          if (info.mvp) tags.push(UI.el('span', { class: 'tag tag-mvp', text: 'MVP' }));
          if (info.bed) tags.push(UI.el('span', { class: 'tag tag-bed', text: 'BED' }));
          return UI.el('div', { class: 'team-player' },
            UI.el('span', {}, UI.link(ign, `#/player/${encodeURIComponent(ign)}`), tags.length ? UI.el('span', { style: 'margin-left:8px' }, tags) : null),
            UI.el('span', { class: 'num muted', text: info.kills !== undefined ? `${info.kills} kills` : '' })
          );
        })
      : [UI.el('div', { class: 'team-player muted', text: 'No players' })];
    return UI.el('div', { class: `team${isWinner ? ' winner' : ''}` },
      UI.el('div', { class: 'team-head' },
        UI.el('span', { text: title }),
        UI.el('span', { text: isWinner ? 'WIN' : '' })
      ),
      UI.el('div', { class: 'team-body' }, body)
    );
  }

  // Per-player info from timeline + game fields.
  const playersInfo = {};
  for (const ign of [...(game.team1ign || []), ...(game.team2ign || [])]) {
    playersInfo[ign] = { mvp: (game.mvpsign || []).includes(ign), bed: (game.bedbreaksign || []).includes(ign) };
  }
  for (const ev of timelineData.timeline || []) {
    if (ev.type === 'kill' && ev.player && playersInfo[ev.player]) {
      playersInfo[ev.player].kills = (playersInfo[ev.player].kills || 0) + 1;
    }
  }

  const t1 = (game.team1ign || []);
  const t2 = (game.team2ign || []);
  const winnerSet = new Set(winners);
  const t1Won = t1.some(i => winnerSet.has(i));
  const t2Won = t2.some(i => winnerSet.has(i));

  teamsSkeleton.replaceChildren(
    teamCard('Team 1', t1, t1Won && t2Won !== t1Won, playersInfo),
    teamCard('Team 2', t2, t2Won && t1Won !== t2Won, playersInfo)
  );

  // Timeline.
  const timeline = timelineData.timeline || [];
  const holder = timelineSkeleton.querySelector('.card');
  if (!timeline.length) {
    holder.replaceChildren(UI.emptyBox('No timeline events recorded for this game.'));
    return;
  }

  const rows = timeline.map(ev => {
    const label = TL_LABEL[ev.type] || ev.type;
    let detail = '';
    if (ev.type === 'kill' || ev.type === 'final_kill') {
      detail = `${UI.link(ev.player || '?', `#/player/${encodeURIComponent(ev.player || '')}`)} → ${ev.target || '?'}`;
    } else if (ev.type === 'death') {
      detail = UI.link(ev.player || '?', `#/player/${encodeURIComponent(ev.player || '')}`);
    } else if (ev.type === 'bed_break') {
      detail = `${UI.link(ev.player || '?', `#/player/${encodeURIComponent(ev.player || '')}`)} broke ${ev.team || ev.target || 'a bed'}`;
    } else if (ev.type === 'resource_pickup') {
      detail = `${UI.link(ev.player || '?', `#/player/${encodeURIComponent(ev.player || '')}`)} +${ev.amount ?? ''} ${ev.target || ''}`;
    } else if (ev.type === 'block_place') {
      detail = UI.link(ev.player || '?', `#/player/${encodeURIComponent(ev.player || '')}`);
    } else if (ev.type === 'player_join' || ev.type === 'player_leave') {
      detail = UI.link(ev.player || '?', `#/player/${encodeURIComponent(ev.player || '')}`);
    } else if (ev.type === 'game_end') {
      detail = ev.team || '';
    }
    return UI.el('div', { class: 'tl-event', 'data-type': ev.type },
      UI.el('span', { class: 'tl-time', text: fmtTime(ev.timestamp) }),
      UI.el('span', { class: 'tl-type', text: label }),
      UI.el('span', { class: 'tl-detail' }, detail || '')
    );
  });

  holder.replaceChildren(UI.el('div', { class: 'timeline' }, rows));
}
