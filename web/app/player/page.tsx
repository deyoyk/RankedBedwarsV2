'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatNumber, formatValue, timeAgo } from '@/lib/format';
import { Card, DataTable, EmptyBox, ErrorBox, SkeletonRows, Skeleton, Sparkline, StatCell } from '@/components/ui';
import { PlayerLink } from '@/components/ui';

const STAT_ORDER: Array<[string, string]> = [
  ['elo', 'Elo'], ['peakElo', 'Peak elo'], ['wins', 'Wins'], ['losses', 'Losses'],
  ['games', 'Games'], ['winRate', 'Win rate'], ['kills', 'Kills'], ['deaths', 'Deaths'],
  ['kdr', 'KDR'], ['finalKills', 'Final kills'], ['finalDeaths', 'Final deaths'],
  ['bedBroken', 'Beds broken'], ['mvps', 'MVPs'], ['winstreak', 'Winstreak'],
  ['losestreak', 'Losestreak'], ['level', 'Level'], ['experience', 'Experience'],
  ['playtimeSeconds', 'Playtime'], ['diamonds', 'Diamonds'], ['irons', 'Iron'],
  ['gold', 'Gold'], ['emeralds', 'Emeralds'], ['blocksPlaced', 'Blocks placed'],
];

interface Overview {
  profile: Record<string, unknown> & { ign: string; elo: number };
  recentGames?: Array<Record<string, unknown> & { gameId: number; date: string }>;
  dailyElo?: Array<{ elo: number }>;
  seasonHistory?: { seasons: Array<Record<string, unknown>> };
}

function PlayerInner() {
  const params = useSearchParams();
  const query = params.get('query') || '';
  const [body, setBody] = useState<React.ReactNode>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!query) {
        setBody(<ErrorBox message="No player specified." detail="Use /player?query=&lt;discord id or IGN&gt;." />);
        return;
      }
      const isNumeric = /^\d+$/.test(query);
      let discordId = query;
      try {
        if (!isNumeric) {
          const user = await apiGet<{ discordId: string }>(`/rbw/api/user?ign=${encodeURIComponent(query)}`, { ttl: 30000 });
          discordId = user.discordId;
        }
      } catch {
        if (alive) setBody(<ErrorBox message="Player not found." />);
        return;
      }
      try {
        const overview = await apiGet<Overview>(`/rbw/api/user/${discordId}/overview`, { ttl: 30000 });
        if (!alive) return;
        const p = overview.profile;
        document.title = `${p.ign} — Ranked Bedwars`;

        let rankName: string | null = null;
        let rankColor: string | null = null;
        try {
          const ranks = await apiGet<Array<{ startElo: number; endElo: number; roleName?: string; roleColor?: string }>>('/rbw/api/eloranks', { ttl: 60000 });
          const match = ranks.find((r) => (p.elo as number) >= r.startElo && (p.elo as number) <= r.endElo);
          if (match) {
            rankName = match.roleName || null;
            rankColor = match.roleColor || null;
          }
        } catch {
        }

        const level = (p as Record<string, { level?: number }>).levelInfo?.level ?? (p.level as number | undefined) ?? 1;
        const wins = Number(p.wins ?? 0);
        const losses = Number(p.losses ?? 0);
        const firstGame = overview.recentGames?.[0]?.date || null;

        const cells = STAT_ORDER.map(([key, label]) => {
          const value = p[key];
          let tone = '';
          if (key === 'elo') tone = 'accent';
          if (key === 'winstreak' && Number(value) > 0) tone = 'ok';
          if (key === 'losestreak' && Number(value) > 0) tone = 'bad';
          if (key === 'winRate' && typeof value === 'string' && value !== 'N/A') {
            const num = parseFloat(value);
            tone = num >= 60 ? 'ok' : num < 40 ? 'bad' : '';
          }
          return <StatCell key={key} label={label} value={formatValue(key, value)} tone={tone} />;
        });

        const daily = (overview.dailyElo || []).map((d) => d.elo);
        const seasons = overview.seasonHistory?.seasons || [];
        const games = overview.recentGames || [];

        setBody(
          <>
            <div className="page-head">
              <h1>{p.ign}</h1>
              <div className="sub"></div>
              <div className="sub" style={{ marginTop: 4 }}>
                <span>Level {level} · </span>
                <span className="muted">{formatNumber(wins)}W / {formatNumber(losses)}L · {timeAgo(firstGame)}</span>
              </div>
            </div>
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="player-head">
                <div>
                  <div className="ign">{p.ign}</div>
                  <div className="rank-line">
                    {rankName ? (
                      <>Rank: <span style={{ color: rankColor || '#fafafa' }}>{rankName}</span></>
                    ) : (
                      'No rank assigned'
                    )}
                  </div>
                </div>
                <div className="elo">
                  <small>Elo</small>
                  {formatNumber(p.elo ?? 0)}
                </div>
              </div>
            </div>
            <div className="section">
              <div className="section-title">Statistics</div>
              <div className="stat-grid">{cells}</div>
            </div>
            <div className="grid-2">
              <div>
                <div className="section-title">Elo history</div>
                <div className="card">
                  {daily.length >= 2 ? (
                    <Sparkline values={daily} width={540} height={90} />
                  ) : (
                    <div className="muted" style={{ padding: 16, fontSize: 12.5 }}>Not enough data yet</div>
                  )}
                </div>
              </div>
              <div>
                <div className="section-title">Season history</div>
                <div className="card">
                  {!seasons.length ? (
                    <EmptyBox text="No season history yet." />
                  ) : (
                    <DataTable
                      headers={[
                        { label: 'Season' }, { label: 'Elo', align: 'num' }, { label: 'Peak', align: 'num' },
                        { label: 'Games', align: 'num' }, { label: 'Wins', align: 'num' }, { label: 'KDR', align: 'num' },
                      ]}
                      rows={seasons.map((s, i) => {
                        const r = s as Record<string, number | string>;
                        return [
                          <span key={`s${i}`} className="num">{r.season}.{r.chapter}</span>,
                          <span key={`e${i}`} className="num">{formatNumber(r.elo as number)}</span>,
                          <span key={`p${i}`} className="num">{formatNumber((r.peakElo ?? r.elo) as number)}</span>,
                          <span key={`g${i}`} className="num">{formatNumber(r.games as number)}</span>,
                          <span key={`w${i}`} className="num">{formatNumber(r.wins as number)}</span>,
                          <span key={`k${i}`} className="num">{String(r.kdr ?? '—')}</span>,
                        ];
                      })}
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="section">
              <div className="section-title">Recent games</div>
              <div className="card">
                {!games.length ? (
                  <EmptyBox text="No games played yet." />
                ) : (
                  <DataTable
                    headers={[
                      { label: 'Game' }, { label: 'Map' }, { label: 'Result' }, { label: 'Elo', align: 'num' },
                      { label: 'Kills', align: 'num' }, { label: 'Finals', align: 'num' },
                      { label: 'Beds', align: 'num' }, { label: 'When' },
                    ]}
                    rows={games.map((g) => {
                      const r = g as Record<string, number | string | boolean>;
                      const won = r.won === true;
                      const gain = Number(r.eloGain ?? 0);
                      return [
                        <Link key={`g${r.gameId}`} href={`/game?id=${r.gameId}`}>#{r.gameId}</Link>,
                        <span key={`m${r.gameId}`} className="muted">{String(r.map ?? '—')}</span>,
                        <span key={`r${r.gameId}`} className={won ? 'num' : 'num muted'}>{won ? 'W' : 'L'}</span>,
                        <span key={`e${r.gameId}`} className="num">{gain >= 0 ? `+${gain}` : String(gain)}</span>,
                        <span key={`k${r.gameId}`} className="num">{formatNumber(r.kills as number ?? 0)}</span>,
                        <span key={`f${r.gameId}`} className="num">{formatNumber(r.finalKills as number ?? 0)}</span>,
                        <span key={`b${r.gameId}`} className="num">{formatNumber(r.bedBroken as number ?? 0)}</span>,
                        <span key={`w${r.gameId}`} className="muted">{timeAgo(r.date as string)}</span>,
                      ];
                    })}
                  />
                )}
              </div>
            </div>
          </>
        );
      } catch (e) {
        if (alive) setBody(<ErrorBox message="Could not load player." detail={e instanceof Error ? e.message : ''} />);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [query]);

  if (body) return <>{body}</>;

  return (
    <>
      <div className="page-head">
        <h1>Player</h1>
        <div className="sub"><Skeleton width="160px" height="13px" /></div>
      </div>
      <div className="card" style={{ marginBottom: 24 }}><SkeletonRows count={2} height="22px" /></div>
      <div className="section">
        <div className="section-title">Statistics</div>
        <SkeletonRows count={3} />
      </div>
      <div className="grid-2">
        <div>
          <div className="section-title">Elo history</div>
          <div className="card"><Skeleton width="100%" height="90px" /></div>
        </div>
        <div>
          <div className="section-title">Season history</div>
          <div className="card"><SkeletonRows count={4} /></div>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Recent games</div>
        <div className="card"><SkeletonRows count={5} /></div>
      </div>
    </>
  );
}

export default function PlayerPage() {
  return (
    <Suspense>
      <PlayerInner />
    </Suspense>
  );
}
