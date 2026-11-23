import { strikeLeavers, PREGAME_STRIKE_REASON, settleAbandonedPregame, leaversToStrikeOnGiveUp, OFFLINE_WARP_REASON } from '../src/Matchmaking/pregameStrikes';

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

describe('settleAbandonedPregame', () => {
  test('voids first and strikes only after this call won the void', async () => {
    const order: string[] = [];
    await settleAbandonedPregame(['Steve'], {
      voidGame: async () => { order.push('void'); },
      strike: async (left) => { order.push('strike:' + left.join(',')); return left; },
      ackAlreadySettled: () => order.push('ack')
    });
    expect(order).toEqual(['void', 'strike:Steve']);
  });

  test('a redelivered message for an already voided game acks and strikes nobody', async () => {
    const strike = jest.fn();
    const ack = jest.fn();
    await settleAbandonedPregame(['Steve'], {
      voidGame: async () => { throw new Error('Game 7 is already settled'); },
      strike,
      ackAlreadySettled: ack
    });
    expect(strike).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
  });

  test('a redelivery while the first is still settling strikes nobody', async () => {
    const strike = jest.fn();
    await settleAbandonedPregame(['Steve'], {
      voidGame: async () => { throw new Error('Game 7 is already settled (settlement in progress)'); },
      strike,
      ackAlreadySettled: () => undefined
    });
    expect(strike).not.toHaveBeenCalled();
  });
});

describe('leaversToStrikeOnGiveUp', () => {
  test('strikes the stored leavers only when the last failure was about offline players', () => {
    expect(leaversToStrikeOnGiveUp(OFFLINE_WARP_REASON, ['Steve'])).toEqual(['Steve']);
    expect(leaversToStrikeOnGiveUp('Warp timeout', ['Steve'])).toEqual([]);
    expect(leaversToStrikeOnGiveUp('Unknown warp failure', ['Steve'])).toEqual([]);
    expect(leaversToStrikeOnGiveUp(OFFLINE_WARP_REASON, undefined)).toEqual([]);
  });
});
