jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: { strikes: { 1: 'warn', 2: '2h', 3: '12h', default: '48h' } },
}));
jest.mock('../src/models/StrikeRules', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn() },
}));
jest.mock('../src/services/PermissionService', () => ({
  PermissionService: { current: () => ({ admin: [], staff: [], player: [], playerEveryone: true }), rolesFor: () => [] },
}));

import { actionFor, checkAction, defaultsFromConfig, describeAction, StrikeRuleService } from '../src/services/StrikeRuleService';
import { saveStrikeModal, strikeView } from '../src/commands/general/rbwconfig';

const StrikeRules = require('../src/models/StrikeRules').default;

beforeEach(async () => {
  StrikeRules.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
  StrikeRules.updateOne.mockResolvedValue({});
  await StrikeRuleService.load('guild');
});

const text = (view: ReturnType<typeof strikeView>) => view.embeds[0].toJSON().description as string;

describe('strike rules', () => {
  test('start from the .env values until they are changed', () => {
    expect(StrikeRuleService.current()).toEqual(defaultsFromConfig({ 1: 'warn', 2: '2h', 3: '12h', default: '48h' }));
    expect(StrikeRuleService.actionFor(1)).toBe('warn');
    expect(StrikeRuleService.actionFor(3)).toBe('12h');
    expect(StrikeRuleService.actionFor(9)).toBe('48h');
  });

  test('a rule is the total number of strikes, and anything else uses the catch-all', () => {
    const settings = { rules: [{ strikes: 5, action: 'perm' }], otherwise: 'warn' };
    expect(actionFor(settings, 5)).toBe('perm');
    expect(actionFor(settings, 4)).toBe('warn');
    expect(actionFor(settings, 6)).toBe('warn');
  });

  test('only warn or a ban time of at least a minute can be saved', () => {
    expect(checkAction(' WARN ')).toBe('warn');
    expect(checkAction('7d')).toBe('7d');
    expect(checkAction('perm')).toBe('perm');
    expect(() => checkAction('soon')).toThrow();
    expect(() => checkAction('30s')).toThrow();
    expect(describeAction('perm')).toBe('permanent rank ban');
    expect(describeAction('7d')).toBe('rank ban for 7d');
    expect(describeAction('warn')).toBe('warning only');
  });

  test('adding, changing and removing rules is saved for the server', async () => {
    await StrikeRuleService.setRule(5, '30d');
    await StrikeRuleService.setRule(2, '6h');
    expect(StrikeRuleService.actionFor(5)).toBe('30d');
    expect(StrikeRuleService.actionFor(2)).toBe('6h');
    await StrikeRuleService.removeRules([5]);
    expect(StrikeRuleService.actionFor(5)).toBe('48h');
    expect(StrikeRules.updateOne).toHaveBeenLastCalledWith({ guildId: 'guild' },
      { $set: { rules: [{ strikes: 1, action: 'warn' }, { strikes: 2, action: '6h' }, { strikes: 3, action: '12h' }], otherwise: '48h' } },
      { upsert: true });
  });

  test('saved rules are loaded on start, sorted by strikes', async () => {
    StrikeRules.findOne.mockReturnValue({ lean: () => Promise.resolve({ rules: [{ strikes: 4, action: 'perm' }, { strikes: 2, action: '1d' }], otherwise: 'warn' }) });
    await StrikeRuleService.load('guild');
    expect(StrikeRuleService.current().rules.map(r => r.strikes)).toEqual([2, 4]);
    expect(StrikeRuleService.actionFor(3)).toBe('warn');
  });
});

describe('the /rbwconfig strike rules page', () => {
  test('lists every rule and the catch-all', () => {
    const view = strikeView();
    expect(text(view)).toContain('**2 strikes** → rank ban for 2h');
    expect(text(view)).toContain('**Any other number** → rank ban for 48h');
    const ids = view.components.flatMap(row => row.toJSON().components.map((c: any) => c.custom_id));
    expect(ids).toEqual(['rbwcfg:strikedel', 'rbwcfg:strikeadd', 'rbwcfg:strikeelse', 'rbwcfg:back']);
  });

  test('a form adds a rule or says why it could not', async () => {
    expect(text(await saveStrikeModal('strikeadd', '6', 'perm'))).toContain('6 strikes → permanent rank ban');
    expect(StrikeRuleService.actionFor(6)).toBe('perm');
    expect(text(await saveStrikeModal('strikeadd', 'six', '1d'))).toContain('⚠');
    expect(text(await saveStrikeModal('strikeelse', '', 'warn'))).toContain('Any other number → warning only');
  });
});
