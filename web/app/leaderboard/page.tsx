'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatValue } from '@/lib/format';
import { MODES } from '@/lib/modes';
import { DataTable, EmptyBox, ErrorBox, ModeBar, Pager, PlayerLink, SkeletonRows } from '@/components/ui';

interface BoardData {
  [rank: string]: { ign: string; value: number | string };
}

function LeaderboardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const rawMode = params.get('mode') || '';
  const mode = MODES.includes(rawMode) ? rawMode : 'elo';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const [body, setBody] = useState<React.ReactNode>(null);

  useEffect(() => {
    let alive = true;
    apiGet<BoardData>(`/rbw/api/leaderboard?mode=${mode}&page=${page}`, { ttl: 60000 })
      .then((data) => {
        if (!alive) return;
        const entries = Object.entries(data || {})
          .map(([rank, v]) => ({ rank: parseInt(rank, 10), ign: v.ign, value: v.value }))
          .sort((a, b) => a.rank - b.rank);
        if (!entries.length) {
          setBody(<EmptyBox text="No players on this board yet." />);
          return;
        }
        setBody(
          <>
            <DataTable
              headers={[{ label: 'Rank', align: 'num' }, { label: 'Player' }, { label: mode, align: 'num' }]}
              rows={entries.map((e) => [
                <span key={`r${e.rank}`} className={`rank${e.rank <= 3 ? ' top' : ''}`}>{e.rank}</span>,
                <PlayerLink key={`p${e.rank}`} ign={e.ign} />,
                <span key={`v${e.rank}`} className="num">{formatValue(mode, e.value)}</span>,
              ])}
            />
            <Pager
              page={page}
              totalPages={page + 1}
              canPrev={page > 1}
              canNext={entries.length === 10}
              onPage={(p) => router.push(`/leaderboard?mode=${mode}&page=${Math.max(1, p)}`)}
            />
          </>
        );
      })
      .catch((e) => {
        if (alive) setBody(<ErrorBox message="Could not load leaderboard." detail={e instanceof Error ? e.message : ''} />);
      });
    return () => {
      alive = false;
    };
  }, [mode, page, router]);

  return (
    <>
      <div className="page-head">
        <h1>Leaderboards</h1>
        <div className="sub">Every stat, ranked. Click a mode to re-sort.</div>
      </div>
      <ModeBar modes={MODES} active={mode} hrefFor={(m) => `/leaderboard?mode=${m}&page=1`} />
      <div className="card">{body ?? <SkeletonRows count={12} />}</div>
    </>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense>
      <LeaderboardInner />
    </Suspense>
  );
}
