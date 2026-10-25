'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatValue } from '@/lib/format';
import { EmptyBox, ErrorBox, PlayerLink, SkeletonRows } from '@/components/ui';

const STATS: Array<[string, string]> = [
  ['elo', 'Elo'], ['wins', 'Wins'], ['losses', 'Losses'], ['kills', 'Kills'],
  ['deaths', 'Deaths'], ['kdr', 'KDR'], ['wlr', 'WLR'], ['level', 'Level'],
  ['mvps', 'MVPs'], ['bedBroken', 'Beds broken'], ['finalKills', 'Final kills'],
  ['finalDeaths', 'Final deaths'], ['games', 'Games'], ['winStreak', 'Winstreak'],
  ['loseStreak', 'Losestreak'], ['peakElo', 'Peak elo'], ['playtimeSeconds', 'Playtime'],
];

const LOSER_STATS = new Set(['losses', 'deaths', 'finalDeaths', 'loseStreak']);

function CompareInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [a, setA] = useState(() => params.get('a') || '');
  const [b, setB] = useState(() => params.get('b') || '');
  const [body, setBody] = useState<React.ReactNode>(
    <div className="card"><EmptyBox text="Enter two players to compare." /></div>
  );

  const load = useCallback(async (qa: string, qb: string) => {
    setBody(
      <div className="card"><SkeletonRows count={10} /></div>
    );
    try {
      const [o1, o2] = await Promise.all([
        apiGet<{ profile: Record<string, unknown> }>(`/rbw/api/user/${encodeURIComponent(qa)}/overview`, { ttl: 30000 }),
        apiGet<{ profile: Record<string, unknown> }>(`/rbw/api/user/${encodeURIComponent(qb)}/overview`, { ttl: 30000 }),
      ]);
      const p1 = o1.profile;
      const p2 = o2.profile;
      const rows = STATS.map(([key, label]) => {
        const v1 = p1[key] as number;
        const v2 = p2[key] as number;
        let winnerClass = '';
        if (LOSER_STATS.has(key)) {
          if (v1 < v2) winnerClass = 'winner-a';
          else if (v2 < v1) winnerClass = 'winner-b';
        } else {
          if (v1 > v2) winnerClass = 'winner-a';
          else if (v2 > v1) winnerClass = 'winner-b';
        }
        return (
          <div key={key} className={`compare-row ${winnerClass}`}>
            <span className="a num">{formatValue(key, v1)}</span>
            <span className="mid">{label}</span>
            <span className="b num">{formatValue(key, v2)}</span>
          </div>
        );
      });
      setBody(
        <>
          <div className="compare-row" style={{ borderBottom: '1px solid var(--border)', padding: '14px 16px', fontWeight: 600 }}>
            <span><PlayerLink ign={String(p1.ign)} /></span>
            <span className="mid muted">player</span>
            <span><PlayerLink ign={String(p2.ign)} /></span>
          </div>
          {rows}
          <div className="muted" style={{ padding: '12px 16px', fontSize: 12.5 }}>
            Green side leads each stat.
          </div>
        </>
      );
    } catch (e) {
      setBody(<div className="card"><ErrorBox message="Comparison failed." detail={e instanceof Error ? e.message : ''} /></div>);
    }
  }, []);

  useEffect(() => {
    const qa = params.get('a') || '';
    const qb = params.get('b') || '';
    if (qa && qb) {
      setA(qa);
      setB(qb);
      load(qa, qb);
    }
  }, [params, load]);

  function submit() {
    const av = a.trim();
    const bv = b.trim();
    if (av && bv) router.push(`/compare?a=${encodeURIComponent(av)}&b=${encodeURIComponent(bv)}`);
  }

  return (
    <>
      <div className="page-head">
        <h1>Compare</h1>
        <div className="sub">Two players, head to head.</div>
      </div>
      <div className="grid-2" style={{ marginBottom: 20 }}>
        <input
          className="search-input"
          placeholder="Player A (discord id or IGN)"
          value={a}
          onChange={(e) => setA(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <input
          className="search-input"
          placeholder="Player B (discord id or IGN)"
          value={b}
          onChange={(e) => setB(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      {body}
    </>
  );
}

export default function ComparePage() {
  return (
    <Suspense>
      <CompareInner />
    </Suspense>
  );
}
