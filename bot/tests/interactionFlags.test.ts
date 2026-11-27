import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '../src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('interaction response flags', () => {
  it('does not pass the deprecated ephemeral option to interaction replies', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /\bephemeral\s*:\s*(true|false)\b/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));

    expect(offenders).toEqual([]);
  });
});
