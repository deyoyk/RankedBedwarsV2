import { Client } from 'discord.js';
import { ScreenshareService } from '../services/ScreenshareService';

export class ScreenshareCleanupTask {
  private client: Client;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 2 * 60 * 1000; 
  private isRunning = false;

  constructor(client: Client) {
    this.client = client;
  }

  public start() {
    if (this.cleanupInterval) {
      console.warn('[ScreenshareCleanupTask] Cleanup task already running');
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      if (this.isRunning) {
        console.warn('[ScreenshareCleanupTask] Previous cleanup still running, skipping this cycle');
        return;
      }
      
      await this.cleanupExpiredSessions();
    }, this.CLEANUP_INTERVAL);

    console.log('[ScreenshareCleanupTask] Started screenshare cleanup task (runs every 2 minutes)');
    
    
    setTimeout(() => this.cleanupExpiredSessions(), 5000); 
  }

  public stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[ScreenshareCleanupTask] Stopped screenshare cleanup task');
    }
  }

  private async cleanupExpiredSessions() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    const startTime = Date.now();

    try {
      
      const guilds = Array.from(this.client.guilds.cache.values());
      
      if (guilds.length === 0) {
        console.warn('[ScreenshareCleanupTask] No guilds found for cleanup');
        return;
      }

      let totalExpired = 0;
      
      
      for (const guild of guilds) {
        try {
          const expiredCount = await this.cleanupGuildSessions(guild);
          totalExpired += expiredCount;
        } catch (error) {
          console.error(`[ScreenshareCleanupTask] Error cleaning up guild ${guild.name}:`, error);
        }
      }

      const duration = Date.now() - startTime;
      if (totalExpired > 0) {
        console.log(`[ScreenshareCleanupTask] Cleaned up ${totalExpired} expired sessions across ${guilds.length} guilds in ${duration}ms`);
      }

    } catch (error) {
      console.error('[ScreenshareCleanupTask] Error during cleanup:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async cleanupGuildSessions(guild: any): Promise<number> {
    try {
      const beforeCount = await ScreenshareService.getActiveSessions();
      await ScreenshareService.expireSessions(guild);
      const afterCount = await ScreenshareService.getActiveSessions();
      
      return beforeCount.length - afterCount.length;
    } catch (error) {
      console.error(`[ScreenshareCleanupTask] Error cleaning up sessions for guild ${guild.name}:`, error);
      return 0;
    }
  }

  public async forceCleanup(): Promise<void> {
    console.log('[ScreenshareCleanupTask] Force cleanup requested');
    await this.cleanupExpiredSessions();
  }

  public getStatus(): { isRunning: boolean; hasInterval: boolean } {
    return {
      isRunning: this.isRunning,
      hasInterval: this.cleanupInterval !== null
    };
  }
}