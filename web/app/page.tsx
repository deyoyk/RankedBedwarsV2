'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '@/lib/api';
import { formatNumber, timeAgo } from '@/lib/format';
import { Card, DataTable, EmptyBox, ErrorBox, Pill, Skeleton, SkeletonRows, StatCell } from '@/components/ui';

interface GlobalStats {
  totalUsers?: number; users?: number; count?: number;
  totalGames?: number; games?: number;
}

interface RecentGame {
  gameId: number; map: string; duration?: number | null;
  team1?: unknown[]; team2?: unknown[]; date: string;
}

interface QueueInfo {
  minElo: number; maxElo: number; isRanked: boolean; isPicking: boolean;
  playerCount: number; maxPlayers: number; playerIGNs: string[];
}

function HeroSearch() {
  const router = useRouter();
  return (
    <div className="search-box">
      <input
        className="search-input"
        type="search"
        placeholder="Search a player…"
        onKeyDown={(e) => {
          const v = (e.target as HTMLInputElement).value.trim();
          if (e.key === 'Enter' && v.length >= 2) router.push(`/player?query=${encodeURIComponent(v)}`);
        }}
      />
    </div>
  );
}

export default function HomePage() {
  const [stats, setStats] = useState<React.ReactNode>(null);
  const [games, setGames] = useState<React.ReactNode>(null);
  const [queues, setQueues] = useState<React.ReactNode>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet<GlobalStats>('/rbw/api/stats/global', { ttl: 15000 }),
      apiGet<{ count?: number }>('/rbw/api/online-players', { ttl: 10000 }),
    ])
      .then(([global, online]) => {
        if (!alive) return;
        const users = global && (global.totalUsers ?? global.users ?? global.count ?? 0);
        const gameCount = global && (global.totalGames ?? global.games ?? 0);
        setStats(
          <div className="stat-grid">
            <StatCell label="Registered players" value={formatNumber(users ?? '—')} />
            <StatCell label="Games played" value={formatNumber(gameCount ?? '—')} />
            <StatCell label="In queue now" value={formatNumber(online?.count ?? '—')} />
          </div>
        );
      })
      .catch((e) => {
        if (alive) setStats(<ErrorBox message="Could not load global stats." detail={e instanceof ApiError ? e.message : ''} />);
      });
    apiGet<RecentGame[]>('/rbw/api/games/recent?limit=8', { ttl: 30000 })
      .then((list) => {
        if (!alive) return;
        if (!list.length) {
          setGames(<EmptyBox text="No games played yet." />);
          return;
        }
        setGames(
          <Card>
            <DataTable
              headers={[{ label: 'Game' }, { label: 'Map' }, { label: 'Duration' }, { label: 'Teams' }, { label: 'When' }]}
              rows={list.map((g) => [
                <Link key={`g${g.gameId}`} href={`/game?id=${g.gameId}`}>#{g.gameId}</Link>,
                <span key="m" className="muted">{g.map}</span>,
                <span key="d" className="muted">{g.duration !== null && g.duration !== undefined ? `${g.duration} min` : '—'}</span>,
                <span key="t" className="muted">{g.team1 && g.team2 ? `${g.team1.length}v${g.team2.length}` : '—'}</span>,
                <span key="w" className="muted">{timeAgo(g.date)}</span>,
              ])}
            />
            <div style={{ marginTop: 12 }}>
              <Link href="/games">View all →</Link>
            </div>
          </Card>
        );
      })
      .catch((e) => {
        if (alive) setGames(<ErrorBox message="Could not load recent games." detail={e instanceof ApiError ? e.message : ''} />);
      });
    apiGet<QueueInfo[]>('/rbw/api/queues', { ttl: 15000 })
      .then((list) => {
        if (!alive) return;
        if (!list.length) {
          setQueues(<EmptyBox text="No queues configured." />);
          return;
        }
        setQueues(
          <Card>
            <DataTable
              headers={[
                { label: 'ELO range', align: 'num' }, { label: 'Mode' }, { label: 'Type' },
                { label: 'Players', align: 'num' }, { label: 'In queue' },
              ]}
              rows={list.map((q, i) => [
                <span key={`r${i}`} className="muted num">{formatNumber(q.minElo)}–{formatNumber(q.maxElo)}</span>,
                <Pill key={`m${i}`} text={q.isRanked ? 'Ranked' : 'Unranked'} tone={q.isRanked ? 'ok' : ''} />,
                <Pill key={`t${i}`} text={q.isPicking ? 'Picking' : 'Random'} />,
                <span key={`p${i}`} className="num">{q.playerCount}/{q.maxPlayers}</span>,
                <span key={`q${i}`} className="muted">{q.playerIGNs.length ? q.playerIGNs.join(', ') : 'Empty'}</span>,
              ])}
            />
          </Card>
        );
      })
      .catch((e) => {
        if (alive) setQueues(<ErrorBox message="Could not load queues." detail={e instanceof ApiError ? e.message : ''} />);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <div className="hero">
        <h1>Ranked Bedwars</h1>
        <p className="muted">ELO queues, live scoring and seasons — stats, recaps and leaderboards for every game.</p>
        <HeroSearch />
      </div>
      <div style={{ marginBottom: 28 }}>
        {stats ?? (
          <div className="stat-grid">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} width="100%" height="52px" style={{ gridColumn: 'span 1' }} />
            ))}
          </div>
        )}
      </div>
      <div className="grid-2">
        <div>
          <div className="section-title">Recent games</div>
          {games ?? (
            <div className="card"><SkeletonRows count={6} /></div>
          )}
        </div>
        <div>
          <div className="section-title">Live queues</div>
          {queues ?? (
            <div className="card"><SkeletonRows count={4} /></div>
          )}
        </div>
      </div>
    </>
  );
}
