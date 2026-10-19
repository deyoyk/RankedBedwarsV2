'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatDate, formatNumber, formatValue } from '@/lib/format';
import { DataTable, EmptyBox, ErrorBox, ModeBar, Pager, PlayerLink, Pill, SkeletonRows } from '@/components/ui';
import { MODES } from '@/lib/modes';

interface SeasonRow {
  seasonNumber: number;
  chapterNumber: number;
  name: string;
  isActive: boolean;
  startDate: string;
  endDate?: string | null;
}

function SeasonsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const season = params.get('s') || '';
  const chapter = params.get('c') || '';
  const [body, setBody] = useState<React.ReactNode>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!season || !chapter) {
        try {
          const seasons = await apiGet<SeasonRow[]>('/rbw/api/seasons', { ttl: 60000 });
          if (!alive) return;
          if (!seasons.length) {
            setBody(<EmptyBox text="No seasons yet." />);
            return;
          }
          setBody(
            <DataTable
              headers={[
                { label: 'Season' }, { label: 'Name' }, { label: 'Status' },
                { label: 'Started' }, { label: 'Ended' }, { label: '' },
              ]}
              rows={seasons.map((s, i) => [
                <span key={`s${i}`} className="num">{s.seasonNumber}.{s.chapterNumber}</span>,
                <span key={`n${i}`}>{s.name}</span>,
                s.isActive ? <Pill key={`a${i}`} text="Active" tone="ok" /> : <span key={`a${i}`}>—</span>,
                <span key={`st${i}`} className="muted">{formatDate(s.startDate)}</span>,
                <span key={`e${i}`} className="muted">{s.endDate ? formatDate(s.endDate) : '—'}</span>,
                <span key={`l${i}`}>
                  <a href={`/seasons?s=${s.seasonNumber}&c=${s.chapterNumber}&mode=elo&page=1`}>Leaderboard</a>
                </span>,
              ])}
            />
          );
        } catch (e) {
          if (alive) setBody(<ErrorBox message="Could not load seasons." detail={e instanceof Error ? e.message : ''} />);
        }
        return;
      }

      const rawMode = params.get('mode') || '';
      const mode = MODES.includes(rawMode) ? rawMode : 'elo';
      const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
      try {
        const data = await apiGet<Record<string, { ign: string; value: number | string }>>(
          `/rbw/api/seasons/${season}/${chapter}/leaderboard?mode=${mode}&page=${page}`, { ttl: 60000 });
        if (!alive) return;
        const entries = Object.entries(data || {})
          .map(([rank, v]) => ({ rank: parseInt(rank, 10), ign: v.ign, value: v.value }))
          .sort((x, y) => x.rank - y.rank);
        if (!entries.length) {
          setBody(<EmptyBox text="No entries in this season yet." />);
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
              onPage={(p) => router.push(`/seasons?s=${season}&c=${chapter}&mode=${mode}&page=${Math.max(1, p)}`)}
            />
          </>
        );
      } catch (e) {
        if (alive) setBody(<ErrorBox message="Could not load season leaderboard." detail={e instanceof Error ? e.message : ''} />);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [season, chapter, params, router]);

  if (!season || !chapter) {
    return (
      <>
        <div className="page-head">
          <h1>Seasons</h1>
          <div className="sub">Season snapshots and their leaderboards.</div>
        </div>
        <div className="card">{body ?? <SkeletonRows count={6} />}</div>
      </>
    );
  }

  const rawMode = params.get('mode') || '';
  const mode = MODES.includes(rawMode) ? rawMode : 'elo';
  return (
    <>
      <div className="page-head">
        <h1>Season {season}.{chapter}</h1>
        <div className="sub">Season snapshot leaderboard.</div>
      </div>
      <ModeBar modes={MODES} active={mode} hrefFor={(m) => `/seasons?s=${season}&c=${chapter}&mode=${m}&page=1`} />
      <div className="card">{body ?? <SkeletonRows count={12} />}</div>
    </>
  );
}

export default function SeasonsPage() {
  return (
    <Suspense>
      <SeasonsInner />
    </Suspense>
  );
}
