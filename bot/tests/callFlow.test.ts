jest.mock('../src/models/User', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../src/services/CallControl', () => {
  const actual = jest.requireActual('../src/services/CallControl');
  return {
    ...actual,
    findCall: jest.fn(),
    findTeamCall: jest.fn(),
    addToCall: jest.fn(async () => ({ ok: true, message: 'added' })),
    removeFromCall: jest.fn(async () => ({ ok: true, message: 'removed' })),
    openCall: jest.fn(async () => ({ ok: true, message: 'opened' })),
    closeCall: jest.fn(async () => ({ ok: true, message: 'closed' })),
    muteInCall: jest.fn(async () => ({ ok: true, message: 'muted' })),
    unmuteInCall: jest.fn(async () => ({ ok: true, message: 'unmuted' })),
  };
});

import { CallFlow, neededVotes } from '../src/services/CallFlow';

const User = require('../src/models/User').default;
const control = require('../src/services/CallControl');

const IGNS: Record<string, string> = { t1: 'Teammate1', t2: 'Teammate2', t3: 'Teammate3', t4: 'Teammate4', u1: 'User1', w: 'wuwah' };
const sentToServer: any[] = [];
let channelPosts: any[];
let dms: Record<string, any[]>;

function ctxFor(team: string[]) {
  channelPosts = [];
  dms = {};
  const members = new Map(Object.keys(IGNS).map(id => [id, { send: jest.fn(async (p: any) => { (dms[id] ??= []).push(p); return { edit: jest.fn().mockResolvedValue(undefined) }; }) }]));
  const voice = { id: 'vc1', send: jest.fn(async (p: any) => { channelPosts.push(p); return { edit: jest.fn().mockResolvedValue(undefined) }; }) };
  return { guild: { members: { cache: members } } as any, voice, game: { gameId: 1, team1: team, team2: ['x'], channels: { team1Voice: 'vc1', team2Voice: 'vc2' } }, requesterId: team[0] };
}

const lastServer = () => sentToServer.at(-1);
const embedText = (post: any) => post.embeds[0].toJSON().description as string;

beforeEach(() => {
  sentToServer.length = 0;
  CallFlow.notifier = () => ({ send: (p: object) => { sentToServer.push(p); } });
  User.find.mockImplementation(({ discordId }: any) => ({ select: () => ({ lean: () => Promise.resolve(
    discordId.$in.map((id: string) => ({ discordId: id, ign: IGNS[id] }))) }) }));
});

describe('how many approvals a request needs', () => {
  test('open needs the whole team, close and unmute one more, the rest one', () => {
    expect(neededVotes('open', 4)).toBe(4);
    expect(neededVotes('close', 4)).toBe(2);
    expect(neededVotes('unmute', 4)).toBe(2);
    expect(neededVotes('close', 1)).toBe(1);
    expect(neededVotes('request', 4)).toBe(1);
  });
});

describe('/call open', () => {
  test('asks the whole team with a vote, and opens once everyone approved', async () => {
    const ctx = ctxFor(['t1', 't2', 't3', 't4']);
    control.findCall.mockResolvedValue(ctx);
    const result = await CallFlow.run(ctx.guild, 't1', 'open', { tier: 'pups' });
    expect(result.message).toContain('(1/4)');
    expect(lastServer()).toMatchObject({ type: 'call_alert', recipients: ['Teammate1', 'Teammate2', 'Teammate3', 'Teammate4'],
      text: 'Teammate1 has requested to open the voice channel to Pups, Pugs Trial, Pugs, Premium.', count: 1, needed: 4 });
    expect(embedText(channelPosts[0])).toContain('<@t1> has requested to open');
    const voteId = lastServer().vote_id;
    expect(channelPosts[0].components[0].toJSON().components[0].custom_id).toBe(`call:vote:${voteId}`);
    expect((await CallFlow.vote(voteId, 'x')).ok).toBe(false);
    expect((await CallFlow.vote(voteId, 't1')).ok).toBe(false);
    await CallFlow.vote(voteId, 't2');
    await CallFlow.vote(voteId, 't3');
    expect(control.openCall).not.toHaveBeenCalled();
    await CallFlow.vote(voteId, 't4');
    expect(control.openCall).toHaveBeenCalledWith(ctx, 'pups');
    expect(lastServer().text).toContain('is open to');
    expect((await CallFlow.vote(voteId, 't2')).ok).toBe(false);
  });
});

describe('/call close', () => {
  test('needs one more vote', async () => {
    const ctx = ctxFor(['t1', 't2']);
    control.findCall.mockResolvedValue(ctx);
    await CallFlow.run(ctx.guild, 't1', 'close');
    expect(lastServer()).toMatchObject({ text: 'Teammate1 has requested to close the voice channel and kick all outsiders.', count: 1, needed: 2 });
    await CallFlow.vote(lastServer().vote_id, 't2');
    expect(control.closeCall).toHaveBeenCalled();
  });
});

describe('/call add and remove', () => {
  test('happen at once and tell the team, pinging the user, with (suppressed) when muted', async () => {
    const ctx = ctxFor(['t1', 't2']);
    control.findCall.mockResolvedValue(ctx);
    await CallFlow.run(ctx.guild, 't1', 'add', { targetId: 'u1', muted: true });
    expect(lastServer()).toMatchObject({ text: 'Teammate1 has added User1 to the voice channel.', note: '(suppressed)', vote_id: null, recipients: ['Teammate1', 'Teammate2'] });
    expect(channelPosts[0].content).toBe('<@u1>');
    await CallFlow.run(ctx.guild, 't2', 'remove', { targetId: 'u1' });
    expect(lastServer().text).toBe('Teammate2 has removed User1 from the voice channel.');
  });
});

describe('/call mute', () => {
  test('from a teammate who did not add them only asks the one who did', async () => {
    const ctx = ctxFor(['t1', 't2']);
    control.findCall.mockResolvedValue(ctx);
    await CallFlow.run(ctx.guild, 't1', 'add', { targetId: 'u1' });
    channelPosts.length = 0;
    const result = await CallFlow.run(ctx.guild, 't2', 'mute', { targetId: 'u1' });
    expect(result.message).toContain('Requested <@t1>');
    const asks = sentToServer.slice(-2);
    expect(asks[0]).toMatchObject({ recipients: ['Teammate1'], text: 'Teammate2 is requesting to mute User1.', needed: 1 });
    expect(asks[1]).toMatchObject({ recipients: ['Teammate2'], text: 'Requested Teammate1 to mute User1.', vote_id: null });
    expect(channelPosts).toHaveLength(0);
    expect(dms.t1).toHaveLength(1);
    await CallFlow.vote(asks[0].vote_id, 't1');
    expect(control.muteInCall).toHaveBeenCalledWith(ctx, 'u1');
  });

  test('from the one who added them is instant', async () => {
    const ctx = ctxFor(['t1', 't2']);
    control.findCall.mockResolvedValue(ctx);
    await CallFlow.run(ctx.guild, 't1', 'add', { targetId: 'u1' });
    control.muteInCall.mockClear();
    await CallFlow.run(ctx.guild, 't1', 'mute', { targetId: 'u1' });
    expect(control.muteInCall).toHaveBeenCalledTimes(1);
  });
});

describe('/call request', () => {
  test('asks the named player and their whole team, and one approval lets them in muted', async () => {
    const ctx = ctxFor(['w', 't2', 't3']);
    ctx.requesterId = 'u1';
    control.findTeamCall.mockResolvedValue(ctx);
    await CallFlow.run(ctx.guild, 'u1', 'request', { targetId: 'w' });
    expect(lastServer()).toMatchObject({ recipients: ['wuwah', 'Teammate2', 'Teammate3'], text: 'User1 has requested to join your voice channel.', count: 0, needed: 1 });
    await CallFlow.vote(lastServer().vote_id, 't3');
    expect(control.addToCall).toHaveBeenCalledWith(ctx, 'u1', true);
    expect(lastServer()).toMatchObject({ note: '(suppressed)', recipients: ['wuwah', 'Teammate2', 'Teammate3', 'User1'] });
  });
});
