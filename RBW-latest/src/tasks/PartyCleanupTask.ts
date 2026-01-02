import { Client } from 'discord.js';
import Party from '../models/Party';
import UserModel from '../models/User';
import { PartyService } from '../services/PartyService';

export class PartyCleanupTask {
  private client: Client;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly INACTIVITY_THRESHOLD = 2 * 60 * 60 * 1000;

  constructor(client: Client) {
    this.client = client;
  }

  public start() {
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupInactiveParties();
    }, 30 * 60 * 1000);

    console.log('[PartyCleanupTask] Started party cleanup task (runs every 30 minutes)');
  }

  public stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[PartyCleanupTask] Stopped party cleanup task');
    }
  }

  private async cleanupInactiveParties() {
    try {
      const cutoffTime = new Date(Date.now() - this.INACTIVITY_THRESHOLD);
      
      const inactiveParties = await Party.find({
        lastActiveTime: { $lt: cutoffTime }
      });

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

      for (const party of inactiveParties) {
        await this.disbandInactiveParty(party, guild);
      }

      console.log(`[PartyCleanupTask] Successfully disbanded ${inactiveParties.length} inactive parties`);
    } catch (error) {
      console.error('[PartyCleanupTask] Error during party cleanup:', error);
    }
  }

  private async disbandInactiveParty(party: any, guild: any) {
    try {
      await UserModel.updateMany(
        { partyId: party.partyId },
        { $unset: { partyId: "" } }
      );

      await PartyService.removePartyRoles(guild, party.members);
      await Party.deleteOne({ partyId: party.partyId });

      console.log(`[PartyCleanupTask] Disbanded inactive party ${party.partyId} (last active: ${party.lastActiveTime})`);
    } catch (error) {
      console.error(`[PartyCleanupTask] Error disbanding party ${party.partyId}:`, error);
    }
  }
}