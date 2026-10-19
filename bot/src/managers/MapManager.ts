import { MapInfo } from '../types/MapInfoMemory';
import { WebSocketManager } from '../websocket/WebSocketManager';

export class MapService {
  private wsManager: WebSocketManager;
  private allMaps: MapInfo[] = [];
  private reservedMaps: MapInfo[] = [];
  private lastFetch: number = 0;
  private cacheDuration: number = 60 * 1000; 

  constructor(wsManager: WebSocketManager) {
    this.wsManager = wsManager;
  }

  public async getAllMaps(forceRefresh = false): Promise<MapInfo[]> {
    const now = Date.now();
    if (forceRefresh || now - this.lastFetch > this.cacheDuration || this.allMaps.length === 0) {
      this.allMaps = this.wsManager.getAllMaps?.() || [];
      this.reservedMaps = this.wsManager.getReservedMaps?.() || [];
      this.lastFetch = now;
    }
    return this.allMaps;
  }

  public async getReservedMaps(forceRefresh = false): Promise<MapInfo[]> {
    await this.getAllMaps(forceRefresh);
    return this.reservedMaps;
  }

  public async getUnlockedMaps(forceRefresh = false): Promise<MapInfo[]> {
    const maps = await this.getAllMaps(forceRefresh);
    return maps.filter(m => !m.locked);
  }
}