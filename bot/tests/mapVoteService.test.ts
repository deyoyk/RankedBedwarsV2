import { EventEmitter } from 'events';

jest.mock('../src/utils/playerDirectory', () => ({
  getPlayerIgns: jest.fn(async (ids: string[]) => new Map(ids.map(id => [id, `Ign_${id}`]))),
}));

import { IN_GAME_PUSH_MS, MapVoteService } from '../src/services/MapVoteService';
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

describe('MapVoteService in game', () => {
  function link() {
    const handlers: Record<string, (msg: object) => void> = {};
    return {
      send: jest.fn(),
      setGlobalHandler: jest.fn((type: string, handler: (msg: object) => void) => { handlers[type] = handler; }),
      cast: (gameId: number, ign: string, map: string) => handlers.map_vote_cast({ type: 'map_vote_cast', game_id: gameId, ign, map }),
    };
  }

  afterEach(() => {
    jest.useRealTimers();
    MapVoteService.linkInGame(null);
  });

  it('shows the vote in game, counts votes clicked there and bundles the chat updates', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const { collector, message, client } = makeChannel();
    const ws = link();
    MapVoteService.linkInGame(ws);
    const service = new MapVoteService(client as any);
    const resultPromise = service.run(204, 'thread-1', ['p1', 'p2', 'p3'], ['Archway', 'Lectus', 'Hollow', 'Aquarium', 'Sanctum']);
    await flush();
    await flush();

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send.mock.calls[0][0]).toMatchObject({
      type: 'map_vote',
      game_id: 204,
      players: ['Ign_p1', 'Ign_p2', 'Ign_p3'],
      maps: [
        { name: 'Archway', votes: 0 }, { name: 'Lectus', votes: 0 }, { name: 'Hollow', votes: 0 },
        { name: 'Aquarium', votes: 0 }, { name: 'Sanctum', votes: 0 },
      ],
      picks: {},
      seconds_left: 20,
    });

    ws.cast(204, 'ign_p1', 'Archway');
    ws.cast(204, 'Ign_p2', 'Archway');
    ws.cast(204, 'Ign_p9', 'Lectus');
    ws.cast(204, 'Ign_p3', 'Nowhere');
    ws.cast(999, 'Ign_p3', 'Lectus');
    expect(message.edit).toHaveBeenCalledTimes(2);
    expect(ws.send).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(IN_GAME_PUSH_MS);
    expect(ws.send).toHaveBeenCalledTimes(2);
    expect(ws.send.mock.calls[1][0]).toMatchObject({
      maps: expect.arrayContaining([{ name: 'Archway', votes: 2 }, { name: 'Lectus', votes: 0 }]),
      picks: { Ign_p1: 'Archway', Ign_p2: 'Archway' },
    });

    collector.emit('collect', interaction('p3', 'Lectus'));
    await flush();

    await expect(resultPromise).resolves.toBe('Archway');
    const last = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
    expect(last).toMatchObject({ winner: 'Archway', picks: { Ign_p3: 'Lectus' } });
    jest.advanceTimersByTime(IN_GAME_PUSH_MS * 2);
    expect(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]).toBe(last);

    ws.cast(204, 'Ign_p3', 'Archway');
    expect(message.edit.mock.calls[message.edit.mock.calls.length - 1][0].components).toEqual([]);
  });
});

describe('MapVoteService', () => {
  it('sends a themed three-map embed and finishes when every player voted', async () => {
    const { channel, collector, message, client } = makeChannel();
    const service = new MapVoteService(client as any);
    const resultPromise = service.run(12, 'thread-1', ['p1', 'p2', 'p3'], ['A', 'B', 'C']);
    await flush();

    expect(channel.createMessageComponentCollector).toHaveBeenCalledWith(
      expect.objectContaining({ time: 20_000 }),
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
