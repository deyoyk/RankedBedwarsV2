import config from '../src/config/config';
import { register } from '../src/commands/account/register';
import { forceregister } from '../src/commands/account/forceregister';
import { forcerename } from '../src/commands/account/forcerename';
import { unregister } from '../src/commands/account/unregister';
import { nick } from '../src/commands/account/nick';
import { addelo } from '../src/commands/account/addelo';
import { removeelo } from '../src/commands/account/removeelo';
import { wipe } from '../src/commands/account/wipe';
import { gameinfo } from '../src/commands/general/gameinfo';
import { ban } from '../src/commands/moderation/ban';
import { history } from '../src/commands/moderation/history';
import { ssclose } from '../src/commands/moderation/ssclose';
import { party } from '../src/commands/queue/party';
import { call } from '../src/commands/queue/call';
import { addqueue } from '../src/commands/queue/addqueue';
import { removequeue } from '../src/commands/queue/removequeue';
import { queuecontrol } from '../src/commands/queue/queuecontrol';
import { score } from '../src/commands/scoring/score';
import { lose } from '../src/commands/scoring/lose';
import { voidGame } from '../src/commands/scoring/void';
import { edit } from '../src/commands/scoring/edit';
import { strikerequest } from '../src/commands/scoring/strikerequest';
import { voidrequest } from '../src/commands/scoring/voidrequest';
import { startseason } from '../src/commands/season/startseason';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../src/models/Season', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));

function message() {
  return {
    content: '',
    author: { id: '999000000000000001' },
    member: null,
    guild: { id: 'guild1' },
    channel: { id: 'chan1' },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

const wsManager = { send: jest.fn() } as any;

type CaseFn = (interaction: any, args?: string[]) => Promise<unknown>;
const CASES: Array<[string, CaseFn]> = [
  ['register', (i, a) => register(i, a, wsManager)],
  ['forceregister', (i, a) => forceregister(i, a)],
  ['forcerename', (i, a) => forcerename(i, a)],
  ['unregister', (i, a) => unregister(i, a)],
  ['nick', (i, a) => nick(i, a)],
  ['addelo', (i, a) => addelo(i, a)],
  ['removeelo', (i, a) => removeelo(i, a)],
  ['wipe', (i, a) => wipe(i, a)],
  ['gameinfo', (i, a) => gameinfo(i, a)],
  ['ban', (i, a) => ban(i, a)],
  ['history', (i, a) => history(i, a)],
  ['ssclose', (i, a) => ssclose(i, a)],
  ['party', (i, a) => party(i, a)],
  ['call', (i, a) => call(i, a)],
  ['addqueue', (i, a) => addqueue(i, a)],
  ['removequeue', (i, a) => removequeue(i, a)],
  ['queuecontrol', (i, a) => queuecontrol(i, a)],
  ['score', (i, a) => score(i, a)],
  ['lose', (i, a) => lose(i, a)],
  ['void', (i, a) => voidGame(i, a)],
  ['edit', (i, a) => edit(i, a)],
  ['strikerequest', (i, a) => strikerequest(i, a)],
  ['voidrequest', (i, a) => voidrequest(i, a)],
  ['startseason', (i, a) => startseason(i, a)],
];

describe('usage strings follow the configured prefix', () => {
  const OLD = (config as any).prefix;
  afterEach(() => { (config as any).prefix = OLD; });

  it.each(CASES)('%s usage uses the env prefix', async (name: string, fn: CaseFn) => {
      (config as any).prefix = '$';
      const interaction = message();
      await fn(interaction, []);
      expect(interaction.reply).toHaveBeenCalled();
      const text = JSON.stringify(interaction.reply.mock.calls.flat());
      expect(text).toContain('$' + name);
      expect(text).not.toContain('=' + name);
    }
  );

  it('modCommands usage uses the env prefix', async () => {
    (config as any).prefix = '$';
    const { executeModerationAction } = await import('../src/utils/modCommands');
    const interaction = message();
    await executeModerationAction(interaction, [], {
      commandName: 'ban',
      actionVerb: 'Banned',
      hasDuration: true,
      managerCall: jest.fn(),
    });
    const text = JSON.stringify(interaction.reply.mock.calls.flat());
    expect(text).toContain('$ban');
    expect(text).not.toContain('=ban');
  });

  it('stats usage uses the env prefix for registered users', async () => {
    (config as any).prefix = '$';
    const { stats } = await import('../src/commands/stats/stats');
    const UserModel = require('../src/models/User').default;
    UserModel.findOne.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ discordId: '999000000000000001', ign: 'Steve' }),
      }),
    }));
    try {
      const interaction = message();
      await stats(interaction, []);
      expect(interaction.reply).toHaveBeenCalled();
      const text = JSON.stringify(interaction.reply.mock.calls.flat());
      expect(text).toContain('$stats');
      expect(text).not.toContain('=stats');
    } finally {
      UserModel.findOne.mockResolvedValue(null);
    }
  });
});
