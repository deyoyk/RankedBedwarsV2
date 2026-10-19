import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="error-box">
      <h2>Page not found</h2>
      <p>The page you are looking for does not exist.</p>
      <p style={{ marginTop: 12 }}>
        <Link href="/">← Back home</Link>
      </p>
    </div>
  );
}
