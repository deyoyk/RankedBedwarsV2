import { Client, EmbedBuilder, Message, TextChannel } from 'discord.js';
import mongoose from 'mongoose';
import { WebSocketManager } from '../websocket/WebSocketManager';
import config from '../config/config';
import os from 'os';
import botPackage from '../../package.json';
import { EMBED_THEME, embedsFor } from '../utils/betterembed';

const { themedEmbed } = embedsFor('Status');

export const STATUS_EMBED_TITLE = 'Bot Environment Status';
const STATUS_WARNING_COLOR = EMBED_THEME.warningColor;

export class BotStatusTask {
  private client: Client;
  private wsManager: WebSocketManager;
  private statusMessage: Message | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private startTime: Date;
  private lastCpuSample: { idle: number; total: number } | null = null;
  private isUpdating = false;
  private mongoStatusCache: { at: number; value: { status: string; connection: string; collections: string; dataSize: string; indexSize: string } } | null = null;
  private static readonly MONGO_STATUS_TTL_MS = 5 * 60 * 1000;

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.wsManager = wsManager;
    this.startTime = new Date();
  }

  public async start() {
    try {
      if (this.updateInterval) {
        return;
      }

      await this.sendStatusEmbed();

      this.updateInterval = setInterval(async () => {
        await this.updateStatusEmbed();
      }, 30 * 1000); 

      if (!this.statusMessage) {
        console.warn('[BotStatusTask] Initial status post failed; will retry every 30 seconds');
      }

      console.log('[BotStatusTask] Started with 30-second updates');
    } catch (error) {
      console.error('[BotStatusTask] Error starting status task:', error);
    }
  }

  public stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private async sendStatusEmbed() {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.error('[BotStatusTask] No guild found');
        return;
      }

      const channelId = config.channels.botstatusChannel;
      if (!channelId) {
        console.error('[BotStatusTask] BOT_STATUS_CHANNEL_ID is not configured');
        return;
      }

      const channel = (guild.channels.cache?.get(channelId) ?? await guild.channels.fetch(channelId)) as TextChannel;
      if (!channel || !channel.isTextBased()) {
        console.error('[BotStatusTask] Bot status channel not found or not text-based');
        return;
      }

      const embed = await this.createStatusEmbed();
      const adopted = await this.findOwnStatusMessage(channel);
      if (adopted) {
        try {
          await adopted.edit({ embeds: [embed] });
          this.statusMessage = adopted;
          return;
        } catch (error) {
          console.warn('[BotStatusTask] Could not edit the existing status message; posting a new one:', error);
        }
      }
      this.statusMessage = await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[BotStatusTask] Error sending status embed:', error);
    }
  }

  private async findOwnStatusMessage(channel: TextChannel): Promise<Message | null> {
    try {
      const ownId = this.client.user?.id;
      if (!ownId) return null;
      const messages = await channel.messages.fetch({ limit: 10 });
      for (const message of messages.values()) {
        if (message.author?.id === ownId && message.embeds?.some(embed => (embed.title ?? embed.description ?? '').includes(STATUS_EMBED_TITLE))) {
          return message;
        }
      }
    } catch (error) {
      console.error('[BotStatusTask] Error finding status message:', error);
    }
    return null;
  }

  private async updateStatusEmbed() {
    if (this.isUpdating) return;
    this.isUpdating = true;
    try {
      if (!this.statusMessage) {
        console.log('[BotStatusTask] No status message found, creating new one');
        await this.sendStatusEmbed();
        return;
      }

      const embed = await this.createStatusEmbed();
      
      await this.statusMessage.edit({ embeds: [embed] });
    } catch (error) {
      const code = this.discordErrorCode(error);
      if (code === 10003) {
        console.warn('[BotStatusTask] Status channel no longer exists; stopping status updates. Check BOT_STATUS_CHANNEL_ID.');
        this.statusMessage = null;
        this.stop();
        return;
      }
      console.error('[BotStatusTask] Error updating status embed:', error);
      this.statusMessage = null;
      await this.sendStatusEmbed();
    } finally {
      this.isUpdating = false;
    }
  }

  private discordErrorCode(error: unknown): number | string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number' || typeof code === 'string') return code;
    return undefined;
  }

  private async createStatusEmbed(): Promise<EmbedBuilder> {
    try {
      const [queueStatus, wsStatus, arenaStatus, mongoStatus] = await Promise.all([
        this.getQueueStatus(),
        this.getWebSocketStatus(),
        this.getArenaStatus(),
        this.getMongoDBStatus()
      ]);
      const botStatus = this.getBotStatus();
      const envStatus = this.getEnvironmentStatus();

      const dbOnline = mongoStatus.status === 'online';
      const wsOnline = wsStatus.connected;
      const healthy = dbOnline && wsOnline;
      const color = healthy
        ? EMBED_THEME.successColor
        : (dbOnline || wsOnline ? STATUS_WARNING_COLOR : EMBED_THEME.errorColor);

      const embed = themedEmbed(color)
        .setTitle(STATUS_EMBED_TITLE)
        .setTimestamp()
        .setDescription(
          healthy
            ? 'All services are online.'
            : (dbOnline || wsOnline ? 'One or more services are degraded.' : 'Core services are offline.')
        );

      embed.addFields(
        {
          name: 'Queues',
          value: [
            `Total • \`${queueStatus.total}\``,
            `Ranked • \`${queueStatus.ranked}\``,
            `Unranked • \`${queueStatus.unranked}\``,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Connection',
          value: [
            `Ping • \`${wsStatus.ping}\``,
            `Plugin • \`${wsOnline ? 'online' : 'offline'}\``,
            `Handshake • \`${wsOnline ? 'ok' : 'failed'}\``,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Arenas',
          value: [
            `Enabled • \`${arenaStatus.enabled}\``,
            `Disabled • \`${arenaStatus.disabled}\``,
            `Reserved • \`${arenaStatus.reserved}\``,
            `Locked • \`${arenaStatus.locked}\``,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Host',
          value: [
            `CPU • \`${botStatus.cpuUsage}%\``,
            `Memory • \`${botStatus.memoryPercent.toFixed(0)}%\``,
            `RAM • \`${botStatus.memoryUse} / ${botStatus.memoryMax} GB\``,
            `Cores • \`${botStatus.cpuCores}\``,
            `Uptime • \`${botStatus.uptime}\``,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Runtime',
          value: [
            `Node.js • \`${envStatus.nodeVersion}\``,
            `TypeScript • \`${envStatus.typescript}\``,
            `discord.js • \`${envStatus.discordJs}\``,
            `Bot • \`${envStatus.botVersion}\``,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Database',
          value: [
            `MongoDB • \`${mongoStatus.status}\``,
            `Connection • \`${mongoStatus.connection}\``,
            `Collections • \`${mongoStatus.collections}\``,
            `Data • \`${mongoStatus.dataSize}\``,
            `Indexes • \`${mongoStatus.indexSize}\``,
          ].join('\n'),
          inline: true,
        },
      );

      return embed;
    } catch (error) {
      console.error('[BotStatusTask] Error creating embed fields:', error);
      return themedEmbed('error')
        .setTitle(STATUS_EMBED_TITLE)
        .setDescription('**Status unavailable**\nThe bot could not collect environment metrics. It will retry on the next refresh.');
    }
  }

  private async getQueueStatus() {
    try {
      const Queue = (await import('../models/Queue')).default;
      const [total, ranked] = await Promise.all([
        Queue.countDocuments(),
        Queue.countDocuments({ isRanked: true })
      ]);

      return { total, ranked, unranked: total - ranked };
    } catch (error) {
      console.error('[BotStatusTask] Error getting queue status:', error);
      return { total: 0, ranked: 0, unranked: 0 };
    }
  }

  private async getWebSocketStatus() {
    const cachedPing = this.wsManager.getLastPing?.() ?? null;
    const ping = cachedPing ?? (typeof this.wsManager.getPing === 'function'
      ? await this.wsManager.getPing().catch(() => null)
      : null);
    return {
      ping: ping !== null ? `${ping}ms` : 'offline',
      connected: ping !== null,
    };
  }

  private async getArenaStatus() {
    try {
      
      const reservedMaps = this.wsManager.getReservedMaps?.() || [];
      const disabledMaps = this.wsManager.getDisabledMaps?.() || [];
      const lockedMaps = this.wsManager.getLockedMaps?.() || [];
      const allMaps = this.wsManager.getAllMaps?.() || [];

      let enabled = 0;
      
      const reserved = reservedMaps.length;
      const disabled = disabledMaps.length;
      const locked = lockedMaps.length;
      enabled = Math.max(0, allMaps.length - disabled);

      return { enabled, disabled, reserved, locked };
    } catch (error) {
      console.error('[BotStatusTask] Error getting arena status:', error);
      return { enabled: 0, disabled: 0, reserved: 0, locked: 0 };
    }
  }

  private getBotStatus() {
    const cpuCores = os.cpus().length;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    
    
    const cpuPercent = this.getCPUUsage();
    
    
    const uptimeMs = Date.now() - this.startTime.getTime();
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const uptimeSeconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
    
    return {
      cpuCores,
      cpuUsage: cpuPercent.toFixed(2), 
      memoryMax: (totalMemory / (1024 * 1024 * 1024)).toFixed(2),
      memoryUse: (usedMemory / (1024 * 1024 * 1024)).toFixed(2),
      memoryPercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
      uptime: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`
    };
  }

  private getCPUUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;

    if (!this.lastCpuSample) {
      this.lastCpuSample = { idle, total };
      return 0;
    }

    const idleDelta = idle - this.lastCpuSample.idle;
    const totalDelta = total - this.lastCpuSample.total;
    this.lastCpuSample = { idle, total };

    if (totalDelta <= 0) return 0;
    const usage = 100 - (100 * idleDelta) / totalDelta;

    return Math.max(0, Math.min(100, usage));
  }

  private getEnvironmentStatus() {
    const tsVersion = botPackage.devDependencies?.['typescript']?.replace('^', '') || 'unknown';
    
    
    const botVersion = `${botPackage.version}`;
    const discordJsVersion = botPackage.dependencies?.['discord.js']?.replace('^', '') || 'unknown';
    
    return {
      nodeVersion: `v${process.version.slice(1)}`,
      typescript: tsVersion,
      discordJs: discordJsVersion,
      botVersion: botVersion
      };
  }

  private async getMongoDBStatus() {
    try {
      const now = Date.now();
      if (this.mongoStatusCache && now - this.mongoStatusCache.at < BotStatusTask.MONGO_STATUS_TTL_MS) {
        return this.mongoStatusCache.value;
      }
      const connectionState = mongoose.connection.readyState;
      const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
      const status = states[connectionState] || 'unknown';
      const db = mongoose.connection.db;
      const collections = db ? (await db.listCollections().toArray()).length : 0;
      let dataSize = '0MB';
      let indexSize = '0MB';
      if (db) {
        try {
          const stats = await db.stats();
          dataSize = (stats.dataSize / (1024 * 1024)).toFixed(2) + 'MB';
          indexSize = (stats.indexSize / (1024 * 1024)).toFixed(2) + 'MB';
        } catch {

        }
      }
      const value = {
        status: status === 'connected' ? 'online' : status,
        connection: connectionState === 1 ? 'established' : 'failed',
        collections: collections.toString(),
        dataSize,
        indexSize
      };
      this.mongoStatusCache = { at: now, value };
      return value;
    } catch {
      return {
        status: 'error',
        connection: 'failed',
        collections: '0',
        dataSize: '0MB',
        indexSize: '0MB'
      };
    }
  }
}