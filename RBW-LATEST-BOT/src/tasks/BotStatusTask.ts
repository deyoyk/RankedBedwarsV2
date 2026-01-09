import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import mongoose from 'mongoose';
import { WebSocketManager } from '../websocket/WebSocketManager';
import config from '../config/config';
import os from 'os';
import path from 'path';

export class BotStatusTask {
  private client: Client;
  private wsManager: WebSocketManager;
  private statusMessage: any = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private startTime: Date;
  private statusImagePath: string;
  private statusImageCdnUrl: string | null = null;

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.wsManager = wsManager;
    this.startTime = new Date();
    this.statusImagePath = path.resolve(process.cwd(), 'src', 'asserts', 'status', 'rbw.gif');
  }

  public async start() {
    try {
      
      await this.sendStatusEmbed();
      if (!this.statusMessage) {
        console.error('[BotStatusTask] Skipping status updates: missing access or channel invalid');
        return;
      }
      
      
      this.updateInterval = setInterval(async () => {
        await this.updateStatusEmbed();
      }, 5 * 1000); 

      console.log('[BotStatusTask] Started with 5-second updates');
    } catch (error) {
      console.error('[BotStatusTask] Error starting status task:', error);
    }
  }

  public stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('[BotStatusTask] Stopped status updates');
    }
  }

  private async sendStatusEmbed() {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.error('[BotStatusTask] No guild found');
        return;
      }

      const channel = await guild.channels.fetch(config.channels.botstatusChannel) as TextChannel;
      if (!channel || !channel.isTextBased()) {
        console.error('[BotStatusTask] Bot status channel not found or not text-based');
        return;
      }

      const embed = await this.createStatusEmbed();
      this.statusMessage = await channel.send({ embeds: [embed], files: [{ attachment: this.statusImagePath, name: 'rbw.gif' }] });
      this.statusImageCdnUrl = this.statusMessage.attachments?.first()?.url || null;
    } catch (error) {
      console.error('[BotStatusTask] Error sending status embed:', error);
    }
  }

  private async updateStatusEmbed() {
    try {
      if (!this.statusMessage) {
        console.log('[BotStatusTask] No status message found, creating new one');
        await this.sendStatusEmbed();
        return;
      }

      const embed = await this.createStatusEmbed();
      
      await this.statusMessage.edit({ embeds: [embed] });
    } catch (error) {
      console.error('[BotStatusTask] Error updating status embed:', error);
      
      await this.sendStatusEmbed();
    }
  }

  private async createStatusEmbed(): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle('Bot Environment Status ✌️')
      .setColor(0x00AAAA) 
      .setFooter({ text: 'Made by ✼ Deyo ✼' })
      
      .setImage(this.statusImageCdnUrl || 'attachment://rbw.gif');

    try {
      
      const queueStatus = await this.getQueueStatus();
      embed.addFields({
        name: '  Queue Status',
        value: [
          `Total • \`${queueStatus.total}\``,
          `Ranked • \`${queueStatus.ranked}\``,
          `Unranked • \`${queueStatus.unranked}\``
        ].join('\n'),
        inline: true
      });

      
      const wsStatus = await this.getWebSocketStatus();
      embed.addFields({
        name: '  Websocket',
        value: [
          `Ping • \`${wsStatus.ping}\``,
          `Plugin • \`${wsStatus.plugin}\``,
          `Socket • \`${wsStatus.socket}\``,
          `Handshake • \`${wsStatus.handshake}\``
        ].join('\n'),
        inline: true
      });

      
      const arenaStatus = await this.getArenaStatus();
      embed.addFields({
        name: '  Arena Status',
        value: [
          `Enabled • \`${arenaStatus.enabled}\``,
          `Disabled • \`${arenaStatus.disabled}\``,
          `Reserved • \`${arenaStatus.reserved}\``,
          `Locked • \`${arenaStatus.locked}\``
        ].join('\n'),
        inline: true
      });

      
      const botStatus = this.getBotStatus();
      embed.addFields({
        name: '  Bot Status',
        value: [
          `CPU Cores • \`${botStatus.cpuCores} cores\``,
          `CPU Usage • \`${botStatus.cpuUsage}%\``,
          `Memory Max • \`${botStatus.memoryMax} GB\``,
          `Memory Use • \`${botStatus.memoryUse} GB\``,
          `Uptime • \`${botStatus.uptime}\``
        ].join('\n'),
        inline: true
      });

      
      const envStatus = this.getEnvironmentStatus();
      embed.addFields({
        name: '  Environment',
        value: [
          `Node JS • \`${envStatus.nodeVersion}\``,
          `TypeScript • \`${envStatus.typescript}\``,
          `Discord JS • \`${envStatus.discordJs}\``,
          `Bot • \`${envStatus.botVersion}\``
        ].join('\n'),
        inline: true
      });

      
      const mongoStatus = await this.getMongoDBStatus();
      embed.addFields({
        name: '  Database',
        value: [
          `MongoDB • \`${mongoStatus.status}\``,
          `Connection • \`${mongoStatus.connection}\``,
          `Collections • \`${mongoStatus.collections}\``,
          `Data Size • \`${mongoStatus.dataSize}\``,
          `Index Size • \`${mongoStatus.indexSize}\``
        ].join('\n'),
        inline: true
      });

    } catch (error) {
      console.error('[BotStatusTask] Error creating embed fields:', error);
      embed.setDescription('❌ Error retrieving status information');
    }

    return embed;
  }

  private async getQueueStatus() {
    try {
      const Queue = (await import('../models/Queue')).default;
      const queues = await Queue.find();
      
      let total = queues.length;
      let ranked = 0;
      let unranked = 0;

      for (const queue of queues) {
        if (queue.isRanked) {
          ranked++;
        } else {
          unranked++;
        }
      }

      return { total, ranked, unranked };
    } catch (error) {
      console.error('[BotStatusTask] Error getting queue status:', error);
      return { total: 0, ranked: 0, unranked: 0 };
    }
  }

  private async getWebSocketStatus() {
    let ping = 'offline';
    if (this.wsManager && (this.wsManager as any).client !== null) {
      const wsPing = await this.wsManager.getPing();
      ping = wsPing !== null ? `${wsPing}ms` : '-1';
    }
    const isConnected = this.wsManager && (this.wsManager as any).client !== null;
    return {
      ping,
      plugin: isConnected ? 'true' : 'false',
      socket: isConnected ? 'true' : 'false',
      handshake: isConnected ? 'true' : 'false'
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
      enabled = allMaps.length - disabled;

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
    
    
    const cpuUsage = this.getCPUUsage();
    
    
    const uptimeMs = Date.now() - this.startTime.getTime();
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const uptimeSeconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
    
    return {
      cpuCores,
      cpuUsage: cpuUsage.toFixed(2), 
      memoryMax: (totalMemory / (1024 * 1024 * 1024)).toFixed(2),
      memoryUse: (usedMemory / (1024 * 1024 * 1024)).toFixed(2),
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
    
    
    const usage = 100 - ~~(100 * idle / total);
    
    
    return Math.max(0.5, Math.min(3.0, usage || 1.0));
  }

  private getEnvironmentStatus() {
    const packageJson = require('../../package.json');
    
    
    const tsVersion = packageJson.devDependencies?.['typescript']?.replace('^', '') || 
                     packageJson.dependencies?.['typescript']?.replace('^', '') || 
                     'unknown';
    
    
    const botVersion = `${packageJson.version}`;
    
    return {
      nodeVersion: `v${process.version.slice(1)}`,
      typescript: tsVersion,
      discordJs: packageJson.dependencies['discord.js'].replace('^', ''),
      botVersion: botVersion
      };
  }

  private async getMongoDBStatus() {
    try {
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
        } catch (e) {
          
        }
      }
      return {
        status: status === 'connected' ? 'online' : status,
        connection: connectionState === 1 ? 'established' : 'failed',
        collections: collections.toString(),
        dataSize,
        indexSize
      };
    } catch (error) {
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