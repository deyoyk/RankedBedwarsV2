
const activeScreenshareThreads: {
  [ign: string]: {
    sessionId: string;
    threadId: string;
    expiresAt: number;
  }
} = {};

import { WebSocketServer, WebSocket } from 'ws';
import { MapInfo, MapsJsonPayload } from '../types/MapInfoMemory';
import * as http from 'http';
import express from 'express';
import config from '../config/config';
import { escapeRegex } from '../utils/regexEscape';
 


interface WarpPlayersPayload {
  type: 'warp_players';
  game_id: string;
  map: string;
  is_ranked: boolean;
  team1: any;
  team2: any;
}

interface VerificationPayload {
  type: 'verification';
  ign: string;
  code: string;
}

interface CheckPlayerPayload {
  type: 'check_player';
  ign: string;
}

interface ScoringPayload {
  type: 'scoring';
  gameid: string;
  winningTeamNumber?: number;
  winningteamignlist?: string[];
  mvps: string[];
  bedsbroken: string[];
  players: Record<string, any>;
}

interface PingPayload {
  type: 'ping';
  ping_id?: string;
  timestamp?: number;
}

interface PongPayload {
  type: 'pong';
  ping_id?: string;
  timestamp: number;
  server_online?: number;
  server_max?: number;
  server_tps?: number;
}

interface CallCommandPayload {
  type: 'callcmd';
  callId: string;
  requester: string;
  target: string;
}

interface QueueFromInGamePayload {
  type: 'queuefromingame';
  ign: string;
  uuid: string;
}

interface QueueStatusPayload {
  type: 'queuestatus';
  queues: Record<string, any>;
  timestamp: number;
}

interface AutoSSPayload {
  type: 'autoss';
  targetign: string;
  requestign: string;
  uuid: string;
}

interface PlayerStatusUpdatePayload {
  type: 'player_status_update';
  ign: string;
  online: boolean;
  original_ign_case?: string;
}

interface ScreenShareDontLogPayload {
  type: 'screensharedontlog';
  ign: string;
  uuid: string;
}

interface ScreenShareDontLogSuccessPayload {
  type: 'screensharedontlog_success';
  uuid: string;
}

interface ScreenShareDontLogFailurePayload {
  type: 'screensharedontlog_failure';
  uuid: string;
}

interface CallSuccessPayload {
  type: 'callsuccess';
  callId: string;
}

interface CallFailurePayload {
  type: 'callfailure';
  callId: string;
  reason: string;
}

interface QueueFromInGameSuccessPayload {
  type: 'queuefromingame_success';
  uuid: string;
}

interface QueueFromInGameFailurePayload {
  type: 'queuefromingame_fail';
  reason: string;
  uuid: string;
}

interface AutoSSSuccessPayload {
  type: 'autoss_success';
  uuid: string;
}

interface AutoSSFailurePayload {
  type: 'autoss_fail';
  uuid: string;
}

interface BotBanPayload {
  type: 'botban';
  ign: string;
  reason: string;
  duration?: number;
}

interface BotMutePayload {
  type: 'botmute';
  ign: string;
  reason: string;
  duration?: number;
}

interface BotUnbanPayload {
  type: 'botunban';
  ign: string;
  reason: string;
}

interface BotUnmutePayload {
  type: 'botunmute';
  ign: string;
  reason: string;
}

interface ScoringSuccessPayload {
  type: 'scoringsuccess';
  gameid: number;
  players: string[];
}

interface GameVoidedPayload {
  type: 'gamevoided';
  gameid: number;
  reason: string;
  players: string[];
}

interface GameStartPayload {
  type: 'game_start';
  game_id: string;
  gameid?: string;
  arena: string;
  timestamp?: number;
}

interface MapsInfoPayload {
  type: 'maps_info';
  reserved: any[];
  locked: any[];
  disabled: any[];
}

interface PlayerStatusPayload {
  type: 'player_status';
  ign: string;
  online: boolean;
  original_ign_case?: string;
}

interface PermissionPayload {
  type: 'permission';
  [command: string]: string[] | 'permission';
}

interface VoidingPayload {
  type: 'voiding';
  gameid: string;
  reason: string;
}

type IncomingPayload =
  | WarpPlayersPayload
  | VerificationPayload
  | CheckPlayerPayload
  | ScoringPayload
  | PingPayload
  | PongPayload
  | CallCommandPayload
  | QueueFromInGamePayload
  | QueueStatusPayload
  | AutoSSPayload
  | PlayerStatusUpdatePayload
  | ScreenShareDontLogPayload
  | ScreenShareDontLogSuccessPayload
  | ScreenShareDontLogFailurePayload
  | CallSuccessPayload
  | CallFailurePayload
  | QueueFromInGameSuccessPayload
  | QueueFromInGameFailurePayload
  | AutoSSSuccessPayload
  | AutoSSFailurePayload
  | BotBanPayload
  | BotMutePayload
  | BotUnbanPayload
  | BotUnmutePayload
  | ScoringSuccessPayload
  | GameVoidedPayload
  | GameStartPayload
  | MapsInfoPayload
  | PlayerStatusPayload
  | PermissionPayload
  | VoidingPayload
  | any;

export class WebSocketManager {
  
  private async handleAutoSS(msg: any) {
    const { targetign, requestign, uuid } = msg;
    if (!targetign || !requestign || !uuid) {
      this.send({ type: 'autoss_fail', uuid });
      return;
    }
    try {
      const User = (await import('../models/User')).default;
      const targetUser = await User.findOne({ ign: { $regex: new RegExp(`^${escapeRegex(targetign)}$`, 'i') } });
      const requesterUser = await User.findOne({ ign: { $regex: new RegExp(`^${escapeRegex(requestign)}$`, 'i') } });
      
      if (!targetUser || !requesterUser) {
        this.send({ type: 'autoss_fail', uuid });
        return;
      }

      const guild = this.discordClient.guilds.cache.first();
      if (!guild) {
        this.send({ type: 'autoss_fail', uuid });
        return;
      }

      const { ScreenshareService } = await import('../services/ScreenshareService');
      const result = await ScreenshareService.createSession(
        guild,
        targetUser.discordId,
        requesterUser.discordId,
        'Auto screenshare request from ingame',
        ''
      );

      if (result.success) {
        this.send({ type: 'autoss_success', uuid });
      } else {
        this.send({ type: 'autoss_fail', uuid });
      }
    } catch (e) {
      console.error('[WebSocketManager] autoss error:', e);
      this.send({ type: 'autoss_fail', uuid });
    }
  }
  private wss: WebSocketServer;
  private client: WebSocket | null = null;
  private allMaps: MapInfo[] = [];
  private reservedMaps: MapInfo[] = [];
  private lockedMaps: MapInfo[] = [];
  private disabledMaps: MapInfo[] = [];
  
  
  
  private checkPlayerCallbacks: Map<string, (online: boolean, original_ign_case?: string) => void> = new Map();
  private listeners: { [type: string]: Set<(msg: any) => void> } = {};
  private globalHandlers: { [type: string]: ((msg: any) => void) | undefined } = {};
  private gameManager: any = null;
  private queueStatusInterval: NodeJS.Timeout | null = null;
  private dontLogCallbacks: Map<string, (result: { online: boolean; dontlog: boolean }) => void> = new Map();

  // fallow-ignore-next-line unused-export — used via global._wsManager
  public async requestDontLog(ign: string, uuid: string): Promise<{ online: boolean; dontlog: boolean }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.dontLogCallbacks.delete(uuid);
        resolve({ online: false, dontlog: false });
      }, 10000);

      this.dontLogCallbacks.set(uuid, (result) => {
        clearTimeout(timeout);
        this.dontLogCallbacks.delete(uuid);
        resolve(result);
      });
      this.send({ type: 'screensharedontlog', ign, uuid });
    });
  }
  
  private permissions: Record<string, string[]> = {};
  
  public server: http.Server;
  public app: express.Application;

  public setGlobalHandler(type: string, handler: (msg: any) => void) {
    this.globalHandlers[type] = handler;
  }
  private discordClient: any; 

  constructor(port: number, discordClient?: any, path?: string) {
    this.app = express();
    this.server = http.createServer(this.app);
    
    this.wss = new WebSocketServer({ 
      server: this.server,
      path: path
    });
    
    this.discordClient = discordClient;
    
    global._wsManager = this;
    
    this.wss.on('connection', (ws, req) => {
      console.log('[WebSocketManager] New WebSocket connection established');
      
      // Store the connection but don't assign to this.client until authenticated
      let isAuthenticated = false;
      
      ws.on('message', (data) => {
        if (!isAuthenticated) {
          // First message must be authentication
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch (e) {
            console.error('[WebSocketManager] Invalid JSON in auth message:', data.toString());
            ws.send(JSON.stringify({ type: 'auth_failure', message: 'Invalid JSON format' }));
            ws.close();
            return;
          }
          
          if (msg.type === 'auth' && msg.auth_key === process.env.AUTH_KEY) {
            isAuthenticated = true;
            this.client = ws; 
            console.log('[WebSocketManager] Client authenticated successfully');
            ws.send(JSON.stringify({ type: 'auth_success', message: 'Authentication successful' }));
          } else {
            console.error('[WebSocketManager] Authentication failed for new connection');
            ws.send(JSON.stringify({ type: 'auth_failure', message: 'Invalid authentication key' }));
            ws.close();
            return;
          }
        } else {
          this.handleMessage(data.toString());
        }
      });
      
      ws.on('close', () => {
        if (this.client === ws) {
          this.client = null;
        }
        this.stopQueueStatusBroadcast();
      });
    });
    
    
    this.startServer(port, path);
    this.startQueueStatusBroadcast();
  }
  
  private startServer(port: number, path?: string): void {
    this.server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`[WebSocketManager] Port ${port} is already in use. Cannot start WebSocket server.`);
      } else {
        console.error('[WebSocketManager] Server error:', e);
      }
    });
    
    this.server.listen(port, () => {
      console.log(`[WebSocketManager] Listening on port ${port}${path ? ` with path ${path}` : ''}`);
    });
  }

  private async handleMessage(data: string) {
    let msg: IncomingPayload;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error('[WebSocketManager] Invalid JSON:', data);
      return;
    }
    
    if (msg.type === 'auth') {
      const authMsg = msg as { type: 'auth'; auth_key: string };
      if (authMsg.auth_key === process.env.AUTH_KEY) {
        this.send({ type: 'auth_success', message: 'Authentication successful' });
        console.log('[WebSocketManager] Authentication successful');
      } else {
        this.send({ type: 'auth_failure', message: 'Invalid authentication key' });
        console.error('[WebSocketManager] Authentication failed');
        if (this.client) {
          this.client.close();
        }
      }
      return;
    }
    
    if (!msg.type) {
      console.error('[WebSocketManager] Message missing type:', msg);
      return;
    }
    
    if (msg.type && this.globalHandlers[msg.type]) {
      this.globalHandlers[msg.type]?.(msg);
      return;
    }

    switch (msg.type) {
      case 'autoss':
        await this.handleAutoSS(msg);
        break;
      case 'player_status_update':
        await this.handlePlayerStatusUpdate(msg);
        break;
      case 'screensharedontlog_success':
        this.handleDontLogCallback(msg, true);
        break;
      case 'screensharedontlog_failure':
        this.handleDontLogCallback(msg, false);
        break;
      case 'ping':
        this.send({ type: 'pong', ping_id: msg.ping_id, timestamp: Date.now() });
        break;
      case 'callcmd':
        this.handleCallCommand(msg as CallCommandPayload);
        break;
      case 'queuefromingame':
        this.handleQueueFromInGame(msg as QueueFromInGamePayload);
        break;
      case 'game_start':
        this.handleGameStart(msg);
        break;
      case 'maps_info':
        this.handleMapsInfo(msg as MapsJsonPayload);
        break;
      case 'player_status':
        this.handlePlayerStatus(msg);
        break;
      case 'permission':
        this.handlePermission(msg);
        break;
      case 'scoring':
        this.handleScoring(msg);
        break;
      case 'voiding':
        this.handleVoiding(msg);
        break;
      default:
        if (msg.type && this.listeners[msg.type]) {
          for (const cb of this.listeners[msg.type]) {
            cb(msg);
          }
        }
        break;
    }
  }

  private async handlePlayerStatusUpdate(msg: any) {
    const ignKey = msg.ign?.toLowerCase();
    const threadInfo = ignKey ? activeScreenshareThreads[ignKey] : undefined;
    if (threadInfo && Date.now() < threadInfo.expiresAt) {
      try {
        const guild = this.discordClient.guilds.cache.first();
        if (guild) {
          const thread = await guild.channels.fetch(threadInfo.threadId);
          if (thread && thread.isTextBased()) {
            const statusMsg = msg.online
              ? `**${msg.original_ign_case || msg.ign}** joined the server.`
              : `**${msg.original_ign_case || msg.ign}** left the server.`;
            await thread.send(statusMsg);
          }
        }
      } catch (e) {
        console.error('[WebSocketManager] Failed to send player status update to thread:', e);
      }
    }
  }

  private handleDontLogCallback(msg: any, success: boolean) {
    if (msg.uuid && this.dontLogCallbacks.has(msg.uuid)) {
      this.dontLogCallbacks.get(msg.uuid)!({ online: success, dontlog: success });
      this.dontLogCallbacks.delete(msg.uuid);
    }
  }

  private handleGameStart(msg: any) {
    (async () => {
      try {
        const gameIdRaw = msg.game_id || msg.gameid;
        let gameId = gameIdRaw;

        const Game = (await import('../models/Game')).default;
        const game = await Game.findOne({ gameId: parseInt(gameId) });
        if (!game) return;
        const guild = this.discordClient.guilds.cache.first();
        if (!guild) return;

        let channel;
        try {
          channel = await guild.channels.fetch(game.channels.text);
        } catch (err: any) {
          if (err.code === 10003) {
            console.warn(`[WebSocketManager] Channel ${game.channels.text} not found (may have been deleted).`);
            return;
          } else {
            throw err;
          }
        }
        if (!channel) return;

        const { successEmbed } = require('../utils/betterembed');
        const embed = successEmbed(
          `Game started in arena: \`${msg.arena || 'Unknown'}\`\nStart time: <t:${Math.floor((msg.timestamp || Date.now())/1000)}:F>`,
          'Game Started!'
        ).builder;
        embed.setTimestamp(new Date(msg.timestamp || Date.now()));
        await channel.send({ embeds: [embed] });
      } catch (err) {
        console.error('[WebSocketManager] Error handling game_start:', err);
      }
    })();
  }

  private handleMapsInfo(payload: MapsJsonPayload) {
    const reservedMapsArr = Array.isArray(payload.reserved) ? payload.reserved : [];
    const lockedMapsArr = Array.isArray(payload.locked) ? payload.locked : [];
    const disabledMapsArr = Array.isArray(payload.disabled) ? payload.disabled : [];
    const allMapsMap = new Map<string, any>();
    for (const m of [...reservedMapsArr, ...lockedMapsArr, ...disabledMapsArr]) {
      allMapsMap.set(m.name, {
        ...m,
        maxplayers: (m as any).maxplayers ?? (m as any).max_players,
        max_players: (m as any).max_players ?? (m as any).maxplayers
      });
    }
    this.allMaps = Array.from(allMapsMap.values());
    this.reservedMaps = reservedMapsArr.map((m: any) => ({
      ...m,
      maxplayers: (m as any).maxplayers ?? (m as any).max_players,
      max_players: (m as any).max_players ?? (m as any).maxplayers
    }));
    this.lockedMaps = lockedMapsArr.map((m: any) => ({
      ...m,
      maxplayers: (m as any).maxplayers ?? (m as any).max_players,
      max_players: (m as any).max_players ?? (m as any).maxplayers
    }));
    this.disabledMaps = disabledMapsArr.map((m: any) => ({
      ...m,
      maxplayers: (m as any).maxplayers ?? (m as any).max_players,
      max_players: (m as any).max_players ?? (m as any).maxplayers
    }));
  }

  private handlePlayerStatus(msg: any) {
    const ign = msg.ign;
    const cb = this.checkPlayerCallbacks.get(ign);
    if (cb) {
      cb(msg.online, msg.original_ign_case);
      this.checkPlayerCallbacks.delete(ign);
    }
  }

  private handlePermission(msg: any) {
    console.log('[WebSocketManager] Received permission settings');
    const permissionsUpdate = { ...msg };
    delete permissionsUpdate.type;
    for (const [cmd, roles] of Object.entries(permissionsUpdate)) {
      if (Array.isArray(roles)) {
        this.permissions[cmd] = roles;
      }
    }
  }

  private determineWinningTeam(msg: any): number {
    if (msg.winningTeamNumber) return msg.winningTeamNumber;
    if (msg.winningteamignlist && Array.isArray(msg.winningteamignlist)) {
      console.log(`[WebSocketManager] Winning team IGNs: ${msg.winningteamignlist.join(', ')}`);
      return 1;
    }
    console.error('[WebSocketManager] No winning team information provided');
    return 1;
  }

  private calculateMvpsFromStats(players: any, msgMvps?: string[]): string[] {
    if (msgMvps && msgMvps.length > 0) return msgMvps;
    let maxKills = -1;
    let mvps: string[] = [];
    for (const [ign, statsRaw] of Object.entries(players || {})) {
      const stats = statsRaw as any;
      const kills = stats.kills ?? 0;
      if (kills > maxKills) {
        maxKills = kills;
        mvps = [ign];
      } else if (kills === maxKills) {
        mvps.push(ign);
      }
    }
    return mvps;
  }

  private buildPlayerData(players: any, bedbreaks: string[]): Record<string, any> {
    const playerData: Record<string, any> = {};
    for (const [ign, statsRaw] of Object.entries(players || {})) {
      const stats = statsRaw as any;
      playerData[ign] = {
        kills: stats.kills ?? 0,
        deaths: stats.deaths ?? 0,
        bedBroken: bedbreaks.includes(ign) ? 1 : 0,
        finalKills: stats.finalkills ?? 0,
        diamonds: stats.diamonds ?? 0,
        irons: stats.irons ?? 0,
        gold: stats.gold ?? 0,
        emeralds: stats.emeralds ?? 0,
        blocksPlaced: stats.blocksplaced ?? 0
      };
    }
    return playerData;
  }

  private handleScoring(msg: any) {
    console.log('[WebSocketManager] Received scoring JSON:', JSON.stringify(msg, null, 2));
    
    if (!this.gameManager) {
      console.error('[WebSocketManager] GameManager not available for scoring');
      return;
    }
    
    const { gameid, winningteamignlist, players, mvps: msgMvps, bedsbroken: msgBedsbroken } = msg;
    const winningTeam = this.determineWinningTeam(msg);
    const mvps = this.calculateMvpsFromStats(players, msgMvps);
    const bedbreaks: string[] = msgBedsbroken || [];
    const playerData = this.buildPlayerData(players, bedbreaks);

    (async () => {
      try {
        await this.gameManager!.scoreGame({
          gameId: parseInt(gameid),
          winningTeam,
          winningTeamIGNs: winningteamignlist || [],
          mvps,
          bedbreaks,
          playerData,
          reason: 'Game completed'
        });
        console.log(`[WebSocketManager] Successfully scored game ${gameid} via GameManager`);
      } catch (error) {
        console.error(`[WebSocketManager] Error scoring game ${gameid} via GameManager:`, error);
      }
    })();
  }

  private handleVoiding(msg: any) {
    if (!this.gameManager) {
      console.error('[WebSocketManager] GameManager not available for voiding');
      return;
    }
    const { gameid, reason } = msg;
    (async () => {
      try {
        await this.gameManager!.voidGame(parseInt(gameid), reason || 'Voided via WebSocket');
        console.log(`[WebSocketManager] Successfully voided game ${gameid} via GameManager`);
      } catch (error) {
        console.error(`[WebSocketManager] Error voiding game ${gameid} via GameManager:`, error);
      }
    })();
  }

  public getAllMaps(): MapInfo[] {
    return this.allMaps;
  }

  public getReservedMaps(): MapInfo[] {
    return this.reservedMaps;
  }

  public getLockedMaps(): MapInfo[] {
    return this.lockedMaps;
  }

  public getDisabledMaps(): MapInfo[] {
    return this.disabledMaps;
  }

  
  

  public send(payload: object) {
    if (this.client && this.client.readyState === this.client.OPEN) {
      this.client.send(JSON.stringify(payload));
    }
  }
  // WIERD ASS AUTH METHOD. IF IT WORKS IT WORKS.
  public async checkPlayerOnline(ign: string): Promise<{ online: boolean; original_ign_case?: string }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.checkPlayerCallbacks.delete(ign);
        resolve({ online: false });
      }, 10000);

      this.checkPlayerCallbacks.set(ign, (online, original_ign_case) => {
        clearTimeout(timeout);
        this.checkPlayerCallbacks.delete(ign);
        resolve({ online, original_ign_case });
      });
      this.send({ type: 'check_player', ign });
    });
  }

  // fallow-ignore-next-line unused-export — used via global._wsManager
  public getPermission(command: string): string[] {
    return this.permissions[command] || [];
  }

  public async getPing(): Promise<number | null> {
    const client = this.client;
    if (!client || client.readyState !== client.OPEN) return null;
    return new Promise((resolve) => {
      const localTimestamp = Date.now();
      const pongHandler = (data: any) => {
        try {
          const msg = typeof data === 'string' ? JSON.parse(data) : data;
          if (msg.type === 'pong') {
            client.off('message', pongHandler);
            resolve(Date.now() - localTimestamp);
          }
        } catch (e) {
        }
      };
      client.on('message', pongHandler);
      this.send({ type: 'ping', timestamp: localTimestamp });
      setTimeout(() => {
        client.off('message', pongHandler);
        resolve(null);
      }, 2000);
    });
  }

  private async handleCallCommand(msg: CallCommandPayload): Promise<void> {
    try {
      console.log(`[WebSocketManager] Handling call command: ${JSON.stringify(msg)}`);
      const { callId, requester, target } = msg;
      
      if (!callId || !requester || !target) {
        console.error('[WebSocketManager] Invalid call command payload:', msg);
        this.send({
          type: 'callfailure',
          callId: callId || '',
          reason: 'Missing required fields in payload'
        } as CallFailurePayload);
        return;
      }

      
      const User = (await import('../models/User')).default;
      
      
      const requesterUser = await User.findOne({ ign: { $regex: new RegExp(`^${escapeRegex(requester)}$`, 'i') } });
      if (!requesterUser) {
        console.error(`[WebSocketManager] Requester ${requester} not found in database`);
        this.send({
          type: 'callfailure',
          callId,
          reason: 'Requester not found in database'
        } as CallFailurePayload);
        return;
      }

      
      const targetUser = await User.findOne({ ign: { $regex: new RegExp(`^${escapeRegex(target)}$`, 'i') } });
      if (!targetUser) {
        console.error(`[WebSocketManager] Target ${target} not found in database`);
        this.send({
          type: 'callfailure',
          callId,
          reason: 'Target player not found in database'
        } as CallFailurePayload);
        return;
      }

      
      const guild = this.discordClient.guilds.cache.first();
      if (!guild) {
        console.error('[WebSocketManager] Guild not found');
        this.send({
          type: 'callfailure',
          callId,
          reason: 'Discord guild not available'
        } as CallFailurePayload);
        return;
      }

      
      let requesterMember;
      try {
        requesterMember = await guild.members.fetch(requesterUser.discordId);
      } catch (error) {
        console.error(`[WebSocketManager] Could not fetch requester member: ${error}`);
        this.send({
          type: 'callfailure',
          callId,
          reason: 'Requester is not in the Discord server'
        } as CallFailurePayload);
        return;
      }

      const requesterVoiceState = requesterMember.voice;
      if (!requesterVoiceState?.channel) {
        console.error(`[WebSocketManager] Requester ${requester} is not in a voice channel`);
        this.send({
          type: 'callfailure',
          callId,
          reason: 'Requester is not in a voice channel'
        } as CallFailurePayload);
        return;
      }

      const voiceChannel = requesterVoiceState.channel;
      
      
      const Game = (await import('../models/Game')).default;
      const game = await Game.findOne({
        $or: [
          { 'channels.team1Voice': voiceChannel.id },
          { 'channels.team2Voice': voiceChannel.id },
          { 'channels.picking': voiceChannel.id }
        ]
      });

      if (!game) {
        console.error(`[WebSocketManager] Voice channel ${voiceChannel.id} is not associated with a game`);
        this.send({
          type: 'callfailure',
          callId,
          reason: 'Must be in a game voice channel to use call command'
        } as CallFailurePayload);
        return;
      }

      try {
        
        await voiceChannel.permissionOverwrites.create(targetUser.discordId, {
          ViewChannel: true,
          Connect: true,
          Speak: true,
          Stream: true,
          UseVAD: true
        });

        console.log(`[WebSocketManager] Successfully granted call access to ${target} for channel ${voiceChannel.name}`);
        
        
        this.send({
          type: 'callsuccess',
          callId
        } as CallSuccessPayload);
        
        
        try {
          const { successEmbed } = require('../utils/betterembed');
          const gameChannel = await guild.channels.fetch(game.channels.text);
          
          if (gameChannel) {
            const embedObj = successEmbed(
              `${target} has been granted access to join and speak in ${voiceChannel.name}.`,
              'Call Access Granted'
            );
            embedObj.builder.addFields(
              { name: 'Voice Channel', value: `<#${voiceChannel.id}>`, inline: true },
              { name: 'Game ID', value: `#${game.gameId}`, inline: true },
              { name: 'Granted by', value: `${requester}`, inline: true }
            );
            embedObj.builder.setFooter({ text: 'The user can now join and speak in this voice channel.' });
            embedObj.builder.setTimestamp();
            
            await gameChannel.send({ embeds: [embedObj.builder] });
          }
        } catch (notifyError) {
          console.error(`[WebSocketManager] Error sending call notification: ${notifyError}`);
          
        }
        
      } catch (permError) {
        console.error(`[WebSocketManager] Error granting voice permissions: ${permError}`);
        this.send({
          type: 'callfailure',
          callId,
          reason: 'Failed to grant voice channel permissions'
        } as CallFailurePayload);
      }
      
    } catch (error) {
      console.error('[WebSocketManager] Error handling call command:', error);
      this.send({
        type: 'callfailure',
        callId: msg.callId || '',
        reason: 'Internal server error'
      } as CallFailurePayload);
    }
  }

  private async handleQueueFromInGame(msg: QueueFromInGamePayload): Promise<void> {
    try {
      console.log(`[WebSocketManager] Handling queue from in game: ${JSON.stringify(msg)}`);
      const { ign, uuid } = msg;
      
      if (!ign) {
        console.error('[WebSocketManager] Invalid queuefromingame payload - missing ign');
        this.send({
          type: 'queuefromingame_fail',
          reason: 'Missing IGN in payload',
          uuid
        } as QueueFromInGameFailurePayload);
        return;
      }

      
      const User = (await import('../models/User')).default;
      const user = await User.findOne({ ign: { $regex: new RegExp(`^${escapeRegex(ign)}$`, 'i') } });
      if (!user) {
        console.error(`[WebSocketManager] User ${ign} not found in database`);
        this.send({
          type: 'queuefromingame_fail',
          reason: 'User not found in database',
          uuid
        } as QueueFromInGameFailurePayload);
        return;
      }

      
      const guild = this.discordClient.guilds.cache.first();
      if (!guild) {
        console.error('[WebSocketManager] Guild not found');
        this.send({
          type: 'queuefromingame_fail',
          reason: 'Discord guild not available',
          uuid
        } as QueueFromInGameFailurePayload);
        return;
      }

      
      let member;
      try {
        member = await guild.members.fetch(user.discordId);
      } catch (error) {
        console.error(`[WebSocketManager] Could not fetch member: ${error}`);
        this.send({
          type: 'queuefromingame_fail',
          reason: 'User is not in the Discord server',
          uuid
        } as QueueFromInGameFailurePayload);
        return;
      }

      
      const voiceState = member.voice;
      if (!voiceState?.channel) {
        console.error(`[WebSocketManager] User ${ign} is not in a voice channel`);
        this.send({
          type: 'queuefromingame_fail',
          reason: 'User is not in a voice channel',
          uuid
        } as QueueFromInGameFailurePayload);
        return;
      }

      

      
      const Queue = (await import('../models/Queue')).default;
      const suitableQueues = await Queue.find({
        minElo: { $lte: user.elo },
        maxElo: { $gte: user.elo }
      });

      if (suitableQueues.length === 0) {
        console.error(`[WebSocketManager] No suitable queues found for user ${ign} with ELO ${user.elo}`);
        this.send({
          type: 'queuefromingame_fail',
          reason: `No queues available for your ELO range (${user.elo})`,
          uuid
        } as QueueFromInGameFailurePayload);
        return;
      }

      
      const { queuePlayers } = await import('../types/queuePlayersMemory');

      
      let targetQueue = suitableQueues[0];
      let maxPlayers = 0;

      for (const queue of suitableQueues) {
        const playersInQueue = queuePlayers.get(queue.channelId) || [];
        if (playersInQueue.length > maxPlayers) {
          maxPlayers = playersInQueue.length;
          targetQueue = queue;
        }
      }

      
      const queuesWithMaxPlayers = suitableQueues.filter(queue => {
        const playersInQueue = queuePlayers.get(queue.channelId) || [];
        return playersInQueue.length === maxPlayers;
      });

      if (queuesWithMaxPlayers.length > 1) {
        targetQueue = queuesWithMaxPlayers[Math.floor(Math.random() * queuesWithMaxPlayers.length)];
      }

      
      let queueVoiceChannel;
      try {
        queueVoiceChannel = await guild.channels.fetch(targetQueue.channelId);
      } catch (error) {
        console.error(`[WebSocketManager] Could not fetch queue voice channel: ${error}`);
        this.send({
          type: 'queuefromingame_fail',
          reason: 'Queue voice channel not found',
          uuid
        } as QueueFromInGameFailurePayload);
        return;
      }

      if (!queueVoiceChannel || !queueVoiceChannel.isVoiceBased()) {
        console.error(`[WebSocketManager] Queue channel ${targetQueue.channelId} is not a voice channel`);
        this.send({
          type: 'queuefromingame_fail',
          reason: 'Queue channel is not a voice channel',
          uuid
        } as QueueFromInGameFailurePayload);
        return;
      }

      try {
        
        await member.voice.setChannel(queueVoiceChannel);

        
        const currentPlayers = queuePlayers.get(targetQueue.channelId) || [];
        if (!currentPlayers.includes(user.discordId)) {
          currentPlayers.push(user.discordId);
          queuePlayers.set(targetQueue.channelId, currentPlayers);
        }

        console.log(`[WebSocketManager] Successfully moved ${ign} to queue ${queueVoiceChannel.name}`);
        
        this.send({
          type: 'queuefromingame_success',
          uuid
        } as QueueFromInGameSuccessPayload);

      } catch (moveError) {
        console.error(`[WebSocketManager] Error moving user to queue: ${moveError}`);
        this.send({
          type: 'queuefromingame_fail',
          reason: 'Failed to move user to queue voice channel',
          uuid
        } as QueueFromInGameFailurePayload);
      }

    } catch (error) {
      console.error('[WebSocketManager] Error handling queuefromingame:', error);
      this.send({
        type: 'queuefromingame_fail',
        reason: 'Internal server error',
        uuid: msg.uuid
      } as QueueFromInGameFailurePayload);
    }
  }

  private startQueueStatusBroadcast(): void {
    
    this.queueStatusInterval = setInterval(async () => {
      try {
        await this.broadcastQueueStatus();
      } catch (error) {
        console.error('[WebSocketManager] Error broadcasting queue status:', error);
      }
    }, 1000); 

    console.log('[WebSocketManager] Queue status broadcast started');
  }

  private async broadcastQueueStatus(): Promise<void> {
    
    if (!this.client || this.client.readyState !== this.client.OPEN) {
      return;
    }

    try {
      
      const Queue = (await import('../models/Queue')).default;
      const User = (await import('../models/User')).default;
      const { queuePlayers } = await import('../types/queuePlayersMemory');

      
      const queues = await Queue.find().sort({ channelId: 1 });
      
      const queueStatus: Record<string, any> = {};

      const allMemberIds = new Set<string>();
      const channelMemberMap = new Map<string, { channelId: string; members: Map<string, any> }>();

      
      if (this.discordClient) {
        const guild = this.discordClient.guilds.cache.first();
        if (guild) {
          for (const queue of queues) {
            try {
              const channel = await guild.channels.fetch(queue.channelId);
              if (channel && channel.isVoiceBased()) {
                channelMemberMap.set(queue.channelId, { channelId: queue.channelId, members: channel.members });
                for (const [memberId] of channel.members) {
                  allMemberIds.add(memberId);
                }
              }
            } catch (err: any) {
            }
          }
        }
      }

      
      const memberIdsArray = Array.from(allMemberIds);
      const userMap = new Map<string, string>();
      if (memberIdsArray.length > 0) {
        const users = await User.find({ discordId: { $in: memberIdsArray } }).select('discordId ign');
        for (const user of users) {
          if (user.ign) userMap.set(user.discordId, user.ign);
        }
      }

      
      for (const queue of queues) {
        let currentPlayerCount = 0;
        const playersInQueue: string[] = [];

        const channelData = channelMemberMap.get(queue.channelId);
        if (channelData) {
          currentPlayerCount = channelData.members.size;
          for (const [memberId] of channelData.members) {
            const ign = userMap.get(memberId);
            if (ign) {
              playersInQueue.push(ign);
            }
          }
        }

        queueStatus[queue.channelId] = {
          minElo: queue.minElo,
          maxElo: queue.maxElo,
          currentPlayers: currentPlayerCount,
          maxPlayers: queue.maxPlayers,
          isRanked: queue.isRanked,
          isPicking: queue.ispicking,
          players: playersInQueue
        };
      }

      const queueStatusMessage = {
        type: 'queuestatus',
        queues: queueStatus,
        timestamp: Date.now()
      };

      
      
      this.send(queueStatusMessage);


    } catch (error) {
      console.error('[WebSocketManager] Error in broadcastQueueStatus:', error);
    }
  }

  private stopQueueStatusBroadcast(): void {
    if (this.queueStatusInterval) {
      clearInterval(this.queueStatusInterval);
      this.queueStatusInterval = null;
      console.log('[WebSocketManager] Queue status broadcast stopped');
    }
  }

  public setGameManager(gameManager: any): void {
    this.gameManager = gameManager;
  }
}