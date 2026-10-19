'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { DataTable, EmptyBox, ErrorBox, PlayerLink, SkeletonRows } from '@/components/ui';

interface GameRow {
  gameId: number;
  map: string;
  duration?: number | null;
  team1?: Array<{ ign?: string } | string>;
  team2?: Array<{ ign?: string } | string>;
  winners?: Array<{ ign?: string } | string>;
  date: string;
}

function teamText(team: GameRow['team1'], winners: Set<string>) {
  const players = (team || []).map((p) => {
    const ign = typeof p === 'string' ? p : p.ign ?? '?';
    const won = winners.has(ign);
    return (
      <Link key={ign} href={`/player?query=${encodeURIComponent(ign)}`} style={won ? { color: 'var(--ok)' } : undefined}>
        {ign}
      </Link>
    );
  });
  return <span className="muted">{players.length ? players : '—'}</span>;
}

function GamesInner() {
  const params = useSearchParams();
  const limit = Math.min(Math.max(parseInt(params.get('limit') || '50', 10) || 50, 1), 100);
  const [body, setBody] = useState<React.ReactNode>(null);

  useEffect(() => {
    let alive = true;
    apiGet<GameRow[]>(`/rbw/api/games/recent?limit=${limit}`, { ttl: 30000 })
      .then((games) => {
        if (!alive) return;
        if (!games.length) {
          setBody(<EmptyBox text="No games played yet." />);
          return;
        }
        setBody(
          <DataTable
            headers={[
              { label: 'Game' }, { label: 'Map' }, { label: 'Duration' },
              { label: 'Format' }, { label: 'Team 1' }, { label: 'Team 2' }, { label: 'When' },
            ]}
            rows={games.map((g) => {
              const winners = new Set((g.winners || []).map((w) => (typeof w === 'string' ? w : w.ign ?? '?')));
              return [
                <Link key={`g${g.gameId}`} href={`/game?id=${g.gameId}`}>#{g.gameId}</Link>,
                <span key={`m${g.gameId}`} className="muted">{g.map}</span>,
                <span key={`d${g.gameId}`} className="num">
                  {g.duration !== null && g.duration !== undefined ? `${g.duration} min` : '—'}
                </span>,
                <span key={`f${g.gameId}`} className="muted">{g.team1?.length || 0}v{g.team2?.length || 0}</span>,
                <span key={`t1${g.gameId}`}>{teamText(g.team1, winners)}</span>,
                <span key={`t2${g.gameId}`}>{teamText(g.team2, winners)}</span>,
                <span key={`w${g.gameId}`} className="muted">{timeAgo(g.date)}</span>,
              ];
            })}
          />
        );
      })
      .catch((e) => {
        if (alive) setBody(<ErrorBox message="Could not load games." detail={e instanceof Error ? e.message : ''} />);
      });
    return () => {
      alive = false;
    };
  }, [limit]);

  return (
    <>
      <div className="page-head">
        <h1>Games</h1>
        <div className="sub">Recent ranked matches.</div>
      </div>
      <div className="card">{body ?? <SkeletonRows count={10} />}</div>
    </>
  );
}

export default function GamesPage() {
  return (
    <Suspense>
      <GamesInner />
    </Suspense>
  );
}
