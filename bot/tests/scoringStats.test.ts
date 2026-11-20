import { WebSocketManager } from '../src/websocket/WebSocketManager';

function builder(): any {
  return Object.create(WebSocketManager.prototype);
}

describe('scoring payload stats', () => {
  it('uses the bed count the plugin reports', () => {
    const data = builder().buildPlayerData({
      A: { kills: 3, beds: 2 },
      B: { kills: 1 },
    }, ['B']);
    expect(data.A.bedBroken).toBe(2);
    expect(data.B.bedBroken).toBe(1);
  });

  it('keeps assists, first blood, fights and resources', () => {
    const data = builder().buildPlayerData({
      A: {
        kills: 4, deaths: 1, final_kills: 2, final_deaths: 0,
        irons: 12, gold: 3, diamonds: 2, emeralds: 1, blocks_placed: 30,
        damage_dealt: 44.5, damage_taken: 10, assists: 2, max_streak: 3,
        first_blood: true,
        fights: { B: { kills: 2, damage_dealt: 20.5 } },
      },
    }, []);
    const a = data.A;
    expect(a.assists).toBe(2);
    expect(a.firstBlood).toBe(true);
    expect(a.maxStreak).toBe(3);
    expect(a.damageDealt).toBe(44.5);
    expect(a.irons).toBe(12);
    expect(a.fights).toEqual({ B: { kills: 2, damageDealt: 20.5 } });
  });
});
