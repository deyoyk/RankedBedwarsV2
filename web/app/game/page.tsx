'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatDateTime, formatDuration, formatGameLength, formatNumber, timeAgo } from '@/lib/format';
import { Card, DataTable, EmptyBox, ErrorBox, Pill, PlayerLink, Skeleton, SkeletonRows, StatCell } from '@/components/ui';

const TL_LABEL: Record<string, string> = {
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

interface TimelineEvent {
  type: string;
  player?: string;
  target?: string;
  team?: string;
  amount?: number;
  timestamp: number;
}

function EventDetail({ ev }: { ev: TimelineEvent }) {
  const who = (ign?: string) =>
    ign ? <PlayerLink ign={ign} /> : <span>?</span>;
  switch (ev.type) {
    case 'kill':
    case 'final_kill':
      return <>{who(ev.player)} → {ev.target || '?'}</>;
    case 'death':
    case 'block_place':
    case 'player_join':
    case 'player_leave':
      return <>{who(ev.player)}</>;
    case 'bed_break':
      return <>{who(ev.player)} broke {ev.team || ev.target || 'a bed'}</>;
    case 'resource_pickup':
      return <>{who(ev.player)} +{ev.amount ?? ''} {ev.target || ''}</>;
    case 'game_end':
      return <>{ev.team || ''}</>;
    default:
      return <>{TL_LABEL[ev.type] ? '' : ev.type}</>;
  }
}

function GameInner() {
  const params = useSearchParams();
  const id = params.get('id') || '';
  const [body, setBody] = useState<React.ReactNode>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!id || !/^\d+$/.test(id)) {
        setBody(<ErrorBox message="Invalid game id." detail="Use /game?id=<gameId>." />);
        return;
      }
      try {
        const [game, timelineData] = await Promise.all([
          apiGet<Record<string, unknown>>(`/rbw/api/game/${id}`, { ttl: 60000 }),
          apiGet<{ timeline?: TimelineEvent[] }>(`/rbw/api/game/${id}/timeline`, { ttl: 60000 }),
        ]);
        if (!alive) return;
        const gid = game.gameId as number;
        document.title = `Game #${gid} — Ranked Bedwars`;

        const state = String(game.state || 'pending');
        const statePill =
          state === 'scored' ? <Pill text="Scored" tone="ok" /> :
          state === 'voided' ? <Pill text="Voided" tone="bad" /> :
          <Pill text={game.state as string || 'Pending'} tone="warn" />;

        const duration =
          game.endTime && game.startTime
            ? formatDuration(Math.floor((new Date(game.endTime as string).getTime() - new Date(game.startTime as string).getTime()) / 1000))
            : '—';

        const winners = (game.winnersign as string[]) || [];
        const t1 = (game.team1ign as string[]) || [];
        const t2 = (game.team2ign as string[]) || [];
        const winnerSet = new Set(winners);
        const t1Won = t1.some((i) => winnerSet.has(i)) && !t2.some((i) => winnerSet.has(i));
        const t2Won = t2.some((i) => winnerSet.has(i)) && !t1.some((i) => winnerSet.has(i));

        const playersInfo: Record<string, { mvp: boolean; bed: boolean; kills?: number }> = {};
        for (const ign of [...t1, ...t2]) {
          playersInfo[ign] = {
            mvp: ((game.mvpsign as string[]) || []).includes(ign),
            bed: ((game.bedbreaksign as string[]) || []).includes(ign),
          };
        }
        const timeline = timelineData.timeline || [];
        for (const ev of timeline) {
          if (ev.type === 'kill' && ev.player && playersInfo[ev.player]) {
            playersInfo[ev.player].kills = (playersInfo[ev.player].kills || 0) + 1;
          }
        }

        function teamCard(title: string, igns: string[], isWinner: boolean) {
          return (
            <div className={`team${isWinner ? ' winner' : ''}`}>
              <div className="team-head">
                <span>{title}</span>
                <span>{isWinner ? 'WIN' : ''}</span>
              </div>
              <div className="team-body">
                {igns.length ? (
                  igns.map((ign) => {
                    const info = playersInfo[ign] || {};
                    return (
                      <div key={ign} className="team-player">
                        <span>
                          <PlayerLink ign={ign} />
                          {(info.mvp || info.bed) && (
                            <span style={{ marginLeft: 8 }}>
                              {info.mvp ? <span className="tag tag-mvp">MVP</span> : null}
                              {info.bed ? <span className="tag tag-bed">BED</span> : null}
                            </span>
                          )}
                        </span>
                        <span className="num muted">{info.kills !== undefined ? `${info.kills} kills` : ''}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="team-player muted">No players</div>
                )}
              </div>
            </div>
          );
        }

        setBody(
          <>
            <div className="page-head">
              <h1>Game #{gid}</h1>
              <div className="sub">
                <span>{String(game.map ?? '')}</span>
                <span> · </span>
                {statePill}
                <span> · {formatDateTime(game.startTime as string)} · {duration}</span>
              </div>
            </div>
            <div className="teams" style={{ marginTop: 20 }}>
              {teamCard('Team 1', t1, t1Won)}
              {teamCard('Team 2', t2, t2Won)}
            </div>
            <div className="stat-grid" style={{ marginTop: 20 }}>
              <StatCell label="Players" value={t1.length + t2.length} />
              <StatCell label="Winners" value={winners.length} tone="ok" />
              <StatCell label="MVPs" value={((game.mvpsign as string[]) || []).length} tone="accent" />
              <StatCell label="Beds broken" value={((game.bedbreaksign as string[]) || []).length} />
            </div>
            <div className="section">
              <div className="section-title">Timeline</div>
              <div className="card">
                {!timeline.length ? (
                  <EmptyBox text="No timeline events recorded for this game." />
                ) : (
                  <div className="timeline">
                    {timeline.map((ev, i) => (
                      <div key={i} className="tl-event" data-type={ev.type}>
                        <span className="tl-time">{formatGameLength(ev.timestamp)}</span>
                        <span className="tl-type">{TL_LABEL[ev.type] || ev.type}</span>
                        <span className="tl-detail"><EventDetail ev={ev} /></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        );
      } catch (e) {
        if (alive) setBody(<ErrorBox message="Could not load game." detail={e instanceof Error ? e.message : ''} />);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [id]);

  if (body) return <>{body}</>;

  return (
    <>
      <div className="page-head">
        <h1>Game #{id || '…'}</h1>
        <div className="sub"><Skeleton width="200px" height="13px" /></div>
      </div>
      <div className="teams" style={{ marginTop: 20 }}>
        <div className="card"><SkeletonRows count={5} /></div>
        <div className="card"><SkeletonRows count={5} /></div>
      </div>
      <div className="stat-grid" style={{ marginTop: 20 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} width="100%" height="48px" />
        ))}
      </div>
      <div className="section">
        <div className="section-title">Timeline</div>
        <div className="card"><SkeletonRows count={8} height="20px" /></div>
      </div>
    </>
  );
}

export default function GamePage() {
  return (
    <Suspense>
      <GameInner />
    </Suspense>
  );
}
