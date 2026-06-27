import { wipeeveryone } from '../commands/admin/wipeeveryone';
import { wipe } from '../commands/admin/wipe';
import { gamescount } from '../commands/admin/gamescount';
import { ranks } from '../commands/player/ranks';
import { Client, ChatInputCommandInteraction, Message, Collection } from 'discord.js';
import { register } from '../commands/player/register';
import { addqueue } from '../commands/admin/addqueue';
import { addelo } from '../commands/admin/addelo';
import { forceregister } from '../commands/admin/forceregister';
import { forcerename } from '../commands/admin/forcerename';
import { party } from '../commands/player/party';
import { score } from '../commands/moderator/score';
import { voidGame } from '../commands/moderator/void';
import { retry } from '../commands/game/retry';
import { recentgames } from '../commands/player/recentgames';
import { maps } from '../commands/game/maps';
import { ban } from '../commands/moderator/ban';
import { mute } from '../commands/moderator/mute';
import { unmute } from '../commands/moderator/unmute';
import { strike } from '../commands/moderator/strike';
import { unstrike } from '../commands/moderator/unstrike';
import { unban } from '../commands/moderator/unban';
import { games } from '../commands/game/games';
import { CommandHandler } from '../handlers/CommandHandler';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { strikerequest } from '../commands/player/strikerequest';
import { voidrequest } from '../commands/player/voidrequest';
import { stats } from '../commands/player/stats';
import { call } from '../commands/player/call';
import { nick } from '../commands/player/nick';
import { settings } from '../commands/player/settings';
import { forcevoid } from '../commands/moderator/forcevoid';
import { refresh } from '../commands/player/refresh';
import { gameinfo } from '../commands/game/gameinfo';
import { queues } from '../commands/game/queues';
import { win } from '../commands/moderator/win';
import { lose } from '../commands/moderator/lose';
import { unregister } from '../commands/admin/unregister';
import { help, handleHelpMenu, handleHelpPagination } from '../commands/help';
import { leaderboard } from '../commands/player/leaderboard';
import { removequeue } from '../commands/admin/removequeue';
import { removeelo } from '../commands/admin/removeelo';
import { edit } from '../commands/admin/edit';
import { queue } from '../commands/player/queue';
import { history } from '../commands/player/history';
import { screenshare } from '../commands/player/screenshare';
import { ssclose } from '../commands/moderator/ssclose';
import { changeThemeData, executeChangeTheme } from '../commands/player/changetheme';
import { themesData, executeThemes } from '../commands/player/themes';
import { themeManageData, executeThemeManage } from '../commands/admin/thememanage';
import { handleScreenshareFreeze } from '../interactions/screenshareFreezeHandler';
import { fixall } from '../commands/admin/fixall';
import { executeStartSeason } from '../commands/admin/startseason';
import { executeEndSeason } from '../commands/admin/endseason';
import { executeListSeasons } from '../commands/admin/listseasons';
import { execute as level } from '../commands/player/level';
import { seasoninfo } from '../commands/player/seasoninfo';





interface Command {
  name: string;
  description: string;
  options?: any[];
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

  private reg(name: string, description: string, execute: Command['execute'], options: any[] = []) {
    this.commands.set(name, { name, description, options, execute });
  }

  private regChat(name: string, description: string, execute: (interaction: ChatInputCommandInteraction) => Promise<any>, options: any[] = []) {
    this.reg(name, description, async (interaction) => {
      if (interaction instanceof ChatInputCommandInteraction) await execute(interaction);
    }, options);
  }

  private registerCommands() {
    this.registerAdminCommands();
    this.registerPlayerCommands();
    this.registerModeratorCommands();
    this.registerGameCommands();
    this.registerSeasonCommands();
  }

  private registerAdminCommands() {
    const { executeQueueControl, queueControlData } = require('../commands/admin/queuecontrol');
    this.reg('queuecontrol', 'Enable or disable queues by type or specific queue', executeQueueControl, queueControlData.toJSON().options || []);
    this.reg('gamescount', 'Show a chart of games count by day and state', gamescount);
    this.reg('register', 'Register your account', register, [
      { name: 'ign', description: 'Your in-game name', type: 3, required: true }
    ]);
    this.reg('addqueue', 'Create a new queue', addqueue, [
      { name: 'channelid', description: 'Voice channel ID for the queue', type: 3, required: true },
      { name: 'maxplayers', description: 'Maximum number of players', type: 4, required: true },
      { name: 'minelo', description: 'Minimum ELO required', type: 4, required: true },
      { name: 'maxelo', description: 'Maximum ELO allowed', type: 4, required: true },
      { name: 'isranked', description: 'Whether this is a ranked queue', type: 5, required: true },
      { name: 'ispicking', description: 'Whether team picking is enabled', type: 5, required: true },
      { name: 'bypassroles', description: 'Role IDs that can bypass restrictions (comma-separated)', type: 3, required: false }
    ]);
    this.reg('addelo', 'Add an ELO rank', addelo, [
      { name: 'roleid', description: 'Role ID for this rank', type: 3, required: true },
      { name: 'startelo', description: 'Starting ELO for this rank', type: 4, required: true },
      { name: 'endelo', description: 'Ending ELO for this rank', type: 4, required: true },
      { name: 'winelo', description: 'ELO gained for a win', type: 4, required: true },
      { name: 'loseelo', description: 'ELO lost for a loss', type: 4, required: true },
      { name: 'mvpelo', description: 'MVP ELO bonus for this rank', type: 4, required: true },
      { name: 'bedelo', description: 'ELO gained for breaking a bed', type: 4, required: false }
    ]);
    this.reg('forceregister', 'Force register a user with an IGN', forceregister, [
      { name: 'user', description: 'User to force register', type: 6, required: true },
      { name: 'ign', description: 'In-game name to register', type: 3, required: true }
    ]);
    this.reg('forcerename', 'Force rename a registered user\'s IGN', forcerename, [
      { name: 'user', description: 'User to force rename', type: 6, required: true },
      { name: 'newign', description: 'New in-game name', type: 3, required: true }
    ]);
    this.reg('wipe', 'Wipe all stats for a user (except bans, mutes, strikes)', wipe, [
      { name: 'user', description: 'User to wipe stats for', type: 6, required: true }
    ]);
    this.reg('wipeeveryone', 'Wipe all stats for every user (except bans, mutes, strikes)', wipeeveryone);
    this.reg('fixall', 'Fix roles and nicknames for all users in the database', fixall);
    this.reg('unregister', 'Unregister a user from the bot', unregister, [
      { name: 'user', description: 'User to unregister', type: 6, required: true }
    ]);
    this.reg('removequeue', 'Remove a queue by channel ID', removequeue, [
      { name: 'channelid', description: 'Channel ID of the queue to remove', type: 3, required: true }
    ]);
    this.reg('removeelo', 'Remove an ELO rank by role ID', removeelo, [
      { name: 'roleid', description: 'Role ID of the ELO rank to remove', type: 3, required: true }
    ]);
    this.regChat('thememanage', 'Admin: give or take a user\'s theme', executeThemeManage, themeManageData.toJSON().options || []);
    this.reg('edit', 'Edit user statistics', edit, [
      { name: 'user', description: 'User to edit', type: 6, required: true },
      { name: 'stat', description: 'Statistic to edit', type: 3, required: true, choices: [
        { name: 'IGN', value: 'ign' }, { name: 'ELO', value: 'elo' }, { name: 'Wins', value: 'wins' },
        { name: 'Losses', value: 'losses' }, { name: 'Games', value: 'games' }, { name: 'MVPs', value: 'mvps' },
        { name: 'Kills', value: 'kills' }, { name: 'Deaths', value: 'deaths' }, { name: 'Bed Broken', value: 'bedBroken' },
        { name: 'Final Kills', value: 'finalKills' }, { name: 'Diamonds', value: 'diamonds' }, { name: 'Irons', value: 'irons' },
        { name: 'Gold', value: 'gold' }, { name: 'Emeralds', value: 'emeralds' }, { name: 'Blocks Placed', value: 'blocksPlaced' },
        { name: 'Win Streak', value: 'winstreak' }, { name: 'Lose Streak', value: 'losestreak' },
        { name: 'KDR', value: 'kdr' }, { name: 'WLR', value: 'wlr' }, { name: 'Level', value: 'level' },
        { name: 'Experience', value: 'experience' }, { name: 'Nick', value: 'nick' }
      ]},
      { name: 'value', description: 'New value for the statistic', type: 3, required: true }
    ]);
  }

  private registerPlayerCommands() {
    this.reg('leaderboard', 'Show the leaderboard for a stat', leaderboard, [
      { name: 'mode', description: 'Stat to rank by', type: 3, required: false, choices: [
        { name: 'Elo', value: 'elo' }, { name: 'Wins', value: 'wins' }, { name: 'Losses', value: 'losses' },
        { name: 'Games', value: 'games' }, { name: 'MVPs', value: 'mvps' }, { name: 'Kills', value: 'kills' },
        { name: 'Deaths', value: 'deaths' }, { name: 'Beds Broken', value: 'bedBroken' }, { name: 'Final Kills', value: 'finalKills' },
        { name: 'Diamonds', value: 'diamonds' }, { name: 'Irons', value: 'irons' }, { name: 'Gold', value: 'gold' },
        { name: 'Emeralds', value: 'emeralds' }, { name: 'Blocks Placed', value: 'blocksPlaced' },
        { name: 'Winstreak', value: 'winstreak' }, { name: 'Losestreak', value: 'losestreak' },
        { name: 'KDR', value: 'kdr' }, { name: 'WLR', value: 'wlr' }, { name: 'Level', value: 'level' },
        { name: 'Experience', value: 'experience' }
      ]},
      { name: 'page', description: 'Page number', type: 4, required: false }
    ]);
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
    this.reg('recentgames', 'View recent games', recentgames, [
      { name: 'page', description: 'Page number', type: 4, required: false },
      { name: 'user', description: 'Filter by user (Discord ID, username, or mention)', type: 3, required: false }
    ]);
    this.reg('stats', 'View player stats', stats, [
      { name: 'user', description: 'Target user to view stats for', type: 6, required: false }
    ]);
    this.reg('call', 'Grant voice channel access to a user in game channels', call, [
      { name: 'user', description: 'The user to grant voice channel access to', type: 6, required: true }
    ]);
    this.reg('nick', 'Set or remove your nickname', nick, [
      { name: 'action', description: 'set or remove', type: 3, required: true, choices: [
        { name: 'set', value: 'set' }, { name: 'remove', value: 'remove' }
      ]},
      { name: 'nickname', description: 'The nickname to set (only for set action)', type: 3, required: false }
    ]);
    this.reg('settings', 'Edit your user settings', settings);
    this.regChat('changetheme', 'Change your stats image theme', executeChangeTheme, changeThemeData.toJSON().options || []);
    this.regChat('themes', 'List your owned themes and current theme', executeThemes, themesData.toJSON().options || []);
    this.reg('refresh', 'Refresh your nickname and roles', refresh);
    this.reg('queue', 'Show information about players in the current queue', queue);
    this.reg('history', 'View a user\'s history of bans, mutes, or strikes', history, [
      { name: 'userid', description: 'The Discord ID of the user', type: 3, required: true },
      { name: 'type', description: 'The type of history to view (ban, mute, strike)', type: 3, required: true, choices: [
        { name: 'Ban', value: 'ban' }, { name: 'Mute', value: 'mute' }, { name: 'Strike', value: 'strike' }
      ]}
    ]);
    this.reg('strikerequest', 'Request a strike against a player.', strikerequest, [
      { name: 'gameid', type: 3, description: 'The ID of the game.', required: true },
      { name: 'target', type: 6, description: 'The target user to strike.', required: true },
      { name: 'reason', type: 3, description: 'The reason for the strike.', required: true }
    ]);
    this.reg('voidrequest', 'Request to void a game.', voidrequest, [
      { name: 'gameid', type: 3, description: 'The ID of the game.', required: true },
      { name: 'reason', type: 3, description: 'The reason for voiding the game.', required: true }
    ]);
    this.regChat('screenshare', 'Request a screenshare on a user', screenshare, [
      { name: 'target', description: 'User to screenshare', type: 6, required: true },
      { name: 'reason', description: 'Reason for screenshare', type: 3, required: true },
      { name: 'image', description: 'Image evidence', type: 11, required: true }
    ]);
    this.regChat('level', 'View level and experience information', level, [
      { name: 'user', description: 'User to view level for (leave empty for yourself)', type: 6, required: false }
    ]);
    this.reg('seasoninfo', 'Show current season information and allowed items', seasoninfo);
  }

  private registerModeratorCommands() {
    this.reg('score', 'Report game score', score, [
      { name: 'gameid', description: 'Game ID', type: 4, required: true },
      { name: 'winningteam', description: 'Winning Team (1 or 2)', type: 4, required: true },
      { name: 'mvps', description: 'MVP players (comma-separated user IGNs)', type: 3, required: false },
      { name: 'bedbreaks', description: 'Players who broke beds (comma-separated user IGNs)', type: 3, required: false },
      { name: 'reason', description: 'Reason for the game result', type: 3, required: false }
    ]);
    this.reg('void', 'Void a game', voidGame, [
      { name: 'gameid', description: 'Game ID', type: 4, required: true },
      { name: 'reason', description: 'Reason for voiding the game', type: 3, required: true }
    ]);
    this.regChat('ban', 'Ban a user from the server', ban, [
      { name: 'user', description: 'User to ban (ID or mention)', type: 6, required: true },
      { name: 'duration', description: 'Ban duration (e.g. 1d, 1h)', type: 3, required: true },
      { name: 'reason', description: 'Reason for ban', type: 3, required: true }
    ]);
    this.regChat('mute', 'Mute a user in the server', mute, [
      { name: 'user', description: 'User to mute (ID or mention)', type: 6, required: true },
      { name: 'duration', description: 'Mute duration (e.g. 1d, 1h)', type: 3, required: true },
      { name: 'reason', description: 'Reason for mute', type: 3, required: true }
    ]);
    this.regChat('unmute', 'Unmute a user in the server', unmute, [
      { name: 'userid', description: 'User ID to unmute', type: 3, required: true }
    ]);
    this.regChat('strike', 'Issue a strike to a user', strike, [
      { name: 'user', description: 'User to strike (ID or mention)', type: 6, required: true },
      { name: 'reason', description: 'Reason for strike', type: 3, required: false }
    ]);
    this.regChat('unstrike', 'Remove a strike from a user', unstrike, [
      { name: 'user', description: 'User to remove strike from (ID or mention)', type: 6, required: true },
      { name: 'reason', description: 'Reason for removing strike', type: 3, required: false }
    ]);
    this.regChat('unban', 'Unban a user from the server', unban, [
      { name: 'userid', description: 'User ID to unban', type: 3, required: true }
    ]);
    this.reg('forcevoid', 'Force void the game associated with this channel', forcevoid);
    this.regChat('ssclose', 'Close a screenshare session', ssclose, [
      { name: 'reason', description: 'Reason for closing the session', type: 3, required: true }
    ]);
    this.reg('win', 'Give a win to a user', win, [
      { name: 'user', description: 'User to give win to', type: 6, required: true }
    ]);
    this.reg('lose', 'Give a loss to a user', lose, [
      { name: 'user', description: 'User to give loss to', type: 6, required: true }
    ]);
  }

  private registerGameCommands() {
    this.reg('retry', 'Retry a game', retry);
    this.reg('games', 'Show a list of games', games, [
      { name: 'page', description: 'Page number', type: 4, required: false }
    ]);
    this.reg('gameinfo', 'Show detailed info for a game by game ID', gameinfo, [
      { name: 'gameid', description: 'The ID of the game', type: 4, required: true }
    ]);
    this.reg('queues', 'Show a list of queues', queues, [
      { name: 'page', description: 'Page number', type: 4, required: false }
    ]);
    this.reg('ranks', 'Show the list of ELO ranks', ranks);
    this.reg('maps', 'Show available maps and select mode', async (interaction, args) => {
      await maps(interaction, args, this.commandHandler['wsManager']);
    });
    this.reg('help', 'Show help menu', help);
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
  }

  public async registerSlashCommands() {
    try {
      const commands = Array.from(this.commands.values()).map((cmd, cmdIndex) => {
        console.log(`[Command Manager] Processing command ${cmdIndex}: ${cmd.name}`);

        
        if (cmd.options) {
          cmd.options.forEach((option, index) => {
            if (!option.type) {
              console.error(`[Command Manager] Command "${cmd.name}" (index ${cmdIndex}) option at index ${index} is missing type field:`, JSON.stringify(option, null, 2));
            } else {
              console.log(`[Command Manager] Command "${cmd.name}" option ${index}: type=${option.type}, name=${option.name}`);
            }
          });
        } else {
          console.log(`[Command Manager] Command "${cmd.name}" has no options`);
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
    } catch (error: any) {
      console.error('[Command Manager] Error registering slash commands:', error);

      
      if (error.rawError && error.rawError.errors) {
        console.error('[Command Manager] Detailed error info:', JSON.stringify(error.rawError.errors, null, 2));
      }
    }
  }


}