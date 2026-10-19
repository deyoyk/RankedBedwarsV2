'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { apiGet } from '@/lib/api';
import { formatNumber } from '@/lib/format';

interface SearchHit {
  discordId: string;
  ign: string;
  elo: number;
}

function SearchBoxInner() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const results = await apiGet<SearchHit[]>(`/rbw/api/search/users?query=${encodeURIComponent(q)}&limit=6`, { ttl: 15000 });
        if (seq !== seqRef.current) return;
        if (!Array.isArray(results) || results.length === 0) {
          setHits([]);
          setOpen(false);
          return;
        }
        setHits(results);
        setOpen(true);
      } catch {
        setHits([]);
        setOpen(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  function go(query: string) {
    const q = query.trim();
    if (q.length < 2) return;
    setOpen(false);
    router.push(`/player?query=${encodeURIComponent(q)}`);
  }

  return (
    <div ref={boxRef}>
      <input
        className="search-input"
        type="search"
        placeholder="Search player…"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Enter') go(value);
        }}
      />
      {open ? (
        <div className="search-results">
          {hits.map((r) => (
            <Link key={r.discordId} href={`/player?query=${encodeURIComponent(r.discordId)}`} onClick={() => setOpen(false)}>
              <span>{r.ign}</span>
              <span className="muted">{formatNumber(r.elo)} elo</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SearchBox() {
  const pathname = usePathname();
  return (
    <Suspense>
      <SearchBoxInner key={pathname} />
    </Suspense>
  );
}
