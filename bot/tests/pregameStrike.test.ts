import { strikeLeavers, PREGAME_STRIKE_REASON } from '../src/Matchmaking/pregameStrikes';

function deps(links: Record<string, string>, failFor: string[] = []) {
  const struck: Array<{ id: string; reason: string }> = [];
  return {
    struck,
    discordIdOf: async (ign: string) => links[ign.toLowerCase()] ?? null,
    strike: async (id: string, reason: string) => {
      if (failFor.includes(id)) throw new Error('strike failed');
      struck.push({ id, reason });
    }
  };
}

describe('strikeLeavers', () => {
  test('strikes every left player who has a linked account', async () => {
    const d = deps({ steve: '1', alex: '2' });
    const result = await strikeLeavers(['Steve', 'Alex'], d);
    expect(result).toEqual(['Steve', 'Alex']);
    expect(d.struck).toEqual([{ id: '1', reason: PREGAME_STRIKE_REASON }, { id: '2', reason: PREGAME_STRIKE_REASON }]);
  });

  test('does not strike anyone when nobody left', async () => {
    const d = deps({ steve: '1' });
    expect(await strikeLeavers([], d)).toEqual([]);
    expect(await strikeLeavers(undefined, d)).toEqual([]);
    expect(d.struck).toEqual([]);
  });

  test('skips names with no linked account and strikes a name only once', async () => {
    const d = deps({ steve: '1' });
    expect(await strikeLeavers(['Steve', 'steve', 'Ghost'], d)).toEqual(['Steve']);
    expect(d.struck).toHaveLength(1);
  });

  test('a failed strike does not stop the others', async () => {
    const d = deps({ steve: '1', alex: '2' }, ['1']);
    expect(await strikeLeavers(['Steve', 'Alex'], d)).toEqual(['Alex']);
  });
});
