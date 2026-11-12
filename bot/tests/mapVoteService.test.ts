import { EventEmitter } from 'events';
import { MapVoteService } from '../src/services/MapVoteService';
import { EMBED_COLORS } from '../src/utils/betterembed';

class FakeCollector extends EventEmitter {
  public stop = jest.fn(() => {
    this.emit('end');
  });
}

function makeChannel() {
  const collector = new FakeCollector();
  const message = { edit: jest.fn().mockResolvedValue(undefined) };
  const channel = {
    id: 'thread-1',
    isTextBased: () => true,
    send: jest.fn().mockResolvedValue(message),
    createMessageComponentCollector: jest.fn().mockReturnValue(collector),
  };
  const client = {
    guilds: {
      cache: {
        first: () => ({
          channels: {
            cache: { get: () => channel },
            fetch: async () => channel,
          },
        }),
      },
    },
  };
  return { channel, collector, message, client };
}

function interaction(userId: string, map: string) {
  return {
    user: { id: userId },
    values: [map],
    reply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('MapVoteService', () => {
  it('sends a themed three-map embed and finishes when every player voted', async () => {
    const { channel, collector, message, client } = makeChannel();
    const service = new MapVoteService(client as any);
    const resultPromise = service.run(12, 'thread-1', ['p1', 'p2', 'p3'], ['A', 'B', 'C']);
    await flush();

    expect(channel.createMessageComponentCollector).toHaveBeenCalledWith(
      expect.objectContaining({ time: 60_000 }),
    );
    const sent = channel.send.mock.calls[0][0];
    const json = sent.embeds[0].toJSON();
    expect(json.description).toContain('-# ➡ Game #12 Map Vote');
    expect(json.color).toBe(EMBED_COLORS.info);
    expect(json.fields?.map((field: { name: string }) => field.name)).toEqual(['Map 1', 'Map 2', 'Map 3']);

    collector.emit('collect', interaction('p1', 'A'));
    await flush();
    collector.emit('collect', interaction('p2', 'A'));
    await flush();
    expect(collector.stop).not.toHaveBeenCalled();

    collector.emit('collect', interaction('p3', 'B'));
    await flush();

    await expect(resultPromise).resolves.toBe('A');
    expect(collector.stop).toHaveBeenCalledWith('all_voted');
    const finalJson = message.edit.mock.calls[0][0].embeds[0].toJSON();
    expect(finalJson.fields?.some((field: { name: string; value: string }) =>
      field.name === 'Selected Map' && field.value.includes('A'))).toBe(true);
    expect(message.edit.mock.calls[0][0].components).toEqual([]);
  });

  it('lets a player change their vote and breaks ties by candidate rating order', async () => {
    const { channel, collector, client } = makeChannel();
    const service = new MapVoteService(client as any);
    const resultPromise = service.run(3, 'thread-1', ['p1', 'p2'], ['A', 'B', 'C']);
    await flush();

    collector.emit('collect', interaction('p1', 'A'));
    await flush();
    collector.emit('collect', interaction('p1', 'B'));
    await flush();
    collector.emit('collect', interaction('p2', 'C'));
    await flush();

    await expect(resultPromise).resolves.toBe('B');
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('rejects votes from players outside the game', async () => {
    const { channel, collector, client } = makeChannel();
    const service = new MapVoteService(client as any);
    const resultPromise = service.run(4, 'thread-1', ['p1'], ['A', 'B']);
    await flush();
    const outsider = interaction('stranger', 'B');

    collector.emit('collect', outsider);
    await flush();
    expect(outsider.reply).toHaveBeenCalledWith({ content: 'Only players in this game can vote.', ephemeral: true });
    expect(outsider.update).not.toHaveBeenCalled();

    collector.emit('end');
    await expect(resultPromise).resolves.toBe('A');
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('uses the highest-voted map when the vote times out', async () => {
    const { channel, collector, client } = makeChannel();
    const service = new MapVoteService(client as any);
    const resultPromise = service.run(5, 'thread-1', ['p1', 'p2', 'p3'], ['A', 'B', 'C']);
    await flush();

    collector.emit('collect', interaction('p1', 'C'));
    await flush();
    collector.emit('end');

    await expect(resultPromise).resolves.toBe('C');
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('skips the vote when only one map is available', async () => {
    const { channel, client } = makeChannel();
    const service = new MapVoteService(client as any);

    await expect(service.run(6, 'thread-1', ['p1'], ['Only'])).resolves.toBe('Only');
    expect(channel.send).not.toHaveBeenCalled();
  });
});
