jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: { bot_stats_text: 'Test Server', serverName: 'Test Server' },
}));
jest.mock('../src/utils/releaseVersion', () => ({
  getReleaseVersion: jest.fn().mockResolvedValue('v41'),
}));

import { help } from '../src/commands/help';

function interaction() {
  return {
    id: 'interaction-help',
    user: { id: '123456789012345678' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild-1' },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

describe('help command version and server name', () => {
  it('shows the GitHub release version and configured server name', async () => {
    const target = interaction();

    await help(target);

    const payload = target.reply.mock.calls[0][0];
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toBe('Info: Ranked Bedwars System v41');
    expect(embed.description).toContain('Made by <@1526597163885527121> `Deyo` for `Test Server`');
    expect(embed.description).toContain('Select a category to view commands and their required roles.');
    expect(embed.description).not.toContain(':star2:');
    expect(embed.description).not.toContain('2.5.0');
    expect(embed.footer?.text).toBe('Test Server');
  });
});
