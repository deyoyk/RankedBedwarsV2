import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { SearchBox } from '@/components/SearchBox';
import { ApiStatus } from '@/components/ApiStatus';
import { NavLinks } from '@/components/NavLinks';

export const metadata: Metadata = {
  title: 'Ranked Bedwars',
  description: 'Ranked Bedwars stats, game recaps, leaderboards and player comparisons.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23000'/%3E%3Ctext x='16' y='22' font-family='monospace' font-size='13' font-weight='700' fill='%23fff' text-anchor='middle'%3ERBW%3C/text%3E%3C/svg%3E" />
        <script src="/config.js" />
      </head>
      <body>
        <header className="nav">
          <div className="nav-inner">
            <Link className="brand" href="/">
              <span className="brand-mark">RBW</span>
              <span className="brand-name">Ranked Bedwars</span>
            </Link>
            <nav className="nav-links">
              <NavLinks />
            </nav>
            <div id="search" className="nav-search">
              <SearchBox />
            </div>
          </div>
        </header>
        <main id="main" className="main" aria-live="polite">
          {children}
        </main>
        <footer className="footer">
          <div className="footer-inner">
            <span>Ranked Bedwars</span>
            <ApiStatus />
          </div>
        </footer>
      </body>
    </html>
  );
}
