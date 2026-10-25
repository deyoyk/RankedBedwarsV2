import { Client } from 'discord.js';
import Party from '../models/Party';
import UserModel from '../models/User';
import { PartyService } from '../services/PartyService';

export class PartyCleanupTask {
  private client: Client;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly INACTIVITY_THRESHOLD = 2 * 60 * 60 * 1000;

  constructor(client: Client) {
    this.client = client;
  }

  public start() {
    if (this.cleanupInterval) {
      return;
    }
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupInactiveParties();
    }, 30 * 60 * 1000);

    console.log('[PartyCleanupTask] Started party cleanup task (runs every 30 minutes)');
  }

  public stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async cleanupInactiveParties() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      const cutoffTime = new Date(Date.now() - this.INACTIVITY_THRESHOLD);
      
      const inactiveParties = await Party.find({
        lastActiveTime: { $lt: cutoffTime }
      }).limit(100).lean();

      if (inactiveParties.length === 0) {
        console.log('[PartyCleanupTask] No inactive parties found');
        return;
      }

      console.log(`[PartyCleanupTask] Found ${inactiveParties.length} inactive parties to disband`);

      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.warn('[PartyCleanupTask] No guild found for cleanup');
        return;
      }

      const partyIds = inactiveParties.map(party => party.partyId);
      const memberIds = [...new Set(inactiveParties.flatMap(party => party.members ?? []))];

      await UserModel.updateMany(
        { partyId: { $in: partyIds } },
        { $unset: { partyId: "" } }
      );
      await Party.deleteMany({ partyId: { $in: partyIds } });

      const batchSize = 25;
      for (let i = 0; i < memberIds.length; i += batchSize) {
        await Promise.allSettled(
          memberIds.slice(i, i + batchSize).map(memberId => PartyService.removePartyRoles(guild, [memberId]))
        );
      }

      console.log(`[PartyCleanupTask] Successfully disbanded ${inactiveParties.length} inactive parties`);
    } catch (error) {
      console.error('[PartyCleanupTask] Error during party cleanup:', error);
    } finally {
      this.isRunning = false;
    }
  }
}