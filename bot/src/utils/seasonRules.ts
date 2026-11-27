export interface RuleSection {
  title: string;
  emoji: string;
  lines: string[];
}

const COLOR_CODE = /&[0-9a-fk-or]/gi;
const BULLET = /^[▪•\-*]\s*/u;
const HEADING_MARK = /^[✦✖★\s]+/u;
const BOLD = /&l/i;

function plain(line: string): string {
  return line.replace(COLOR_CODE, '').trim();
}

function emojiFor(title: string): string {
  if (/never|banned/i.test(title)) return '🟥';
  if (/always/i.test(title)) return '🟩';
  return '🟨';
}

function addLine(sections: RuleSection[], current: RuleSection | null, line: string): RuleSection {
  if (current) {
    current.lines.push(line);
    return current;
  }
  const section = { title: 'Rules', emoji: '•', lines: [line] };
  sections.push(section);
  return section;
}

export function formatRuleSections(rules: string[]): RuleSection[] {
  const sections: RuleSection[] = [];
  let current: RuleSection | null = null;
  for (const rule of rules) {
    const text = plain(rule);
    if (!text) continue;
    if (BULLET.test(text)) {
      current = addLine(sections, current, text.replace(BULLET, ''));
      continue;
    }
    if (BOLD.test(rule) || /[✦✖]/.test(text)) {
      current = { title: text.replace(HEADING_MARK, ''), emoji: emojiFor(text), lines: [] };
      sections.push(current);
      continue;
    }
    current = addLine(sections, current, text);
  }
  return sections.filter(section => section.lines.length > 0);
}
