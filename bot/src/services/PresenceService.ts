export type PresenceState = 'online' | 'offline' | 'unknown';

interface PresenceRecord {
  online: boolean;
  lastSeen: number;
}

export const PRESENCE_FRESH_TTL_MS = 30_000;

class PresenceStore {
  private records = new Map<string, PresenceRecord>();
  private connected = true;
  private offlineVersion = 0;

  ingest(ign: string | undefined | null, online: boolean): void {
    const key = (ign || '').trim().toLowerCase();
    if (!key) return;
    const prev = this.records.get(key);
    this.records.set(key, { online, lastSeen: Date.now() });
    if (!prev || prev.online !== online) {
      console.log(`[Presence] ${key} is now ${online ? 'online' : 'offline'}`);
    }
    if (!online && (!prev || prev.online)) {
      this.offlineVersion += 1;
    }
  }

  evaluate(ign: string | undefined | null, now: number = Date.now()): PresenceState {
    const key = (ign || '').trim().toLowerCase();
    if (!key || !this.connected) return 'unknown';
    const rec = this.records.get(key);
    if (!rec || now - rec.lastSeen > PRESENCE_FRESH_TTL_MS) return 'unknown';
    return rec.online ? 'online' : 'offline';
  }

  setConnected(connected: boolean): void {
    if (this.connected && !connected) {
      console.warn('[Presence] Minecraft link down, presence reads as unknown until reconnect');
    }
    if (!this.connected && connected) {
      console.log('[Presence] Minecraft link restored');
    }
    this.connected = connected;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getOfflineVersion(): number {
    return this.offlineVersion;
  }

  clear(): void {
    this.records.clear();
    this.connected = true;
    this.offlineVersion = 0;
  }
}

export const PresenceService = new PresenceStore();
