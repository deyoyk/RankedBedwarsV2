jest.mock('../src/models/Season', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../src/services/SeasonRulesService', () => ({
  __esModule: true,
  SeasonRulesService: { get: jest.fn() },
}));

import { ChatInputCommandInteraction } from 'discord.js';
import Season from '../src/models/Season';
import { SeasonRulesService } from '../src/services/SeasonRulesService';
import { seasoninfo } from '../src/commands/season/seasoninfo';

const seasonModel = Season as unknown as { findOne: jest.Mock };
const rulesService = SeasonRulesService as unknown as { get: jest.Mock };

const RULES = {
  season: [
    '&d&l✦ ALWAYS ALLOWED',
    '&d▪ &fLadders',
    '&d▪ &fTNT',
    '&5&l✦ AFTER DIAMOND 3',
    '&5▪ &fInvis Potion',
    '&4&l✖ NEVER ALLOWED',
    '&4▪ &fBows',
  ],
  ppp: [
    '&d&l✦ ALWAYS ALLOWED',
    '&d▪ &fLadders',
    '&5&l✦ AFTER DIAMOND 2',
    '&5▪ &fInvis Potion',
  ],
};

function mockInteraction(choice: string | null) {
  const reply = jest.fn();
  const collector = { on: jest.fn() };
  reply.mockResolvedValue({ createMessageComponentCollector: jest.fn(() => collector) });

  const interaction: any = Object.create(ChatInputCommandInteraction.prototype);
  const props = {
    options: { getString: jest.fn(() => choice) },
    user: { id: '123456789012345678' },
    replied: false,
    deferred: false,
    reply,
  };
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(interaction, key, { value, writable: true, configurable: true });
  }
  return { interaction, reply, collector };
}

function replyEmbed(reply: jest.Mock) {
  return reply.mock.calls[0][0].embeds[0].toJSON();
}

describe('seasoninfo', () => {
  beforeEach(() => {
    seasonModel.findOne.mockResolvedValue({ chapterNumber: 2, seasonNumber: 3, name: 'Test Season' });
    rulesService.get.mockResolvedValue(RULES);
  });

  it('shows the season rules by default', async () => {
    const { interaction, reply } = mockInteraction(null);

    await seasoninfo(interaction);

    const embed = replyEmbed(reply);
    expect(embed.fields[0]).toEqual({ name: 'Current Season', value: 'C 2 - S 3 Test Season', inline: false });
    expect(embed.fields.slice(1)).toEqual([
      { name: 'ALWAYS ALLOWED', value: '🟩 Ladders\n🟩 TNT', inline: false },
      { name: 'AFTER DIAMOND 3', value: '🟨 Invis Potion', inline: false },
      { name: 'NEVER ALLOWED', value: '🟥 Bows', inline: false },
    ]);
    expect(reply.mock.calls[0][0].components[0].toJSON().components[0].options[0].default).toBe(true);
  });

  it('switches the embed to the PPP rules when that option is picked', async () => {
    const { interaction, reply } = mockInteraction('ppp');

    await seasoninfo(interaction);

    const embed = replyEmbed(reply);
    expect(embed.fields.slice(1)).toEqual([
      { name: 'ALWAYS ALLOWED', value: '🟩 Ladders', inline: false },
      { name: 'AFTER DIAMOND 2', value: '🟨 Invis Potion', inline: false },
    ]);
  });

  it('edits the embed when the dropdown changes', async () => {
    const { interaction, collector } = mockInteraction('season');
    await seasoninfo(interaction);

    const handler = collector.on.mock.calls.find(call => call[0] === 'collect')[1];
    const update = jest.fn().mockResolvedValue(undefined);
    await handler({
      isStringSelectMenu: () => true,
      customId: 'seasoninfo_rules',
      values: ['ppp'],
      update,
    });

    const embed = update.mock.calls[0][0].embeds[0].toJSON();
    expect(embed.fields.slice(1).map((field: { name: string }) => field.name)).toEqual([
      'ALWAYS ALLOWED',
      'AFTER DIAMOND 2',
    ]);
  });

  it('reports an error until the server sends the rules', async () => {
    rulesService.get.mockResolvedValue(null);
    const { interaction, reply } = mockInteraction('season');

    await seasoninfo(interaction);

    expect(reply.mock.calls[0][0].embeds[0].toJSON().description).toContain('has not sent the season rules yet');
  });

  it('reports an error when the chosen ruleset is empty', async () => {
    rulesService.get.mockResolvedValue({ season: [], ppp: ['&c&lNever Allowed', '&c• &fBows'] });
    const { interaction, reply } = mockInteraction('season');

    await seasoninfo(interaction);

    expect(reply.mock.calls[0][0].embeds[0].toJSON().description).toContain('No season rules are set');
  });
});
