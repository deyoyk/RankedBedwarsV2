import { callAlerts } from '../src/services/VcChatRelay';

const game = (team: 1 | 2) => ({ gameId: 12, team, players: new Set(['p1', 'p2']) });

describe('call join and leave alerts', () => {
  test('a called outsider joining a team VC alerts that team', () => {
    expect(callAlerts('guest', null, game(1))).toEqual([{ gameId: 12, team: 1, joined: true }]);
  });

  test('a called outsider leaving alerts the team they left', () => {
    expect(callAlerts('guest', game(2), null)).toEqual([{ gameId: 12, team: 2, joined: false }]);
  });

  test('moving between the two team VCs is a leave then a join', () => {
    expect(callAlerts('guest', game(1), game(2))).toEqual([
      { gameId: 12, team: 1, joined: false },
      { gameId: 12, team: 2, joined: true },
    ]);
  });

  test('the game players themselves never trigger call alerts', () => {
    expect(callAlerts('p1', null, game(1))).toEqual([]);
    expect(callAlerts('p2', game(1), game(2))).toEqual([]);
  });
});
