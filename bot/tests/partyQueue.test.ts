import config from '../src/config/config';
import { maxPartySizeForQueue } from '../src/utils/partyQueue';

describe('party queue limits', () => {
  const originalRoles = { ...config.roles };
  const originalPartyQueueSize = config.PartyQueueSize;
  const originalCommonPartySize = config.CommonPartySize;

  beforeEach(() => {
    config.roles.partyof2Queue = 'role-2';
    config.roles.partyof3Queue = 'role-3';
    config.roles.partyof4Queue = 'role-4';
    config.PartyQueueSize = 1;
    config.CommonPartySize = 8;
  });

  afterEach(() => {
    Object.assign(config.roles, originalRoles);
    config.PartyQueueSize = originalPartyQueueSize;
    config.CommonPartySize = originalCommonPartySize;
  });

  it('allows role-backed party sizes in ranked queues', () => {
    expect(maxPartySizeForQueue({ isRanked: true, maxPlayers: 8 }, [])).toBe(1);
    expect(maxPartySizeForQueue({ isRanked: true, maxPlayers: 8 }, [2])).toBe(2);
    expect(maxPartySizeForQueue({ isRanked: true, maxPlayers: 8 }, [3])).toBe(3);
    expect(maxPartySizeForQueue({ isRanked: true, maxPlayers: 8 }, [4])).toBe(4);
    expect(maxPartySizeForQueue({ isRanked: true, maxPlayers: 8 }, [5])).toBe(4);
  });

  it('uses the common party size for unranked/private games', () => {
    expect(maxPartySizeForQueue({ isRanked: false, maxPlayers: 16 }, [])).toBe(8);
    expect(maxPartySizeForQueue({ isRanked: false, maxPlayers: 8 }, [])).toBe(4);
  });

  it('never allows more than half the queue capacity', () => {
    expect(maxPartySizeForQueue({ isRanked: false, maxPlayers: 6 }, [])).toBe(3);
    expect(maxPartySizeForQueue({ isRanked: false, maxPlayers: 2 }, [])).toBe(1);
  });
});
