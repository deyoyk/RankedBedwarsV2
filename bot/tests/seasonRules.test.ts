import { formatRuleSections } from '../src/utils/seasonRules';

describe('formatRuleSections', () => {
  it('turns the addon format into sections with per-section emojis', () => {
    const sections = formatRuleSections([
      '&d&l✦ ALWAYS ALLOWED',
      '&d▪ &fLadders',
      '&d▪ &fTNT',
      '',
      '&5&l✦ AFTER DIAMOND 3',
      '&5▪ &fInvis Potion',
      '',
      '&4&l✖ NEVER ALLOWED',
      '&4▪ &fBows',
      '&4▪ &fObsidian',
      '',
    ]);

    expect(sections).toEqual([
      { title: 'ALWAYS ALLOWED', emoji: '🟩', lines: ['Ladders', 'TNT'] },
      { title: 'AFTER DIAMOND 3', emoji: '🟨', lines: ['Invis Potion'] },
      { title: 'NEVER ALLOWED', emoji: '🟥', lines: ['Bows', 'Obsidian'] },
    ]);
  });

  it('reads the default config with colour-coded headings and dot bullets', () => {
    const sections = formatRuleSections([
      '&a&lAlways Allowed',
      '&a• &fLadders',
      '&a• &fBridge Eggs',
      '',
      '&e&lAfter Diamond 2',
      '&e• &fSpeed Boost Potion',
      '',
      '&c&lNever Allowed',
      '&c• &fBows',
    ]);

    expect(sections).toEqual([
      { title: 'Always Allowed', emoji: '🟩', lines: ['Ladders', 'Bridge Eggs'] },
      { title: 'After Diamond 2', emoji: '🟨', lines: ['Speed Boost Potion'] },
      { title: 'Never Allowed', emoji: '🟥', lines: ['Bows'] },
    ]);
  });

  it('keeps rules that have no heading under a plain list', () => {
    expect(formatRuleSections(['&fLadders', '&fTNT'])).toEqual([
      { title: 'Rules', emoji: '•', lines: ['Ladders', 'TNT'] },
    ]);
  });

  it('drops blank lines and headings without rules', () => {
    expect(formatRuleSections(['', '   ', '&a&lAlways Allowed', ''])).toEqual([]);
    expect(formatRuleSections([])).toEqual([]);
  });
});
