const mockUpdateMany = jest.fn();

jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: {
    updateMany: (...args: unknown[]) => mockUpdateMany(...args),
  },
}));

import { queuecontrol } from '../src/commands/queue/queuecontrol';

function interaction(sub: string, type: string, queueId?: string) {
  return {
    id: `interaction-${sub}-${type}`,
    user: { id: '123456789012345678' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild-1' },
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => {
        if (name === 'type') return type;
        if (name === 'queue_id') return queueId ?? null;
        return null;
      },
    },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function embedJson(target: any) {
  return target.reply.mock.calls[0][0].embeds[0].toJSON();
}

describe('queuecontrol embeds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ modifiedCount: 2 });
  });

  it('reports opened ranked queues in the queue system style', async () => {
    const target = interaction('enable', 'ranked');

    await queuecontrol(target);

    expect(mockUpdateMany).toHaveBeenCalledWith({ isRanked: true }, { isActive: true });
    const embed = embedJson(target);
    expect(embed.author?.name).toBe('Veltrix · Queue');
    expect(embed.description).toBe('Successfully opened `Ranked` queues');
  });

  it('reports closed unranked queues', async () => {
    const target = interaction('disable', 'unranked');

    await queuecontrol(target);

    expect(mockUpdateMany).toHaveBeenCalledWith({ isRanked: false }, { isActive: false });
    expect(embedJson(target).author?.name).toBe('Veltrix · Queue');
    expect(embedJson(target).description).toBe('Successfully closed `Unranked` queues');
  });

  it('reports when nothing matched without a success marker', async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });
    const target = interaction('enable', 'ranked');

    await queuecontrol(target);

    expect(embedJson(target).author?.name).toBe('Veltrix · Queue');
    expect(embedJson(target).description).toBe('No matching `Ranked` queues were updated');
  });
});
