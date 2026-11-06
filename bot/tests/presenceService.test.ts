import { PresenceService, PRESENCE_FRESH_TTL_MS } from '../src/services/PresenceService';

describe('PresenceService', () => {
  beforeEach(() => {
    PresenceService.clear();
  });

  it('starts unknown for unseen players', () => {
    expect(PresenceService.evaluate('SomeGuy')).toBe('unknown');
    expect(PresenceService.evaluate('')).toBe('unknown');
  });

  it('tracks online and offline transitions', () => {
    PresenceService.ingest('Alice', true);
    expect(PresenceService.evaluate('ALICE')).toBe('online');
    PresenceService.ingest('alice', false);
    expect(PresenceService.evaluate('Alice')).toBe('offline');
  });

  it('treats records older than the freshness window as unknown', () => {
    PresenceService.ingest('Bob', true);
    expect(PresenceService.evaluate('Bob', Date.now())).toBe('online');
    expect(PresenceService.evaluate('Bob', Date.now() + PRESENCE_FRESH_TTL_MS + 1)).toBe('unknown');
  });

  it('bumps the offline version only on fresh offline transitions', () => {
    expect(PresenceService.getOfflineVersion()).toBe(0);
    PresenceService.ingest('Alice', true);
    expect(PresenceService.getOfflineVersion()).toBe(0);
    PresenceService.ingest('Alice', false);
    expect(PresenceService.getOfflineVersion()).toBe(1);
    PresenceService.ingest('Alice', false);
    expect(PresenceService.getOfflineVersion()).toBe(1);
    PresenceService.ingest('Bob', false);
    expect(PresenceService.getOfflineVersion()).toBe(2);
  });

  it('ignores blank idents', () => {
    PresenceService.ingest('   ', true);
    PresenceService.ingest('', false);
    expect(PresenceService.evaluate('   ')).toBe('unknown');
  });

  it('reads everything as unknown while disconnected', () => {
    PresenceService.ingest('Cara', true);
    expect(PresenceService.evaluate('Cara')).toBe('online');
    PresenceService.setConnected(false);
    expect(PresenceService.isConnected()).toBe(false);
    expect(PresenceService.evaluate('Cara')).toBe('unknown');
    PresenceService.setConnected(true);
    expect(PresenceService.evaluate('Cara')).toBe('online');
  });

  it('bounds memory by evicting the oldest records', () => {
    for (let i = 0; i < 50005; i++) {
      PresenceService.ingest(`player${i}`, true);
    }
    expect(PresenceService.evaluate('player0')).toBe('unknown');
    expect(PresenceService.evaluate('player50004')).toBe('online');
  });

  it('refreshes recency when a tracked player is updated', () => {
    for (let i = 0; i < 50000; i++) {
      PresenceService.ingest(`player${i}`, true);
    }
    PresenceService.ingest('player0', true);
    PresenceService.ingest('player50000', true);
    expect(PresenceService.evaluate('player0')).toBe('online');
    expect(PresenceService.evaluate('player1')).toBe('unknown');
  });
});
