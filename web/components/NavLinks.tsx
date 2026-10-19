'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';

const NAV = [
  { href: '/leaderboard?mode=elo&page=1', label: 'Leaderboards', key: 'leaderboard' },
  { href: '/games', label: 'Games', key: 'games' },
  { href: '/seasons', label: 'Seasons', key: 'seasons' },
  { href: '/compare', label: 'Compare', key: 'compare' },
];

function NavLinksInner() {
  const pathname = usePathname();
  const seg = pathname.split('/')[1] || 'home';
  return (
    <>
      {NAV.map((item) => (
        <Link key={item.key} href={item.href} data-nav={item.key} className={item.key === seg ? 'active' : ''}>
          {item.label}
        </Link>
      ))}
    </>
  );
}

export function NavLinks() {
  return (
    <Suspense>
      <NavLinksInner />
    </Suspense>
  );
}
