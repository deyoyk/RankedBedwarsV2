
const activeScreenshareThreads: {
  [ign: string]: {
    sessionId: string;
    threadId: string;
    expiresAt: number;
  }
} = {};

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { PresenceService } from '../services/PresenceService';
import { MapInfo, MapsJsonPayload } from '../types/MapInfoMemory';
import { PlayerData, GameResult } from '../types/GameTypes';
import * as http from 'http';
import express from 'express';
import { escapeRegex } from '../utils/regexEscape';
import { Client, Collection, GuildMember } from 'discord.js';

type MapEntry = MapsJsonPayload['reserved'][number];

type StoredMap = Partial<MapInfo> & { name: string; maxplayers?: number; max_players?: number };

interface WarpTeam {
  players: string[];
}

interface RawPlayerStats {
  kills?: number;
  deaths?: number;
  final_kills?: number;
  finalkills?: number;
  final_deaths?: number;
  finaldeaths?: number;
  diamonds?: number;
  irons?: number;
  gold?: number;
  emeralds?: number;
  blocks_placed?: number;
  blocksplaced?: number;
  damage_dealt?: number;
  damagedealt?: number;
  damage_taken?: number;
  damagetaken?: number;
  assists?: number;
  max_streak?: number;
  maxstreak?: number;
  first_blood?: boolean;
  firstblood?: boolean;
  fights?: unknown;
}

interface BuiltPlayerData extends PlayerData {
  finalDeaths?: number;
}

interface QueueStatusEntry {
  min_elo: number;
  max_elo: number;
  current_players: number;
  max_players: number;
  is_ranked: boolean;
  is_picking: boolean;
  players: string[];
}

interface FightRowRaw {
  kills?: unknown;
  damage_dealt?: unknown;
  damageDealt?: unknown;
  damage?: unknown;
}

interface TimelineEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

interface AuthIncomingPayload {
  type: 'auth';
  auth_key: string;
}

interface GameManagerLike {
  scoreGame(gameResult: GameResult): Promise<unknown>;
  voidGame(gameId: number, reason: string): Promise<unknown>;
}
 


interface WarpPlayersPayload {
  type: 'warp_players';
  game_id: string;
  map: string;
  is_ranked: boolean;
  team1: WarpTeam;
  team2: WarpTeam;
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
  game_id: string;
  gameid?: string;
  winning_team_number?: number;
  winningTeamNumber?: number;
  winning_team_ign_list?: string[];
  winningteamignlist?: string[];
  mvps: string[];
  beds_broken: string[];
  bedsbroken?: string[];
  players: Record<string, RawPlayerStats>;
  timeline?: unknown;
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
  call_id: string;
  callId?: string;
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
  queues: Record<string, QueueStatusEntry>;
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
  call_id: string;
  callId?: string;
}

interface CallFailurePayload {
  type: 'callfailure';
  call_id: string;
  callId?: string;
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
  game_id: number;
  gameid?: number;
  players: string[];
}

interface GameVoidedPayload {
  type: 'gamevoided';
  game_id: number;
  gameid?: number;
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
  reserved: MapEntry[];
  locked: MapEntry[];
  disabled: MapEntry[];
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
  game_id: string;
  gameid?: string;
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
  | AuthIncomingPayload;

export class WebSocketManager {
  
  private async handleAutoSS(msg: AutoSSPayload) {
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

      const guild = this.discordClient?.guilds.cache.first();
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
  private allMaps: StoredMap[] = [];
  private reservedMaps: StoredMap[] = [];
  private lockedMaps: StoredMap[] = [];
  private disabledMaps: StoredMap[] = [];
  
  
  
  private checkPlayerCallbacks: Map<string, Set<(online: boolean, original_ign_case?: string) => void>> = new Map();
  private listeners: { [type: string]: Set<(msg: IncomingPayload) => void> } = {};
  private globalHandlers: { [type: string]: ((msg: IncomingPayload) => void) | undefined } = {};
  private gameManager: GameManagerLike | null = null;
  private queueStatusInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastQueueStatusHash: string | null = null;
  private dontLogCallbacks: Map<string, (result: { online: boolean; dontlog: boolean }) => void> = new Map();

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

  public registerScreenshareThread(info: { ign: string; sessionId: string; threadId: string; expiresAt: number }): void {
    const now = Date.now();
    for (const key of Object.keys(activeScreenshareThreads)) {
      if (activeScreenshareThreads[key].expiresAt <= now) {
        delete activeScreenshareThreads[key];
      }
    }
    activeScreenshareThreads[info.ign.toLowerCase()] = info;
  }

  public unregisterScreenshareThread(ign: string): void {
    delete activeScreenshareThreads[String(ign).toLowerCase()];
  }
  
  private permissions: Record<string, string[]> = {};
  
  public server: http.Server;
  public app: express.Application;

  public setGlobalHandler(type: string, handler: (msg: IncomingPayload) => void) {
    this.globalHandlers[type] = handler;
  }
  private discordClient: Client | undefined;

  constructor(port: number, discordClient?: Client, path?: string) {
    this.app = express();
    this.server = http.createServer(this.app);
    
    this.wss = new WebSocketServer({ 
      server: this.server,
      path: path
    });
    
    this.discordClient = discordClient;
    
    global._wsManager = this;
    
    this.wss.on('connection', (ws, _req) => {
      console.log('[WebSocketManager] New WebSocket connection established');
      
      let isAuthenticated = false;

      ws.on('error', (error) => {
        console.error('[WebSocketManager] WebSocket connection error:', error.message || error);
        try {
          ws.close();
        } catch {
        }
      });

      ws.on('message', (data) => {
        if (!isAuthenticated) {
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            console.error('[WebSocketManager] Invalid JSON in auth message:', data.toString());
            ws.send(JSON.stringify({ type: 'auth_failure', message: 'Invalid JSON format' }));
            ws.close();
            return;
          }
          
          if (msg.type === 'auth' && process.env.AUTH_KEY && msg.auth_key === process.env.AUTH_KEY) {
            isAuthenticated = true;
            if (this.client && this.client !== ws) {
              console.warn('[WebSocketManager] Replacing existing authenticated client with new connection');
              try {
                this.client.removeAllListeners('close');
                this.client.close();
              } catch (oldClientError) {
                console.warn('[WebSocketManager] Failed to close previous client:', oldClientError instanceof Error ? oldClientError.message : oldClientError);
              }
            }
            this.client = ws; 
            this.startQueueStatusBroadcast();
            PresenceService.setConnected(true);
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
          this.stopQueueStatusBroadcast();
          PresenceService.setConnected(false);
        }
      });
    });
    
    
    this.startServer(port, path);
    this.startQueueStatusBroadcast();
    this.startHeartbeat();
  }
  
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(async () => {
      const client = this.client;
      if (!client || client.readyState !== client.OPEN) return;
      const ping = await this.getPing().catch(() => null);
      if (ping === null && this.client === client) {
        console.warn('[WebSocketManager] Client heartbeat failed, closing dead connection');
        this.client = null;
        PresenceService.setConnected(false);
        try {
          client.removeAllListeners('close');
          client.close();
        } catch {
        }
        this.stopQueueStatusBroadcast();
      }
    }, 30000);
  }
  
  private startServer(port: number, path?: string): void {
    this.server.on('error', (e: Error) => {
      if ('code' in e && (e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
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
    } catch {
      console.error('[WebSocketManager] Invalid JSON:', data);
      return;
    }
    
    if (msg.type === 'auth') {
      const authMsg = msg;
      if (process.env.AUTH_KEY && authMsg.auth_key === process.env.AUTH_KEY) {
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
        this.handleCallCommand(msg);
        break;
      case 'queuefromingame':
        this.handleQueueFromInGame(msg);
        break;
      case 'game_start':
        this.handleGameStart(msg);
        break;
      case 'maps_info':
        this.handleMapsInfo(msg);
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

  private async handlePlayerStatusUpdate(msg: PlayerStatusUpdatePayload) {
    if (typeof msg.online === 'boolean') {
      PresenceService.ingest(msg.ign, msg.online);
    }
    const ignKey = msg.ign?.toLowerCase();
    const threadInfo = ignKey ? activeScreenshareThreads[ignKey] : undefined;
    if (ignKey && threadInfo && Date.now() >= threadInfo.expiresAt) {
      delete activeScreenshareThreads[ignKey];
      return;
    }
    if (threadInfo && Date.now() < threadInfo.expiresAt) {
      try {
        const guild = this.discordClient?.guilds.cache.first();
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

  private handleDontLogCallback(msg: ScreenShareDontLogSuccessPayload | ScreenShareDontLogFailurePayload, success: boolean) {
    if (msg.uuid && this.dontLogCallbacks.has(msg.uuid)) {
      this.dontLogCallbacks.get(msg.uuid)!({ online: success, dontlog: success });
      this.dontLogCallbacks.delete(msg.uuid);
    }
  }

  private handleGameStart(msg: GameStartPayload) {
    (async () => {
      try {
        const gameIdRaw = msg.game_id || msg.gameid;
        const gameId = gameIdRaw;

        const Game = (await import('../models/Game')).default;
        const game = await Game.findOne({ gameId: parseInt(String(gameId)) });
        if (!game) return;
        const guild = this.discordClient?.guilds.cache.first();
        if (!guild) return;

        let channel;
        try {
          channel = await guild.channels.fetch(game.channels.text);
        } catch (err) {
          if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 10003) {
            console.warn(`[WebSocketManager] Channel ${game.channels.text} not found (may have been deleted).`);
            return;
          } else {
            throw err;
          }
        }
        if (!channel || !channel.isTextBased()) return;

        const { successEmbed } = await import('../utils/betterembed');
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
    const allMapsMap = new Map<string, StoredMap>();
    for (const m of [...reservedMapsArr, ...lockedMapsArr, ...disabledMapsArr]) {
      allMapsMap.set(m.name, {
        ...m,
        maxplayers: m.maxplayers ?? m.max_players,
        max_players: m.max_players ?? m.maxplayers
      });
    }
    this.allMaps = Array.from(allMapsMap.values());
    this.reservedMaps = reservedMapsArr.map((m: MapEntry) => ({
      ...m,
      maxplayers: m.maxplayers ?? m.max_players,
      max_players: m.max_players ?? m.maxplayers
    }));
    this.lockedMaps = lockedMapsArr.map((m: MapEntry) => ({
      ...m,
      maxplayers: m.maxplayers ?? m.max_players,
      max_players: m.max_players ?? m.maxplayers
    }));
    this.disabledMaps = disabledMapsArr.map((m: MapEntry) => ({
      ...m,
      maxplayers: m.maxplayers ?? m.max_players,
      max_players: m.max_players ?? m.maxplayers
    }));
  }

  private handlePlayerStatus(msg: PlayerStatusPayload) {
    const ign = typeof msg.ign === 'string' ? msg.ign.toLowerCase() : '';
    const callbacks = this.checkPlayerCallbacks.get(ign);
    if (callbacks && callbacks.size > 0) {
      for (const cb of Array.from(callbacks)) {
        cb(msg.online, msg.original_ign_case);
      }
      this.checkPlayerCallbacks.delete(ign);
    }
  }

  private handlePermission(msg: PermissionPayload) {
    console.log('[WebSocketManager] Received permission settings');
    const permissionsUpdate: Record<string, string[] | string> = { ...msg };
    delete permissionsUpdate.type;
    for (const [cmd, roles] of Object.entries(permissionsUpdate)) {
      if (Array.isArray(roles)) {
        this.permissions[cmd] = roles;
      }
    }
  }

  private determineWinningTeam(msg: ScoringPayload): number | undefined {
    const winningNumber = msg.winning_team_number ?? msg.winningTeamNumber;
    if (winningNumber != null && winningNumber !== 0) return winningNumber;
    const ignList = msg.winning_team_ign_list ?? msg.winningteamignlist;
    if (ignList && Array.isArray(ignList)) {
      console.log(`[WebSocketManager] Winning team determined from IGNs: ${ignList.join(', ')}`);
      return undefined;
    }
    console.error('[WebSocketManager] No winning team information provided');
    return undefined;
  }

  private calculateMvpsFromStats(players: Record<string, RawPlayerStats> | undefined, msgMvps?: string[]): string[] {
    if (msgMvps && msgMvps.length > 0) return msgMvps;
    let maxKills = -1;
    let mvps: string[] = [];
    for (const [ign, stats] of Object.entries(players || {})) {
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

  private buildPlayerData(players: Record<string, RawPlayerStats> | undefined, bedbreaks: string[]): Record<string, BuiltPlayerData> {
    const playerData: Record<string, BuiltPlayerData> = {};
    for (const [ign, stats] of Object.entries(players || {})) {
      playerData[ign] = {
        kills: stats.kills ?? 0,
        deaths: stats.deaths ?? 0,
        bedBroken: bedbreaks.includes(ign) ? 1 : 0,
        finalKills: stats.final_kills ?? stats.finalkills ?? 0,
        finalDeaths: stats.final_deaths ?? stats.finaldeaths ?? 0,
        diamonds: stats.diamonds ?? 0,
        irons: stats.irons ?? 0,
        gold: stats.gold ?? 0,
        emeralds: stats.emeralds ?? 0,
        blocksPlaced: stats.blocks_placed ?? stats.blocksplaced ?? 0,
        damageDealt: stats.damage_dealt ?? stats.damagedealt ?? 0,
        damageTaken: stats.damage_taken ?? stats.damagetaken ?? 0,
        assists: stats.assists ?? 0,
        maxStreak: stats.max_streak ?? stats.maxstreak ?? 0,
        firstBlood: (stats.first_blood ?? stats.firstblood) === true,
        fights: this.buildFights(stats.fights)
      };
    }
    return playerData;
  }

  private buildFights(fightsRaw: unknown): Record<string, { kills: number; damageDealt: number }> {
    const fights: Record<string, { kills: number; damageDealt: number }> = {};
    if (!fightsRaw || typeof fightsRaw !== 'object') return fights;
    let count = 0;
    for (const [opponent, rowRaw] of Object.entries(fightsRaw)) {
      if (typeof opponent !== 'string' || !opponent || opponent.length > 32) continue;
      if (opponent === '__proto__' || opponent === 'constructor' || opponent === 'prototype') continue;
      const row: FightRowRaw = typeof rowRaw === 'object' && rowRaw !== null ? rowRaw as FightRowRaw : {};
      const kills = typeof row.kills === 'number' && row.kills >= 0 ? Math.floor(row.kills) : 0;
      const damageDealt = typeof row.damage_dealt === 'number' && row.damage_dealt >= 0 ? row.damage_dealt
        : typeof row.damageDealt === 'number' && row.damageDealt >= 0 ? row.damageDealt
        : typeof row.damage === 'number' && row.damage >= 0 ? row.damage : 0;
      if (kills === 0 && damageDealt === 0) continue;
      fights[opponent] = { kills, damageDealt };
      if (++count >= 16) break;
    }
    return fights;
  }

  private handleScoring(msg: ScoringPayload) {
    const gameIdRaw = msg.game_id ?? msg.gameid;
    console.log(`[WebSocketManager] Received scoring message for game ${gameIdRaw}`);
    
    if (!this.gameManager) {
      console.error('[WebSocketManager] GameManager not available for scoring');
      return;
    }
    
    const { players, mvps: msgMvps } = msg;
    const winningteamignlist = msg.winning_team_ign_list ?? msg.winningteamignlist;
    const msgBedsbroken = msg.beds_broken ?? msg.bedsbroken;
    const gameid = String(gameIdRaw ?? '');
    const gameIdNum = parseInt(gameid, 10);
    if (isNaN(gameIdNum) || gameIdNum <= 0) {
      console.error('[WebSocketManager] Invalid game ID in scoring message:', gameid);
      return;
    }

    const winningTeam = this.determineWinningTeam(msg);
    const mvps = this.calculateMvpsFromStats(players, msgMvps);
    const bedbreaks: string[] = Array.isArray(msgBedsbroken) ? msgBedsbroken : [];
    const playerData = this.buildPlayerData(players, bedbreaks);
    const rawTimeline: unknown = msg.timeline;
    const timeline: TimelineEvent[] = (Array.isArray(rawTimeline) ? rawTimeline : [])
      .filter((e: unknown): e is TimelineEvent => typeof e === 'object' && e !== null && typeof (e as { type?: unknown }).type === 'string' && typeof (e as { timestamp?: unknown }).timestamp === 'number')
      .slice(0, 5000);

    (async () => {
      try {
        await this.gameManager!.scoreGame({
          gameId: gameIdNum,
          winningTeam,
          winningTeamIGNs: Array.isArray(winningteamignlist) ? winningteamignlist : [],
          mvps,
          bedbreaks,
          playerData,
          timeline,
          reason: 'Game completed'
        });
        console.log(`[WebSocketManager] Successfully scored game ${gameid} via GameManager`);
      } catch (error) {
        console.error(`[WebSocketManager] Error scoring game ${gameid} via GameManager:`, error);
      }
    })();
  }

  private handleVoiding(msg: VoidingPayload) {
    if (!this.gameManager) {
      console.error('[WebSocketManager] GameManager not available for voiding');
      return;
    }
    const gameid = msg.game_id ?? msg.gameid;
    const { reason } = msg;
    (async () => {
      try {
        await this.gameManager!.voidGame(parseInt(String(gameid)), reason || 'Voided via WebSocket');
        console.log(`[WebSocketManager] Successfully voided game ${gameid} via GameManager`);
      } catch (error) {
        console.error(`[WebSocketManager] Error voiding game ${gameid} via GameManager:`, error);
      }
    })();
  }

  public getAllMaps(): MapInfo[] {
    return this.allMaps as MapInfo[];
  }

  public getReservedMaps(): MapInfo[] {
    return this.reservedMaps as MapInfo[];
  }

  public getLockedMaps(): MapInfo[] {
    return this.lockedMaps as MapInfo[];
  }

  public getDisabledMaps(): MapInfo[] {
    return this.disabledMaps as MapInfo[];
  }

  
  

  public send(payload: object) {
    if (this.client && this.client.readyState === this.client.OPEN) {
      try {
        this.client.send(JSON.stringify(payload));
      } catch (error) {
        console.error('[WebSocketManager] Failed to send message:', error instanceof Error ? error.message : error);
      }
    }
  }
  public async checkPlayerOnline(ign: string): Promise<{ online: boolean; original_ign_case?: string }> {
    return new Promise((resolve) => {
      const normalizedIgn = ign.toLowerCase();
      let callbacks = this.checkPlayerCallbacks.get(normalizedIgn);
      if (!callbacks) {
        callbacks = new Set();
        this.checkPlayerCallbacks.set(normalizedIgn, callbacks);
      }

      const cb = (online: boolean, original_ign_case?: string) => {
        clearTimeout(timeout);
        callbacks.delete(cb);
        if (callbacks.size === 0) {
          this.checkPlayerCallbacks.delete(normalizedIgn);
        }
        resolve({ online, original_ign_case });
      };

      const timeout = setTimeout(() => {
        callbacks.delete(cb);
        if (callbacks.size === 0) {
          this.checkPlayerCallbacks.delete(normalizedIgn);
        }
        resolve({ online: false });
      }, 10000);

      callbacks.add(cb);
      this.send({ type: 'check_player', ign });
    });
  }

  public getPermission(command: string): string[] {
    return this.permissions[command] || [];
  }

  public async getPing(): Promise<number | null> {
    const client = this.client;
    if (!client || client.readyState !== client.OPEN) return null;
    return new Promise((resolve) => {
      const localTimestamp = Date.now();
      const parseData = (data: RawData): IncomingPayload | null => {
        try {
          if (typeof data === 'string') return JSON.parse(data) as IncomingPayload;
          if (Buffer.isBuffer(data)) return JSON.parse(data.toString('utf8')) as IncomingPayload;
          if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString('utf8')) as IncomingPayload;
          return null;
        } catch {
          return null;
        }
      };
      const pongHandler = (data: RawData) => {
        const msg = parseData(data);
        if (msg && msg.type === 'pong') {
          client.off('message', pongHandler);
          resolve(Date.now() - localTimestamp);
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
      const callId = msg.call_id ?? msg.callId;
      const { requester, target } = msg;
      
      if (!callId || !requester || !target) {
        console.error('[WebSocketManager] Invalid call command payload:', msg);
        this.send({
          type: 'callfailure',
          call_id: callId || '',
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
          call_id: callId,
          reason: 'Requester not found in database'
        } as CallFailurePayload);
        return;
      }

      
      const targetUser = await User.findOne({ ign: { $regex: new RegExp(`^${escapeRegex(target)}$`, 'i') } });
      if (!targetUser) {
        console.error(`[WebSocketManager] Target ${target} not found in database`);
        this.send({
          type: 'callfailure',
          call_id: callId,
          reason: 'Target player not found in database'
        } as CallFailurePayload);
        return;
      }

      
      const guild = this.discordClient?.guilds.cache.first();
      if (!guild) {
        console.error('[WebSocketManager] Guild not found');
        this.send({
          type: 'callfailure',
          call_id: callId,
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
          call_id: callId,
          reason: 'Requester is not in the Discord server'
        } as CallFailurePayload);
        return;
      }

      const requesterVoiceState = requesterMember.voice;
      if (!requesterVoiceState?.channel) {
        console.error(`[WebSocketManager] Requester ${requester} is not in a voice channel`);
        this.send({
          type: 'callfailure',
          call_id: callId,
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
          call_id: callId,
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
          call_id: callId
        } as CallSuccessPayload);
        
        
        try {
          const { successEmbed } = await import('../utils/betterembed');
          const gameChannel = await guild.channels.fetch(game.channels.text);
          
          if (gameChannel && gameChannel.isTextBased()) {
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
          call_id: callId,
          reason: 'Failed to grant voice channel permissions'
        } as CallFailurePayload);
      }
      
    } catch (error) {
      console.error('[WebSocketManager] Error handling call command:', error);
      this.send({
        type: 'callfailure',
        call_id: msg.call_id ?? msg.callId ?? '',
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

      
      const guild = this.discordClient?.guilds.cache.first();
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
        isActive: true,
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
    if (this.queueStatusInterval) {
      return;
    }
    
    this.queueStatusInterval = setInterval(async () => {
      try {
        await this.broadcastQueueStatus();
      } catch (error) {
        console.error('[WebSocketManager] Error broadcasting queue status:', error);
      }
    }, 10000); 

    console.log('[WebSocketManager] Queue status broadcast started');
  }

  private async broadcastQueueStatus(): Promise<void> {
    
    if (!this.client || this.client.readyState !== this.client.OPEN) {
      return;
    }

    try {
      
      const Queue = (await import('../models/Queue')).default;
      const User = (await import('../models/User')).default;

      
      const queues = await Queue.find().sort({ channelId: 1 });
      
      const queueStatus: Record<string, QueueStatusEntry> = {};

      const allMemberIds = new Set<string>();
      const channelMemberMap = new Map<string, { channelId: string; members: Collection<string, GuildMember> }>();

      
      if (this.discordClient) {
        const guild = this.discordClient.guilds.cache.first();
        if (guild) {
          for (const queue of queues) {
            try {
              const cached = guild.channels.cache.get(queue.channelId);
              const channel = cached ?? await guild.channels.fetch(queue.channelId);
              if (channel && channel.isVoiceBased()) {
                channelMemberMap.set(queue.channelId, { channelId: queue.channelId, members: channel.members });
                for (const [memberId] of channel.members) {
                  allMemberIds.add(memberId);
                }
              }
            } catch {
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
          min_elo: queue.minElo,
          max_elo: queue.maxElo,
          current_players: currentPlayerCount,
          max_players: queue.maxPlayers,
          is_ranked: queue.isRanked,
          is_picking: queue.isPicking ?? (queue as unknown as { ispicking?: boolean }).ispicking,
          players: playersInQueue
        };
      }

      const queueStatusMessage = {
        type: 'queuestatus',
        queues: queueStatus,
        timestamp: Date.now()
      };

      const hash = JSON.stringify(queueStatus);
      if (hash === this.lastQueueStatusHash) {
        return;
      }
      this.lastQueueStatusHash = hash;
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

  public setGameManager(gameManager: GameManagerLike): void {
    this.gameManager = gameManager;
  }
}