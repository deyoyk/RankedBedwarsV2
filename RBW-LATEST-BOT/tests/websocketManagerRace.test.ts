import { WebSocketManager } from '../src/websocket/WebSocketManager';

jest.mock('../src/models/Queue', () => ({ __esModule: true, default: { find: jest.fn().mockResolvedValue([]) } }));

describe('WebSocketManager race conditions', () => {
  let manager: WebSocketManager;
  let sent: any[];

  beforeEach(() => {
    sent = [];
    manager = new WebSocketManager(0, undefined as any, '/test');
    jest.spyOn(manager as any, 'send').mockImplementation((payload: any) => { sent.push(payload); });
  });

  afterEach(() => {
    (manager as any).stopQueueStatusBroadcast();
    (manager as any).heartbeatInterval && clearInterval((manager as any).heartbeatInterval);
    (manager as any).server.close();
  });

  it('concurrent checks for the same IGN each resolve with their own result', async () => {
    const promises = Array.from({ length: 5 }, () => manager.checkPlayerOnline('Steve'));

    // All five should have registered a callback and sent a check_player.
    const checks = sent.filter(m => m.type === 'check_player');
    expect(checks).toHaveLength(5);

    // Simulate the plugin responding once per queued check.
    for (let i = 0; i < 5; i++) {
      (manager as any).handlePlayerStatus({ ign: 'steve', online: true, original_ign_case: 'Steve' });
    }

    const results = await Promise.all(promises);
    for (const result of results) {
      expect(result.online).toBe(true);
      expect(result.original_ign_case).toBe('Steve');
    }
    expect((manager as any).checkPlayerCallbacks.size).toBe(0);
  });

  it('mixed-case concurrent checks share one callback bucket', async () => {
    const p1 = manager.checkPlayerOnline('Steve');
    const p2 = manager.checkPlayerOnline('STEVE');
    const p3 = manager.checkPlayerOnline('steve');

    expect((manager as any).checkPlayerCallbacks.get('steve').size).toBe(3);

    (manager as any).handlePlayerStatus({ ign: 'steve', online: false, original_ign_case: 'Steve' });

    const results = await Promise.all([p1, p2, p3]);
    for (const r of results) {
      expect(r.online).toBe(false);
    }
  });

  it('one status response does not resolve checks for other players', async () => {
    const steveCheck = manager.checkPlayerOnline('Steve');
    const alexCheck = manager.checkPlayerOnline('Alex');

    (manager as any).handlePlayerStatus({ ign: 'steve', online: true, original_ign_case: 'Steve' });

    await expect(steveCheck).resolves.toMatchObject({ online: true });
    expect((manager as any).checkPlayerCallbacks.get('alex')?.size).toBe(1);
    expect((manager as any).checkPlayerCallbacks.get('steve')).toBeUndefined();

    (manager as any).handlePlayerStatus({ ign: 'alex', online: false });
    await expect(alexCheck).resolves.toMatchObject({ online: false });
  });

  it('a timed-out check cleans its bucket without affecting new checks', async () => {
    jest.useFakeTimers();
    const p1 = manager.checkPlayerOnline('Steve');

    jest.advanceTimersByTime(10000);
    await expect(p1).resolves.toMatchObject({ online: false });
    expect((manager as any).checkPlayerCallbacks.get('steve')).toBeUndefined();

    const p2 = manager.checkPlayerOnline('Steve');
    expect((manager as any).checkPlayerCallbacks.get('steve')?.size).toBe(1);

    (manager as any).handlePlayerStatus({ ign: 'steve', online: true });
    await expect(p2).resolves.toMatchObject({ online: true });
    jest.useRealTimers();
  });
});
