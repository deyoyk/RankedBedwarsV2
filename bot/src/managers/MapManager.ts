import { MapInfo } from '../types/MapInfoMemory';
import { WebSocketManager } from '../websocket/WebSocketManager';

export const DEFAULT_MAP_CACHE_TTL_MS = 60 * 1000;
export const MATCHMAKING_MAP_CACHE_TTL_MS = 5 * 1000;
export const TENTATIVE_MAP_CLAIM_TTL_MS = 30 * 1000;

export class MapService {
  private static sharedInstance: MapService | null = null;

  public static getSharedInstance(wsManager: WebSocketManager): MapService {
    if (!MapService.sharedInstance || MapService.sharedInstance.wsManager !== wsManager) {
      MapService.sharedInstance = new MapService(wsManager);
    }
    return MapService.sharedInstance;
  }

  public static getInstance(wsManager: WebSocketManager): MapService {
    return MapService.getSharedInstance(wsManager);
  }

  public static resetSharedInstance(): void {
    MapService.sharedInstance = null;
  }

  private wsManager: WebSocketManager;
  private allMaps: MapInfo[] = [];
  private reservedMaps: MapInfo[] = [];
  private lastFetch: number = 0;
  private matchmakingLastFetch: number = 0;
  private cacheDuration: number = DEFAULT_MAP_CACHE_TTL_MS;
  private matchmakingCacheDuration: number = MATCHMAKING_MAP_CACHE_TTL_MS;
  private mapsVersion: number = 0;
  private lastFingerprint: string = '';
  private recentPicks: Map<string, number> = new Map();

  constructor(wsManager: WebSocketManager) {
    this.wsManager = wsManager;
  }

  private fingerprint(maps: MapInfo[]): string {
    return maps.map(m => `${m.name}:${m.locked ? 1 : 0}:${m.maxplayers ?? ''}`).join('|');
  }

  private snapshotFromWs(): { all: MapInfo[]; reserved: MapInfo[] } {
    const all = [...(this.wsManager.getAllMaps?.() || [])];
    const reserved = [...(this.wsManager.getReservedMaps?.() || [])];
    return { all, reserved };
  }

  private noteSnapshot(all: MapInfo[]): void {
    const fp = this.fingerprint(all);
    if (fp !== this.lastFingerprint) {
      this.lastFingerprint = fp;
      this.mapsVersion += 1;
    }
  }

  public getMapsVersion(): number {
    return this.mapsVersion;
  }

  public notifyMapsUpdated(): void {
    this.lastFetch = 0;
    this.matchmakingLastFetch = 0;
    this.mapsVersion += 1;
  }

  public claimMap(name: string): void {
    if (!name) return;
    this.pruneRecentPicks();
    this.recentPicks.set(name, Date.now());
  }

  public getRecentlyClaimedNames(ttlMs: number = TENTATIVE_MAP_CLAIM_TTL_MS): Set<string> {
    this.pruneRecentPicks(ttlMs);
    return new Set(this.recentPicks.keys());
  }

  public clearRecentClaims(): void {
    this.recentPicks.clear();
  }

  private pruneRecentPicks(ttlMs: number = TENTATIVE_MAP_CLAIM_TTL_MS): void {
    const now = Date.now();
    for (const [name, ts] of this.recentPicks) {
      if (now - ts > ttlMs) this.recentPicks.delete(name);
    }
  }

  private async refresh(forceRefresh: boolean, ttlMs: number, lastFetchRef: 'lastFetch' | 'matchmakingLastFetch'): Promise<void> {
    const now = Date.now();
    const last = this[lastFetchRef];
    if (!forceRefresh && now - last <= ttlMs && this.allMaps.length > 0) return;
    const { all, reserved } = this.snapshotFromWs();
    this.allMaps = all;
    this.reservedMaps = reserved;
    this[lastFetchRef] = now;
    if (lastFetchRef === 'lastFetch') this.lastFetch = now;
    else {
      this.matchmakingLastFetch = now;
      if (now - this.lastFetch > this.cacheDuration) this.lastFetch = now;
    }
    this.noteSnapshot(all);
  }

  public async getAllMaps(forceRefresh = false): Promise<MapInfo[]> {
    await this.refresh(forceRefresh, this.cacheDuration, 'lastFetch');
    return [...this.allMaps];
  }

  public async getReservedMaps(forceRefresh = false): Promise<MapInfo[]> {
    await this.getAllMaps(forceRefresh);
    return [...this.reservedMaps];
  }

  public async getUnlockedMaps(forceRefresh = false): Promise<MapInfo[]> {
    const maps = await this.getAllMaps(forceRefresh);
    return maps.filter(m => !m.locked);
  }

  public async getAllMapsForMatchmaking(forceRefresh = false): Promise<MapInfo[]> {
    await this.refresh(forceRefresh, this.matchmakingCacheDuration, 'matchmakingLastFetch');
    return [...this.allMaps];
  }

  public async getReservedMapsForMatchmaking(forceRefresh = false): Promise<MapInfo[]> {
    await this.getAllMapsForMatchmaking(forceRefresh);
    return [...this.reservedMaps];
  }

  public async getUnlockedMapsForMatchmaking(forceRefresh = false): Promise<MapInfo[]> {
    const maps = await this.getAllMapsForMatchmaking(forceRefresh);
    return maps.filter(m => !m.locked);
  }
}
