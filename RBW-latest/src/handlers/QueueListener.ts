import { Client, VoiceState, TextChannel } from 'discord.js';
import Queue from '../models/Queue';
import User from '../models/User';
import Party from '../models/Party';
import Game from '../models/Game';
import config from '../config/config';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { CentralizedMatchmaker } from '../Matchmaking/CentralizedMatchmaker';
import { WorkersManager } from '../managers/WorkersManager';
import { queuePlayers } from '../types/queuePlayersMemory';

async function updatePartyActivity(partyId: string) {
  try {
    await Party.updateOne(
      { partyId: partyId },
      { lastActiveTime: new Date() }
    );
  } catch (error) {
    console.error('Error updating party activity:', error);
  }
}

interface QueueState {
  players: string[];
  parties: Map<string, string[]>;
  lastUpdate: number;
  processing: boolean;
}

export class QueueListener {
  private client: Client;
  private matchmaker: CentralizedMatchmaker;
  private wsManager: WebSocketManager;
  private workersManager: WorkersManager;
  private partyCache: Map<string, { members: string[], timestamp: number }> = new Map();
  private queueStates: Map<string, QueueState> = new Map();
  private processingLocks: Map<string, NodeJS.Timeout> = new Map();
  private readonly CACHE_TTL = 30000;
  private readonly QUEUE_CHECK_INTERVAL = 5000;

  constructor(client: Client, wsManager: WebSocketManager, gameManager: any) {
    this.client = client;
    this.wsManager = wsManager;
    this.workersManager = WorkersManager.getInstance();
    this.matchmaker = new CentralizedMatchmaker(client, wsManager, gameManager);
    this.startCacheCleanup();
    this.startQueueMonitor();
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [partyId, data] of this.partyCache.entries()) {
        if (now - data.timestamp > this.CACHE_TTL) {
          this.partyCache.delete(partyId);
        }
      }
    }, 60000);
  }

  private startQueueMonitor(): void {
    setInterval(async () => {
      await this.checkAllQueues();
    }, this.QUEUE_CHECK_INTERVAL);
  }

  private async checkAllQueues(): Promise<void> {
    try {
      const queues = await Queue.find({ isActive: true });

      for (const queue of queues) {
        await this.validateQueueState(queue.channelId);
      }
    } catch (error) {
      console.error('[QueueListener] Error in queue monitor:', error);
    }
  }

  private async validateQueueState(queueId: string): Promise<void> {
    try {
      const queue = await Queue.findOne({ channelId: queueId });
      if (!queue) return;

      const state = this.queueStates.get(queueId);
      if (!state) return;

      const guild = this.client.guilds.cache.first();
      if (!guild) return;

      const voiceChannel = await guild.channels.fetch(queueId).catch(() => null);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

      const playersInVC = new Set(voiceChannel.members.keys());
      const validPlayers: string[] = [];
      const validParties = new Map<string, string[]>();

      for (const playerId of state.players) {
        if (playersInVC.has(playerId)) {
          validPlayers.push(playerId);
        } else {
          console.log(`[QueueListener] Player ${playerId} no longer in queue ${queueId}, removing`);
        }
      }

      for (const [partyId, members] of state.parties) {
        const validMembers = members.filter(memberId => playersInVC.has(memberId));
        if (validMembers.length === members.length) {
          validParties.set(partyId, validMembers);
        } else {
          console.log(`[QueueListener] Party ${partyId} has members not in queue ${queueId}, removing party`);
        }
      }


      state.players = validPlayers;
      state.parties = validParties;
      state.lastUpdate = Date.now();


      queuePlayers.set(queueId, validPlayers);


      if (validPlayers.length >= queue.maxPlayers && !state.processing) {
        await this.scheduleQueueProcessing(queueId);
      }

    } catch (error) {
      console.error(`[QueueListener] Error validating queue state for ${queueId}:`, error);
    }
  }

  public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {
      const userId = newState.member?.id;
      if (!userId) return;

      const wasQueueChannel = await this.isQueueChannel(oldState.channelId);
      const isQueueChannel = await this.isQueueChannel(newState.channelId);

      if (!wasQueueChannel && isQueueChannel) {
        await this.handleQueueJoin(newState);
      } else if (wasQueueChannel && !isQueueChannel) {
        await this.handleQueueLeave(oldState);
      } else if (wasQueueChannel && isQueueChannel && oldState.channelId !== newState.channelId) {
        await this.handleQueueSwitch(oldState, newState);
      }
    } catch (error) {
      console.error('[QueueListener] Error in handleVoiceStateUpdate:', error);
      try {
        if (newState.member) {
          const waitingVcId = config.voicechannels.waitingvc;
          if (waitingVcId) {
            await this.workersManager.moveMembers([newState.member.id], waitingVcId, 6);
          }
        }
      } catch (moveError) {
        console.error('[QueueListener] Failed to move user to waiting on error:', moveError);
      }
    }
  }

  private async isQueueChannel(channelId: string | null | undefined): Promise<boolean> {
    if (!channelId) return false;
    const queue = await Queue.findOne({ channelId });
    return !!queue;
  }

  private async handleQueueJoin(state: VoiceState): Promise<void> {
    try {
      const queue = await Queue.findOne({ channelId: state.channelId });
      if (!queue || queue.isActive === false) {
        await this.moveToWaiting(state, 'This queue is currently disabled.');
        return;
      }

      const userId = state.member?.id;
      if (!userId) return;

      const user = await User.findOne({ discordId: userId });
      if (!user) {
        await this.moveToWaiting(state, 'you are not registered. Please register to participate. Maybe `/update`?');
        return;
      }

      if (!user.ign) {
        await this.moveToWaiting(state, "you don't have a valid IGN. Please update your profile.");
        return;
      }

      if (user.isbanned || user.isfrozen) {
        await this.moveToWaiting(state, 'you have a restricted role. please contact a staff if you think its a mistake');
        return;
      }

      const member = state.member;
      if (!member) return;

      const hasBypassRole = queue.bypassRoles.some(roleId => member.roles.cache.has(roleId));

      if (!hasBypassRole && (user.elo < queue.minElo || user.elo > queue.maxElo)) {
        await this.moveToWaiting(state, `ELO ${user.elo} not in range (${queue.minElo}-${queue.maxElo})`);
        return;
      }

      try {
        const onlineCheck = await Promise.race([
          this.wsManager.checkPlayerOnline(user.ign),
          new Promise<{ online: boolean }>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 5000)
          )
        ]).catch(() => ({ online: false }));

        if (!onlineCheck.online) {
          await this.moveToWaiting(state, 'Player is not online, Please make sure to be on `play.ayormc.net` Minecraft server before joining a queue!');
          return;
        }
      } catch (error) {
        console.warn(`[QueueListener] Could not check online status for ${user.ign}: ${error}`);
        await this.moveToWaiting(state, 'Could not verify online status, Hm? Wierd this shouldn\'t be happening!');
        return;
      }

      let queueState = this.queueStates.get(queue.channelId);
      if (!queueState) {
        queueState = {
          players: [],
          parties: new Map(),
          lastUpdate: Date.now(),
          processing: false
        };
        this.queueStates.set(queue.channelId, queueState);
      }

      const wasQueueFull = queueState.players.length >= queue.maxPlayers;

      if (user.partyId) {
        const partyResult = await this.handlePartyJoin(state, user, queueState, queue);
        if (!partyResult.success) {
          return;
        }
      } else {
        if (!queueState.players.includes(userId)) {
          queueState.players.push(userId);
        }
      }

      queueState.lastUpdate = Date.now();
      queuePlayers.set(queue.channelId, [...queueState.players]);

      const isQueueFull = queueState.players.length >= queue.maxPlayers;

      if (isQueueFull && !wasQueueFull) {
        console.log(`[QueueListener] Queue ${queue.channelId} just became full, scheduling processing`);
        await this.scheduleQueueProcessing(queue.channelId);
      }

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueJoin:', error);
      await this.moveToWaiting(state, 'Internal error');
    }
  }

  private async handlePartyJoin(
    state: VoiceState,
    user: any,
    queueState: QueueState,
    queue: any
  ): Promise<{ success: boolean }> {
    try {
      let partyMembers = this.partyCache.get(user.partyId)?.members;

      if (!partyMembers) {
        const party = await Party.findOne({ partyId: user.partyId });
        if (!party || !party.members) {
          await this.moveToWaiting(state, 'Invalid party');
          return { success: false };
        }

        partyMembers = party.members;
        this.partyCache.set(user.partyId, {
          members: partyMembers,
          timestamp: Date.now()
        });
      }

      const isValidPartySize = await this.validatePartySize(state, partyMembers);
      if (!isValidPartySize) {
        return { success: false };
      }

      const partyUsers = await User.find({
        discordId: { $in: partyMembers }
      }).select('discordId elo isbanned isfrozen').lean();

      if (partyUsers.length !== partyMembers.length) {
        await this.moveToWaiting(state, 'Some party members not found');
        return { success: false };
      }

      for (const member of partyUsers) {
        if (member.isbanned || member.isfrozen) {
          await this.moveToWaiting(state, `Party member is banned or frozen`);
          return { success: false };
        }

        if (member.elo < queue.minElo || member.elo > queue.maxElo) {
          await this.moveToWaiting(state, `Party member ELO not in queue range`);
          return { success: false };
        }
      }

      const activeGame = await Game.findOne({
        $or: [
          { team1: { $in: partyMembers } },
          { team2: { $in: partyMembers } }
        ],
        state: { $in: ['pending', 'active'] }
      });

      if (activeGame) {
        await this.moveToWaiting(state, `Party member in game #${activeGame.gameId}`);
        return { success: false };
      }

      const guild = this.client.guilds.cache.first();
      if (!guild) return { success: false };

      const voiceChannel = await guild.channels.fetch(queue.channelId).catch(() => null);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) return { success: false };

      const playersInVC = new Set(voiceChannel.members.keys());
      const membersInVC = partyMembers.filter(memberId => playersInVC.has(memberId));

      if (membersInVC.length !== partyMembers.length) {
        await this.moveToWaiting(state, `Not all party members are in the queue channel`);
        return { success: false };
      }

      queueState.parties.set(user.partyId, partyMembers);

      for (const memberId of partyMembers) {
        if (!queueState.players.includes(memberId)) {
          queueState.players.push(memberId);
        }
      }

      console.log(`[QueueListener] Party ${user.partyId} (${partyMembers.length} members) joined queue ${queue.channelId}`);

      return { success: true };

    } catch (error) {
      console.error('[QueueListener] Error in handlePartyJoin:', error);
      await this.moveToWaiting(state, 'Party join error');
      return { success: false };
    }
  }

  private async handleQueueLeave(state: VoiceState): Promise<void> {
    try {
      const queue = await Queue.findOne({ channelId: state.channelId });
      if (!queue || queue.isActive === false) {
        
        return;
      }

      const userId = state.member?.id;
      if (!userId) return;

      const user = await User.findOne({ discordId: userId });
      if (!user) return;

      const queueState = this.queueStates.get(queue.channelId);
      if (!queueState) return;

      const wasQueueFull = queueState.players.length >= queue.maxPlayers;

      if (user.partyId) {
        await updatePartyActivity(user.partyId);


        const partyMembers = queueState.parties.get(user.partyId) || [];
        queueState.players = queueState.players.filter(p => !partyMembers.includes(p));
        queueState.parties.delete(user.partyId);

        console.log(`[QueueListener] Party ${user.partyId} left queue ${queue.channelId}, removed ${partyMembers.length} members`);
      } else {

        queueState.players = queueState.players.filter(p => p !== userId);
        console.log(`[QueueListener] Player ${userId} left queue ${queue.channelId}`);
      }

      queueState.lastUpdate = Date.now();
      queuePlayers.set(queue.channelId, [...queueState.players]);

      const isQueueFull = queueState.players.length >= queue.maxPlayers;

      console.log(`[QueueListener] Queue ${queue.channelId}: ${queueState.players.length}/${queue.maxPlayers} players remaining`);


      if (wasQueueFull && !isQueueFull) {
        console.log(`[QueueListener] Queue ${queue.channelId} is no longer full, stopping processing`);
        this.cancelQueueProcessing(queue.channelId);
      }

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueLeave:', error);
    }
  }

  private async handleQueueSwitch(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {

      await this.handleQueueLeave(oldState);


      await this.handleQueueJoin(newState);

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueSwitch:', error);
    }
  }

  private async scheduleQueueProcessing(queueId: string): Promise<void> {
    try {

      this.cancelQueueProcessing(queueId);

      const queueState = this.queueStates.get(queueId);
      if (!queueState) return;

      queueState.processing = true;

      const timeout = setTimeout(async () => {
        try {
          await this.matchmaker.processQueue(queueId);
        } finally {
          const state = this.queueStates.get(queueId);
          if (state) {
            state.processing = false;
          }
          this.processingLocks.delete(queueId);
        }
      }, 1000);

      this.processingLocks.set(queueId, timeout);

    } catch (error) {
      console.error(`[QueueListener] Error scheduling queue processing for ${queueId}:`, error);
    }
  }

  private cancelQueueProcessing(queueId: string): void {
    const timeout = this.processingLocks.get(queueId);
    if (timeout) {
      clearTimeout(timeout);
      this.processingLocks.delete(queueId);
    }

    const queueState = this.queueStates.get(queueId);
    if (queueState) {
      queueState.processing = false;
    }
  }

  private async moveToWaiting(state: VoiceState, reason: string): Promise<void> {
    try {
      const member = state.member;
      if (!member) return;


      const waitingVcId = config.voicechannels.waitingvc;
      if (waitingVcId && member.voice.channelId !== waitingVcId) {
        await this.workersManager.moveMembers([member.id], waitingVcId, 6);
      }

      const mention = `<@${member.id}>`;
      const message = `Hey ${mention}, ${reason}`;

      if (config.channels.alertsChannel) {
        await this.workersManager.sendMessage(
          config.channels.alertsChannel,
          { content: message },
          7
        );
      }

      console.warn(`[QueueListener] User ${member.user.username} moved to waiting due to: ${reason}`);
    } catch (error) {
      console.error('[QueueListener] Error moving to waiting:', error);
    }
  }

  private async validatePartySize(state: VoiceState, partyMembers: string[]): Promise<boolean> {
    try {
      const member = state.member;
      if (!member) return false;

      const partySize = partyMembers.length;
      const roles = {
        [config.roles.partyof2Queue]: 2,
        [config.roles.partyof3Queue]: 3,
        [config.roles.partyof4Queue]: 4
      };

      let highestAllowedSize = config.CommonPartySize || 1;
      for (const [roleId, size] of Object.entries(roles)) {
        if (member.roles.cache.has(roleId) && size > highestAllowedSize) {
          highestAllowedSize = size;
        }
      }

      if (partySize > highestAllowedSize) {
        await this.moveToWaiting(state, `Party too large (${partySize} > ${highestAllowedSize})`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[QueueListener] Error validating party size:', error);
      return false;
    }
  }

  public getMatchmaker(): CentralizedMatchmaker {
    return this.matchmaker;
  }

  public getQueueStats(): Record<string, { players: number, parties: number, processing: boolean }> {
    const stats: Record<string, { players: number, parties: number, processing: boolean }> = {};

    for (const [queueId, state] of this.queueStates.entries()) {
      stats[queueId] = {
        players: state.players.length,
        parties: state.parties.size,
        processing: state.processing
      };
    }

    return stats;
  }


  public cleanup(): void {
    try {

      for (const timeout of this.processingLocks.values()) {
        clearTimeout(timeout);
      }
      this.processingLocks.clear();


      this.queueStates.clear();
      this.partyCache.clear();

      this.matchmaker.cleanup();
      console.log('[QueueListener] Cleanup completed');
    } catch (error) {
      console.error('[QueueListener] Error during cleanup:', error);
    }
  }
}