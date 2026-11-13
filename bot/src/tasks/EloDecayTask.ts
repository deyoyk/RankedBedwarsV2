import { Client } from 'discord.js';
import User from '../models/User';
import config from '../config/config';
import { decayAmountForElo, isDecayProtected } from '../utils/eloProgression';
import { updateDailyElo } from '../utils/userStats';

export class EloDecayTask {
  private client: Client;
  private decayInterval: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly DAY_MS = 24 * 60 * 60 * 1000;
  private readonly BATCH_SIZE = 500;

  constructor(client: Client) {
    this.client = client;
  }

  public start() {
    if (this.decayInterval) {
      return;
    }
    void this.client;
    this.startupTimeout = setTimeout(() => {
      void this.applyDecay(new Date());
    }, 2 * 60 * 1000);
    this.decayInterval = setInterval(() => {
      void this.applyDecay(new Date());
    }, this.DAY_MS);

    console.log('[EloDecayTask] Started elo decay task (runs every 24 hours)');
  }

  public stop() {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  public async applyDecay(now: Date): Promise<{ decayed: number; totalLost: number }> {
    if (this.isRunning) {
      return { decayed: 0, totalLost: 0 };
    }
    this.isRunning = true;
    try {
      const cfg = config.eloDecay;
      if (!cfg.enabled) {
        return { decayed: 0, totalLost: 0 };
      }
      const cutoff = new Date(now.getTime() - cfg.inactivityDays * this.DAY_MS);
      const bands = [
        { minElo: cfg.midMin, maxElo: cfg.midMax, amount: cfg.midAmount },
        { minElo: cfg.highMin, maxElo: Number.MAX_SAFE_INTEGER, amount: cfg.highAmount },
      ];

      let decayed = 0;
      let totalLost = 0;
      let lastId: unknown = null;
      for (;;) {
        const filter: Record<string, unknown> = {
          elo: { $gte: cfg.midMin },
          $or: [
            { lastPlayedAt: { $lt: cutoff } },
            { lastPlayedAt: { $exists: false }, updatedAt: { $lt: cutoff } },
          ],
        };
        if (lastId !== null) {
          filter._id = { $gt: lastId };
        }
        const candidates = await User.find(filter).select('discordId elo lastPlayedAt createdAt dailyElo').sort({ _id: 1 }).limit(this.BATCH_SIZE).lean();
        if (candidates.length === 0) {
          break;
        }
        lastId = (candidates[candidates.length - 1] as { _id: unknown })._id;

        const ops: Record<string, unknown>[] = [];
        const inactivityCutoff = new Date(now.getTime() - cfg.inactivityDays * this.DAY_MS);
        for (const user of candidates) {
          if (isDecayProtected(user.createdAt, now, cfg.rankGraceDays)) {
            continue;
          }
          const lastActive = user.lastPlayedAt ?? user.updatedAt;
          if (lastActive && lastActive >= inactivityCutoff) {
            continue;
          }
          const amount = decayAmountForElo(user.elo, bands);
          if (amount <= 0) {
            continue;
          }
          const newElo = Math.max(0, user.elo - amount);
          const dailyElo = Array.isArray(user.dailyElo) ? [...user.dailyElo] : [];
          updateDailyElo({ dailyElo } as { dailyElo: Array<{ elo: number; date: Date | string }> }, newElo);
          ops.push({
            updateOne: {
              filter: { discordId: user.discordId, elo: user.elo },
              update: { $set: { elo: newElo, dailyElo: dailyElo.slice(-30) } },
            },
          });
          decayed += 1;
          totalLost += user.elo - newElo;
        }

        const UserModel = User as unknown as { bulkWrite?: (ops: Record<string, unknown>[]) => Promise<unknown> };
        if (ops.length > 0 && typeof UserModel.bulkWrite === 'function') {
          await UserModel.bulkWrite(ops);
        }
        if (candidates.length < this.BATCH_SIZE) {
          break;
        }
      }

      if (decayed > 0) {
        console.log(`[EloDecayTask] Applied decay to ${decayed} users (total -${totalLost} Elo)`);
      }
      return { decayed, totalLost };
    } catch (error) {
      console.error('[EloDecayTask] Error during elo decay:', error);
      return { decayed: 0, totalLost: 0 };
    } finally {
      this.isRunning = false;
    }
  }
}
