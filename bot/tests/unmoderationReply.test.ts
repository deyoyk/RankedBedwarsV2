import { executeUnmoderationAction } from '../src/utils/modCommands';

const replies: any[] = [];
jest.mock('../src/utils/safeReply', () => ({ safeReply: jest.fn(async (_i: unknown, r: unknown) => { replies.push(r); }) }));

beforeEach(() => { replies.length = 0; });

function interaction(reason: string | null = null) {
  return {
    guild: { id: 'g' },
    user: { id: 'mod' },
    options: { getUser: () => ({ id: '123' }), getString: (name: string) => (name === 'reason' ? reason : null) },
  };
}

function text(reply: any): string {
  return JSON.stringify(reply);
}

describe('unban / unmute replies', () => {
  it('says the player is not banned instead of claiming an unban', async () => {
    const i = interaction();
    await executeUnmoderationAction(i as any, {
      commandName: 'unban',
      actionVerb: 'Unbanned',
      activeWord: 'banned',
      managerCall: async () => false,
    });
    expect(replies).toHaveLength(1);
    expect(text(replies[0])).toContain("isn't banned");
    expect(text(replies[0])).not.toContain('Unbanned <@');
  });

  it('confirms the unban when the player was banned', async () => {
    const i = interaction();
    await executeUnmoderationAction(i as any, {
      commandName: 'unban',
      actionVerb: 'Unbanned',
      activeWord: 'banned',
      managerCall: async () => true,
    });
    expect(text(replies[0])).toContain('Unbanned <@123>');
  });

  it('passes the optional reason on and shows it', async () => {
    const managerCall = jest.fn(async () => true);
    await executeUnmoderationAction(interaction('appeal accepted') as any, {
      commandName: 'unban', actionVerb: 'Unbanned', activeWord: 'banned', managerCall,
    });
    expect(managerCall).toHaveBeenCalledWith({ id: 'g' }, '123', 'mod', 'appeal accepted');
    expect(text(replies[0])).toContain('appeal accepted');
  });

  it('leaves the reason out when none is given', async () => {
    const managerCall = jest.fn(async () => true);
    await executeUnmoderationAction(interaction() as any, {
      commandName: 'unban', actionVerb: 'Unbanned', activeWord: 'banned', managerCall,
    });
    expect(managerCall).toHaveBeenCalledWith({ id: 'g' }, '123', 'mod', undefined);
    expect(text(replies[0])).not.toContain('Reason');
  });
});
