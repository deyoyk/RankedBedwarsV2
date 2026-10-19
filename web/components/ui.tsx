import Link from 'next/link';
import React from 'react';

export function Skeleton({ width = '100%', height = '16px', style }: { width?: string; height?: string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width, height, ...style }} />;
}

export function SkeletonRows({ count, height = '18px' }: { count: number; height?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} width="100%" height={height} />
      ))}
    </div>
  );
}

export function ErrorBox({ message, detail = '' }: { message: string; detail?: string }) {
  return (
    <div className="error-box">
      <h2>{message}</h2>
      {detail ? <p className="muted">{detail}</p> : null}
    </div>
  );
}

export function EmptyBox({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

export function PlayerLink({ ign, children }: { ign: string; children?: React.ReactNode }) {
  return <Link href={`/player?query=${encodeURIComponent(ign)}`}>{children ?? ign}</Link>;
}

export function Pill({ text, tone = '' }: { text: string; tone?: string }) {
  return <span className={`pill${tone ? ' ' + tone : ''}`}>{text}</span>;
}

export function StatCell({ label, value, tone = '' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="stat-cell">
      <div className="label">{label}</div>
      <div className={`value ${tone}`}>{value}</div>
    </div>
  );
}

export function Card({ title, actions, children }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  const showHead = (title !== null && title !== undefined) || actions !== null && actions !== undefined;
  return (
    <div className="card">
      {showHead ? (
        <div className="card-head">
          <span>{title}</span>
          {actions || null}
        </div>
      ) : null}
      <div className="card-body">{children}</div>
    </div>
  );
}

export interface TableHeader {
  label: string;
  align?: 'num';
}

export function DataTable({ headers, rows }: { headers: TableHeader[]; rows: React.ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={h.align === 'num' ? 'num' : ''}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={headers[j]?.align === 'num' ? 'num' : j === 0 ? 'rank' : ''}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, totalPages, onPage, canPrev, canNext }: {
  page: number; totalPages: number; onPage: (p: number) => void; canPrev: boolean; canNext: boolean;
}) {
  return (
    <div className="pager">
      <button className="btn" disabled={!canPrev} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="info">Page {page} of {totalPages || 1}</span>
      <button className="btn" disabled={!canNext} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

export function ModeBar({ modes, active, hrefFor }: { modes: string[]; active: string; hrefFor: (m: string) => string }) {
  return (
    <div className="mode-bar">
      {modes.map((m) => (
        <Link key={m} href={hrefFor(m)} className={m === active ? 'active' : ''}>{m}</Link>
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 560, height = 72 }: { values: number[]; width?: number; height?: number }) {
  const pad = 4;
  const gradId = React.useId().replace(/:/g, '');
  if (!values || values.length < 2) {
    return <div className="muted" style={{ height, display: 'flex', alignItems: 'center', fontSize: 12.5 }}>Not enough data yet</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0070f3" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0070f3" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M ${area} Z`} fill={`url(#${gradId})`} />
      <polyline points={line} fill="none" stroke="#0070f3" strokeWidth="1.5" />
    </svg>
  );
}
