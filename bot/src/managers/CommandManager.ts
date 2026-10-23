import { wipeeveryone } from '../commands/account/wipeeveryone';
import { wipe } from '../commands/account/wipe';
import { gamescount } from '../commands/scoring/gamescount';
import { ranks } from '../commands/general/ranks';
import { Client, ChatInputCommandInteraction, Message, Collection, ButtonInteraction, SlashCommandBuilder, type ApplicationCommandDataResolvable, type ApplicationCommandOptionData } from 'discord.js';
import { register } from '../commands/account/register';
import { addqueue } from '../commands/queue/addqueue';
import { addelo } from '../commands/account/addelo';
import { forceregister } from '../commands/account/forceregister';
import { forcerename } from '../commands/account/forcerename';
import { party } from '../commands/queue/party';
import { score } from '../commands/scoring/score';
import { voidGame } from '../commands/scoring/void';
import { retry } from '../commands/queue/retry';
import { recentgames } from '../commands/stats/recentgames';
import { maps } from '../commands/general/maps';
import { ban } from '../commands/moderation/ban';
import { mute } from '../commands/moderation/mute';
import { unmute } from '../commands/moderation/unmute';
import { strike } from '../commands/moderation/strike';
import { unstrike } from '../commands/moderation/unstrike';
import { unban } from '../commands/moderation/unban';
import { games } from '../commands/general/games';
import { CommandHandler } from '../handlers/CommandHandler';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { strikerequest } from '../commands/scoring/strikerequest';
import { voidrequest } from '../commands/scoring/voidrequest';
import { stats } from '../commands/stats/stats';
import { call } from '../commands/queue/call';
import { nick } from '../commands/account/nick';
import { settings } from '../commands/account/settings';
import { forcevoid } from '../commands/scoring/forcevoid';
import { refresh } from '../commands/account/refresh';
import { gameinfo } from '../commands/general/gameinfo';
import { queues } from '../commands/general/queues';
import { win } from '../commands/scoring/win';
import { lose } from '../commands/scoring/lose';
import { unregister } from '../commands/account/unregister';
import { help, handleHelpMenu, handleHelpPagination } from '../commands/help';
import { leaderboard } from '../commands/stats/leaderboard';
import { removequeue } from '../commands/queue/removequeue';
import { removeelo } from '../commands/account/removeelo';
import { edit } from '../commands/scoring/edit';
import { queue } from '../commands/queue/queue';
import { history } from '../commands/moderation/history';
import { screenshare } from '../commands/moderation/screenshare';
import { ssclose } from '../commands/moderation/ssclose';
import { handleScreenshareFreeze } from '../interactions/screenshareFreezeHandler';
import { ScreenshareService } from '../services/ScreenshareService';
import { fixall } from '../commands/account/fixall';
import { executeStartSeason } from '../commands/season/startseason';
import { executeEndSeason } from '../commands/season/endseason';
import { executeListSeasons } from '../commands/season/listseasons';
import { execute as level } from '../commands/stats/level';
import { seasoninfo } from '../commands/season/seasoninfo';
import { executeQueueControl, queueControlData } from '../commands/queue/queuecontrol';





interface Command {
  name: string;
  description: string;
  options?: ApplicationCommandOptionData[];
  apiData?: ReturnType<SlashCommandBuilder['toJSON']>;
  execute: (interaction: Message | ChatInputCommandInteraction, args?: string[]) => Promise<void>;
}

export class CommandManager {
  private client: Client;
  private commands: Collection<string, Command>;

  private commandHandler: CommandHandler;

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.commands = new Collection();
    this.commandHandler = new CommandHandler(client, wsManager);
    this.registerCommands();


    for (const [name, command] of this.commands) {
      this.commandHandler.registerCommand(name, command.execute);
    }


    client.on('messageCreate', (message) => this.commandHandler.handleMessage(message));
    client.on('interactionCreate', async (interaction) => {
      try {

        if (interaction.isChatInputCommand()) {
          await this.commandHandler.handleInteraction(interaction);
          return;
        }


        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('help_category')) {
          await handleHelpMenu(interaction);
          return;
        }


        if (interaction.isButton() &&
          (interaction.customId.startsWith('help_prev') || interaction.customId.startsWith('help_next'))) {
          await handleHelpPagination(interaction);
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('ss_freeze_')) {
          await handleScreenshareFreeze(interaction);
          return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('ss_cancel_')) {
          await this.handleScreenshareCancel(interaction);
          return;
        }
      } catch (error) {
        console.error('Error handling interaction:', error);


        try {
          if (interaction.isRepliable()) {
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({
                content: 'An error occurred while processing your request.',
                flags: 64 
              }).catch(() => { });
            } else if (interaction.deferred) {
              await interaction.editReply({
                content: 'An error occurred while processing your request.'
              }).catch(() => { });
            } else if (interaction.replied) {
              await interaction.followUp({
                content: 'An error occurred while processing your request.',
                flags: 64 
              }).catch(() => { });
            }
          }
        } catch (replyError) {
          console.error('Failed to reply with error message:', replyError);
        }
      }
    });
  }

  private reg(name: string, description: string, execute: Command['execute'], options: ApplicationCommandOptionData[] = [], apiData?: Command['apiData']) {
    this.commands.set(name, { name, description, options, apiData, execute });
  }

  private async handleScreenshareCancel(interaction: ButtonInteraction): Promise<void> {
    try {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
        return;
      }

      const sessionId = interaction.customId.replace('ss_cancel_', '');
      if (!sessionId) {
        await interaction.reply({ content: 'Invalid session ID.', ephemeral: true });
        return;
      }

      const session = await ScreenshareService.getSessionById(sessionId);
      if (!session) {
        await interaction.reply({ content: 'Screenshare session not found or already closed.', ephemeral: true });
        return;
      }

      if (session.status !== 'pending') {
        await interaction.reply({ content: `This screenshare session is already ${session.status}.`, ephemeral: true });
        return;
      }

      if (session.requesterId !== interaction.user.id) {
        await interaction.reply({ content: 'Only the requester can cancel this screenshare request.', ephemeral: true });
        return;
      }

      const result = await ScreenshareService.closeSession(
        interaction.guild,
        sessionId,
        interaction.user.id,
        'Request cancelled by requester'
      );

      if (!result.success) {
        await interaction.reply({ content: result.error || 'Failed to cancel the screenshare request.', ephemeral: true });
        return;
      }

      try {
        const originalMessage = interaction.message;
        if (originalMessage && 'edit' in originalMessage) {
          await originalMessage.edit({ components: [] });
        }
      } catch (editError) {
        console.warn('[CommandManager] Failed to update cancelled screenshare message:', editError);
      }

      await interaction.reply({ content: 'Screenshare request cancelled.', ephemeral: true });
    } catch (error) {
      console.error('[CommandManager] Error handling screenshare cancel:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'There was an error cancelling the screenshare request.', ephemeral: true }).catch(() => {});
      }
    }
  }

  private regChat(name: string, description: string, execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>, options: ApplicationCommandOptionData[] = [], apiData?: Command['apiData']) {
    this.reg(name, description, async (interaction) => {
      if (interaction instanceof ChatInputCommandInteraction) await execute(interaction);
    }, options, apiData);
  }

  private registerCommands() {
    this.registerGeneralCommands();
    this.registerQueueCommands();
    this.registerScoringCommands();
    this.registerModerationCommands();
    this.registerAccountCommands();
    this.registerStatsCommands();
    this.registerSeasonCommands();
  }

  private registerGeneralCommands() {
    this.reg('queues', 'Show a list of queues', queues, [
      { name: 'page', description: 'Page number', type: 4, required: false }
    ]);
    this.reg('games', 'Show a list of games', games, [
      { name: 'page', description: 'Page number', type: 4, required: false }
    ]);
    this.reg('gameinfo', 'Show detailed info for a game by game ID', gameinfo, [
      { name: 'game_id', description: 'The ID of the game', type: 4, required: true }
    ]);
    this.reg('maps', 'Show available maps and select mode', async (interaction, args) => {
      await maps(interaction, args, this.commandHandler['wsManager']);
    });
    this.reg('ranks', 'Show the list of ELO ranks', ranks);
    this.reg('help', 'Show help menu', help);
  }

  private registerQueueCommands() {
    this.regChat('queuecontrol', 'Enable or disable queues by type or specific queue', executeQueueControl, [], queueControlData.toJSON());
    this.reg('queue', 'Show information about players in the current queue', queue);
    this.reg('party', 'Party management', party, [
      { name: 'action', description: 'Party action to perform', type: 3, required: true, choices: [
        { name: 'create', value: 'create' }, { name: 'invite', value: 'invite' }, { name: 'leave', value: 'leave' },
        { name: 'info', value: 'info' }, { name: 'disband', value: 'disband' }, { name: 'kick', value: 'kick' },
        { name: 'promote', value: 'promote' }, { name: 'settings', value: 'settings' }, { name: 'list', value: 'list' },
        { name: 'join', value: 'join' }
      ]},
      { name: 'user', description: 'User to invite, kick, or promote (only for relevant actions)', type: 6, required: false },
      { name: 'party_id', description: 'Party ID to join (only for join action)', type: 3, required: false },
      { name: 'args', description: 'Additional arguments for settings or other actions', type: 3, required: false }
    ]);
    this.reg('call', 'Grant voice channel access to a user in game channels', call, [
      { name: 'user', description: 'The user to grant voice channel access to', type: 6, required: true }
    ]);
    this.reg('retry', 'Retry a game', retry);
    this.reg('addqueue', 'Create a new queue', addqueue, [
      { name: 'channel_id', description: 'Voice channel ID for the queue', type: 3, required: true },
      { name: 'max_players', description: 'Maximum number of players', type: 4, required: true },
      { name: 'min_elo', description: 'Minimum ELO required', type: 4, required: true },
      { name: 'max_elo', description: 'Maximum ELO allowed', type: 4, required: true },
      { name: 'is_ranked', description: 'Whether this is a ranked queue', type: 5, required: true },
      { name: 'is_picking', description: 'Whether team picking is enabled', type: 5, required: true },
      { name: 'bypass_roles', description: 'Role IDs that can bypass restrictions (comma-separated)', type: 3, required: false }
    ]);
    this.reg('removequeue', 'Remove a queue by channel ID', removequeue, [
      { name: 'channel_id', description: 'Channel ID of the queue to remove', type: 3, required: true }
    ]);
  }

  private registerScoringCommands() {
    this.reg('score', 'Report game score', score, [
      { name: 'game_id', description: 'Game ID', type: 4, required: true },
      { name: 'winning_team', description: 'Winning Team (1 or 2)', type: 4, required: true },
      { name: 'mvps', description: 'MVP players (comma-separated user IGNs)', type: 3, required: false },
      { name: 'bedbreaks', description: 'Players who broke beds (comma-separated user IGNs)', type: 3, required: false },
      { name: 'reason', description: 'Reason for the game result', type: 3, required: false }
    ]);
    this.reg('win', 'Give a win to a user', win, [
      { name: 'user', description: 'User to give win to', type: 6, required: true }
    ]);
    this.reg('lose', 'Give a loss to a user', lose, [
      { name: 'user', description: 'User to give loss to', type: 6, required: true }
    ]);
    this.reg('void', 'Void a game', voidGame, [
      { name: 'game_id', description: 'Game ID', type: 4, required: true },
      { name: 'reason', description: 'Reason for voiding the game', type: 3, required: true }
    ]);
    this.reg('forcevoid', 'Force void the game associated with this channel', forcevoid);
    this.reg('edit', 'Edit user statistics', edit, [
      { name: 'user', description: 'User to edit', type: 6, required: true },
      { name: 'stat', description: 'Statistic to edit', type: 3, required: true, choices: [
        { name: 'ELO', value: 'elo' }, { name: 'Wins', value: 'wins' },
        { name: 'Losses', value: 'losses' }, { name: 'Games', value: 'games' }, { name: 'MVPs', value: 'mvps' },
        { name: 'Kills', value: 'kills' }, { name: 'Deaths', value: 'deaths' }, { name: 'Bed Broken', value: 'bedBroken' },
        { name: 'Final Kills', value: 'finalKills' }, { name: 'Diamonds', value: 'diamonds' }, { name: 'Irons', value: 'irons' },
        { name: 'Gold', value: 'gold' }, { name: 'Emeralds', value: 'emeralds' }, { name: 'Blocks Placed', value: 'blocksPlaced' },
        { name: 'Win Streak', value: 'winStreak' }, { name: 'Lose Streak', value: 'loseStreak' },
        { name: 'KDR', value: 'kdr' }, { name: 'WLR', value: 'wlr' }
      ]},
      { name: 'value', description: 'New value for the statistic', type: 3, required: true }
    ]);
    this.reg('gamescount', 'Show a chart of games count by day and state', gamescount);
    this.reg('strikerequest', 'Request a strike against a player.', strikerequest, [
      { name: 'game_id', type: 3, description: 'The ID of the game.', required: true },
      { name: 'target', type: 6, description: 'The target user to strike.', required: true },
      { name: 'reason', type: 3, description: 'The reason for the strike.', required: true }
    ]);
    this.reg('voidrequest', 'Request to void a game.', voidrequest, [
      { name: 'game_id', type: 3, description: 'The ID of the game.', required: true },
      { name: 'reason', description: 'The reason for voiding the game.', type: 3, required: true }
    ]);
  }

  private registerModerationCommands() {
    this.reg('ban', 'Ban a user from the server', ban, [
      { name: 'user', description: 'User to ban (ID or mention)', type: 6, required: true },
      { name: 'duration', description: 'Ban duration (e.g. 1d, 1h)', type: 3, required: true },
      { name: 'reason', description: 'Reason for ban', type: 3, required: true }
    ]);
    this.reg('unban', 'Unban a user from the server', unban, [
      { name: 'user_id', description: 'User ID to unban', type: 3, required: true }
    ]);
    this.reg('mute', 'Mute a user in the server', mute, [
      { name: 'user', description: 'User to mute (ID or mention)', type: 6, required: true },
      { name: 'duration', description: 'Mute duration (e.g. 1d, 1h)', type: 3, required: true },
      { name: 'reason', description: 'Reason for mute', type: 3, required: true }
    ]);
    this.reg('unmute', 'Unmute a user in the server', unmute, [
      { name: 'user_id', description: 'User ID to unmute', type: 3, required: true }
    ]);
    this.reg('strike', 'Issue a strike to a user', strike, [
      { name: 'user', description: 'User to strike (ID or mention)', type: 6, required: true },
      { name: 'reason', description: 'Reason for strike', type: 3, required: false }
    ]);
    this.reg('unstrike', 'Remove a strike from a user', unstrike, [
      { name: 'user', description: 'User to remove strike from (ID or mention)', type: 6, required: true },
      { name: 'reason', description: 'Reason for removing strike', type: 3, required: false }
    ]);
    this.reg('history', 'View a user history of bans, mutes, or strikes', history, [
      { name: 'user_id', description: 'The Discord ID of the user', type: 3, required: true },
      { name: 'type', description: 'The type of history to view (ban, mute, strike)', type: 3, required: true, choices: [
        { name: 'Ban', value: 'ban' }, { name: 'Mute', value: 'mute' }, { name: 'Strike', value: 'strike' }
      ]}
    ]);
    this.regChat('screenshare', 'Request a screenshare on a user', screenshare, [
      { name: 'user', description: 'User to screenshare', type: 6, required: true },
      { name: 'reason', description: 'Reason for the screenshare', type: 3, required: true }
    ]);
    this.regChat('ssclose', 'Close a screenshare session', ssclose, [
      { name: 'reason', description: 'Reason for closing the session', type: 3, required: true }
    ]);
  }

  private registerAccountCommands() {
    this.reg('register', 'Register your account', register, [
      { name: 'ign', description: 'Your in-game name', type: 3, required: true }
    ]);
    this.reg('forceregister', 'Force register a user with an IGN', forceregister, [
      { name: 'user', description: 'User to force register', type: 6, required: true },
      { name: 'ign', description: 'In-game name to register', type: 3, required: true }
    ]);
    this.reg('forcerename', 'Force rename a registered user IGN', forcerename, [
      { name: 'user', description: 'User to force rename', type: 6, required: true },
      { name: 'new_ign', description: 'New in-game name', type: 3, required: true }
    ]);
    this.reg('unregister', 'Unregister a user from the bot', unregister, [
      { name: 'user', description: 'User to unregister', type: 6, required: true }
    ]);
    this.reg('nick', 'Set or remove your nickname', nick, [
      { name: 'action', description: 'set or remove', type: 3, required: true, choices: [
        { name: 'set', value: 'set' }, { name: 'remove', value: 'remove' }
      ]},
      { name: 'nickname', description: 'The nickname to set (only for set action)', type: 3, required: false }
    ]);
    this.reg('refresh', 'Refresh your nickname and roles', refresh);
    this.reg('settings', 'Edit your user settings', settings);
    this.reg('fixall', 'Fix roles and nicknames for all users in the database', fixall);
    this.reg('addelo', 'Add an ELO rank', addelo, [
      { name: 'role_id', description: 'Role ID for this rank', type: 3, required: true },
      { name: 'start_elo', description: 'Starting ELO for this rank', type: 4, required: true },
      { name: 'end_elo', description: 'Ending ELO for this rank', type: 4, required: true },
      { name: 'win_elo', description: 'ELO gained for a win', type: 4, required: true },
      { name: 'lose_elo', description: 'ELO lost for a loss', type: 4, required: true },
      { name: 'mvp_elo', description: 'MVP ELO bonus for this rank', type: 4, required: true },
      { name: 'bed_elo', description: 'ELO gained for breaking a bed', type: 4, required: false }
    ]);
    this.reg('removeelo', 'Remove an ELO rank by role ID', removeelo, [
      { name: 'role_id', description: 'Role ID of the ELO rank to remove', type: 3, required: true }
    ]);
    this.reg('wipe', 'Wipe all stats for a user (except bans, mutes, strikes)', wipe, [
      { name: 'user', description: 'User to wipe stats for', type: 6, required: true }
    ]);
    this.reg('wipeeveryone', 'Wipe all stats for every user (except bans, mutes, strikes)', wipeeveryone);
  }

  private registerStatsCommands() {
    this.reg('stats', 'View player stats', stats, [
      { name: 'user', description: 'Target user to view stats for', type: 6, required: false }
    ]);
    this.reg('leaderboard', 'Show the leaderboard for a stat', leaderboard, [
      { name: 'mode', description: 'Stat to rank by', type: 3, required: false, choices: [
        { name: 'Elo', value: 'elo' }, { name: 'Wins', value: 'wins' }, { name: 'Losses', value: 'losses' },
        { name: 'Games', value: 'games' }, { name: 'MVPs', value: 'mvps' }, { name: 'Kills', value: 'kills' },
        { name: 'Deaths', value: 'deaths' }, { name: 'Beds Broken', value: 'bedBroken' }, { name: 'Final Kills', value: 'finalKills' },
        { name: 'Diamonds', value: 'diamonds' }, { name: 'Irons', value: 'irons' }, { name: 'Gold', value: 'gold' },
        { name: 'Emeralds', value: 'emeralds' }, { name: 'Blocks Placed', value: 'blocksPlaced' },
        { name: 'Winstreak', value: 'winStreak' }, { name: 'Losestreak', value: 'loseStreak' },
        { name: 'KDR', value: 'kdr' }, { name: 'WLR', value: 'wlr' }, { name: 'Level', value: 'level' },
        { name: 'Experience', value: 'experience' }, { name: 'Damage Dealt', value: 'damageDealt' },
        { name: 'Damage Taken', value: 'damageTaken' }, { name: 'Assists', value: 'assists' },
        { name: 'Best Streak', value: 'bestStreak' }, { name: 'First Bloods', value: 'firstBloods' }
      ]},
      { name: 'page', description: 'Page number', type: 4, required: false }
    ]);
    this.reg('recentgames', 'View recent games', recentgames, [
      { name: 'page', description: 'Page number', type: 4, required: false },
      { name: 'user', description: 'Filter by user (Discord ID, username, or mention)', type: 3, required: false }
    ]);
    this.regChat('level', 'View level and experience information', level, [
      { name: 'user', description: 'User to view level for (leave empty for yourself)', type: 6, required: false }
    ]);
  }

  private registerSeasonCommands() {
    this.regChat('startseason', 'Start a new season', executeStartSeason, [
      { name: 'season', description: 'Season number', type: 4, required: true },
      { name: 'chapter', description: 'Chapter number', type: 4, required: true },
      { name: 'name', description: 'Name of the new season', type: 3, required: true },
      { name: 'description', description: 'Description of the new season', type: 3, required: false }
    ]);
    this.regChat('endseason', 'End the current active season and migrate data', executeEndSeason);
    this.regChat('listseasons', 'List all seasons', executeListSeasons);
    this.reg('seasoninfo', 'Show current season information and allowed items', seasoninfo);
    this.reg('seasoninfo', 'Show current season information and allowed items', seasoninfo);
  }

  public async registerSlashCommands() {
    try {
      const commands: ApplicationCommandDataResolvable[] = Array.from(this.commands.values()).map((cmd, cmdIndex) => {
        console.log(`[Command Manager] Processing command ${cmdIndex}: ${cmd.name}`);

        const printableOptions = cmd.options ?? cmd.apiData?.options ?? [];
        if (printableOptions.length > 0) {
          printableOptions.forEach((option, index) => {
            if (!option.type) {
              console.error(`[Command Manager] Command "${cmd.name}" (index ${cmdIndex}) option at index ${index} is missing type field:`, JSON.stringify(option, null, 2));
            } else {
              console.log(`[Command Manager] Command "${cmd.name}" option ${index}: type=${option.type}, name=${option.name}`);
            }
          });
        } else {
          console.log(`[Command Manager] Command "${cmd.name}" has no options`);
        }

        if (cmd.apiData) {
          return cmd.apiData;
        }

        return {
          name: cmd.name,
          description: cmd.description,
          options: cmd.options
        };
      });

      console.log(`[Command Manager] Registering ${commands.length} commands`);


      await this.client.application?.commands.set(commands);
      console.log('[Command Manager] Slash commands registered successfully');
    } catch (error) {
      console.error('[Command Manager] Error registering slash commands:', error);

      
      const rawErrors = error instanceof Error
        ? (error as Error & { rawError?: { errors?: unknown } }).rawError
        : undefined;
      if (rawErrors?.errors) {
        console.error('[Command Manager] Detailed error info:', JSON.stringify(rawErrors.errors, null, 2));
      }
    }
  }


}


