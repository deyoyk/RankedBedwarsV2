import { 
  Client, 
  TextChannel, 
  VoiceChannel, 
  Guild, 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder,
  ComponentType,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import User from '../models/User';
import Party from '../models/Party';
import config from '../config/config';
import { PickingSession, GameResources } from '../types/GameTypes';
import { GameManager } from './GameManager';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { MapService } from '../managers/MapManager';
import { WorkersManager } from '../managers/WorkersManager';

import { CentralizedMatchmaker } from './CentralizedMatchmaker';

export class PickingQueueManager {
  private client: Client;
  private gameManager: GameManager;
  private wsManager: WebSocketManager;
  private mapService: MapService;
  private workersManager: WorkersManager;
  private activeSessions: Map<number, PickingSession> = new Map();
  private readonly PICK_TIMEOUT = 120000;
  private readonly SESSION_TIMEOUT = 600000;
  private centralizedMatchmaker: CentralizedMatchmaker;

  constructor(client: Client, centralizedMatchmaker: CentralizedMatchmaker, wsManager: WebSocketManager) {
    this.client = client;
    this.centralizedMatchmaker = centralizedMatchmaker;
    this.gameManager = centralizedMatchmaker.getGameManager();
    this.wsManager = wsManager;
    this.mapService = new MapService(wsManager);
    this.workersManager = WorkersManager.getInstance();
  }

  private async getPlayerParties(players: string[]): Promise<Map<string, string[]>> {
    try {
      const users = await User.find({
        discordId: { $in: players }
      }).select('discordId partyId');

      const partyIds = [...new Set(users.filter(u => u.partyId).map(u => u.partyId!))];
      
      if (partyIds.length === 0) {
        return new Map();
      }

      const parties = await Party.find({
        partyId: { $in: partyIds }
      }).select('partyId members');

      const partyMap = new Map<string, string[]>();
      for (const party of parties) {
        const partyMembers = party.members.filter(member => players.includes(member));
        if (partyMembers.length >= 2) {
          partyMap.set(party.partyId, partyMembers);
        }
      }

      return partyMap;
    } catch (error) {
      console.error('[PickingQueue] Error getting player parties:', error);
      return new Map();
    }
  }

  private async selectCaptainsWithParties(players: string[]): Promise<{ captains: string[], partyInfo: Map<string, string[]> }> {
    try {
      const partyMap = await this.getPlayerParties(players);
      const partyEntries = Array.from(partyMap.entries());
      
      const users = await User.find({
        discordId: { $in: players }
      }).select('discordId elo partyId').sort({ elo: -1 }).lean();

      if (users.length < 2) {
        throw new Error('Not enough players for captain selection');
      }

      const partyPlayers = new Set(partyEntries.flatMap(([_, members]) => members));
      const soloPlayers = players.filter(p => !partyPlayers.has(p));

      let captains: string[] = [];
      let remainingPlayers = [...players];

      if (partyEntries.length === 0) {
        const highestElo = users[0].discordId;
        const lowestElo = users[users.length - 1].discordId;
        captains = [highestElo, lowestElo];
      } else if (partyEntries.length === 1) {
        const [partyId, members] = partyEntries[0];
        const partyLeader = members[0];
        const soloCaptain = soloPlayers.length > 0 ? soloPlayers[0] : members[1];
        captains = [partyLeader, soloCaptain];
      } else if (partyEntries.length === 2) {
        const [party1Id, members1] = partyEntries[0];
        const [party2Id, members2] = partyEntries[1];
        captains = [members1[0], members2[0]];
      } else if (partyEntries.length >= 3) {
        const shuffledParties = partyEntries.sort(() => Math.random() - 0.5);
        const [party1Id, members1] = shuffledParties[0];
        const [party2Id, members2] = shuffledParties[1];
        captains = [members1[0], members2[0]];
      }

      remainingPlayers = remainingPlayers.filter(p => !captains.includes(p));
      
      return { captains, partyInfo: partyMap };
    } catch (error) {
      console.error('[PickingQueue] Error selecting captains with parties:', error);
      throw error;
    }
  }

  private getPartyPickingOrder(partyMap: Map<string, string[]>, captains: string[]): { 
    pickOrder: string[], 
    partyPlayers: Set<string>, 
    soloPlayers: string[] 
  } {
    const partyEntries = Array.from(partyMap.entries());
    const partyPlayers = new Set(partyEntries.flatMap(([_, members]) => members));
    const allPlayers = new Set(captains);
    const soloPlayers = Array.from(allPlayers).filter(p => !partyPlayers.has(p));

    let pickOrder: string[] = [];

    if (partyEntries.length === 0) {
      pickOrder = captains;
    } else if (partyEntries.length === 1) {
      const [partyId, members] = partyEntries[0];
      const partyCaptain = captains.find(c => members.includes(c))!;
      const soloCaptain = captains.find(c => !members.includes(c))!;
      
      pickOrder = [soloCaptain, partyCaptain];
    } else if (partyEntries.length === 2) {
      pickOrder = captains;
    } else if (partyEntries.length >= 3) {
      pickOrder = captains;
    }

    return { pickOrder, partyPlayers, soloPlayers };
  }

  private async buildGameStartEmbed(
    team1: string[],
    team2: string[],
    captains: string[],
    team1Avg: number,
    team2Avg: number,
    ignMap: Map<string, string>,
    status: string = 'Ongoing',
    gameid: number
  ): Promise<EmbedBuilder> {
    const team1Value = [
      `**Average Elo:** ${team1Avg}`,
      `**Captain:** <@${captains[0]}>`,
      `**Players:**`,
      ...team1.filter(id => id !== captains[0]).map(id => `‎ <@${id}>`),
      team1.length === 1 ? '‎ *(No other players)*' : ''
    ].filter(Boolean).join('\n');
    const team2Value = [
      `**Average Elo:** ${team2Avg}`,
      `**Captain:** <@${captains[1]}>`,
      `**Players:**`,
      ...team2.filter(id => id !== captains[1]).map(id => `‎  <@${id}>`),
      team2.length === 1 ? '‎ *(No other players)*' : ''
    ].filter(Boolean).join('\n');
    const statusField = `**Status:** ${status}`;
    return new EmbedBuilder()
      .setTitle(`Game #${gameid} Started`)
      .addFields(
        {
          name: '**TEAM GREEN**',
          value: team1Value,
          inline: true
        },
        {
          name: '**TEAM RED**',
          value: team2Value,
          inline: true
        },
        {
          name: '‎ ',
          value: statusField,
          inline: false
        }
      )
      .setFooter({ text: 'Season Beta' })
      .setColor('#00aaaa')
      .setTimestamp();
  }

  public async processQueue(
    players: string[], 
    queueData: any, 
    maxGames: number = 5
  ): Promise<number> {
    try {
      let gamesCreated = 0;
      let availablePlayers = [...players];

      console.log(`[PickingQueue] Processing ${availablePlayers.length} players, max ${maxGames} games`);

      while (availablePlayers.length >= queueData.maxPlayers && gamesCreated < maxGames) {
        try {
          
          const selectedPlayers = availablePlayers.slice(0, queueData.maxPlayers);
          
          
          const gameId = await this.gameManager.getNextGameId();
          const selectedMap = await this.selectRandomMap(queueData);

          
          const pickingResult = await this.runCaptainPicking(
            selectedPlayers,
            queueData,
            gameId,
            selectedMap
          );

          if (pickingResult.success) {
            
            availablePlayers = availablePlayers.filter(p => !selectedPlayers.includes(p));
            gamesCreated++;

            console.log(`[PickingQueue] Created game ${gameId}, ${availablePlayers.length} players remaining`);

            
            if (availablePlayers.length >= queueData.maxPlayers) {
              await this.sleep(2000);
            }
          } else {
            console.warn(`[PickingQueue] Failed to create game ${gameId}, stopping queue processing`);
            break;
          }

        } catch (error) {
          console.error(`[PickingQueue] Error creating game:`, error);
          break;
        }
      }

      return gamesCreated;

    } catch (error) {
      console.error(`[PickingQueue] Error processing queue:`, error);
      return 0;
    }
  }

  private async runCaptainPicking(
    players: string[],
    queueData: any,
    gameId: number,
    selectedMap: string
  ): Promise<{ success: boolean }> {
    let resources: Partial<GameResources> = {};
    let session: PickingSession | null = null;

    try {
      const guild = await this.getGuild();
      if (!guild) {
        throw new Error('Guild not found');
      }

      
      resources = await this.createPickingResources(guild, gameId, players, queueData);

      
      const { captains, partyInfo } = await this.selectCaptainsWithParties(players);
      const { pickOrder, partyPlayers, soloPlayers } = this.getPartyPickingOrder(partyInfo, captains);
      
      console.log(`[PickingQueue] Game ${gameId} - Captains: ${captains.join(', ')}`);
      console.log(`[PickingQueue] Game ${gameId} - Party info: ${partyInfo.size} parties`);
      if (partyInfo.size > 0) {
        for (const [partyId, members] of partyInfo.entries()) {
          console.log(`[PickingQueue] Game ${gameId} - Party ${partyId}: ${members.join(', ')}`);
        }
      }
      
      let team1 = [captains[0]];
      let team2 = [captains[1]];
      let remainingPlayers = players.filter(p => !captains.includes(p));

      if (partyInfo.size > 0) {
        const partyEntries = Array.from(partyInfo.entries());
        
        if (partyEntries.length === 1) {
          const [partyId, members] = partyEntries[0];
          const partyCaptain = captains.find(c => members.includes(c))!;
          const isPartyOnTeam1 = team1.includes(partyCaptain);
          
          for (const member of members) {
            if (member !== partyCaptain) {
              if (isPartyOnTeam1) {
                team1.push(member);
                console.log(`[PickingQueue] Game ${gameId} - Auto-picked ${member} to team1 (party member)`);
              } else {
                team2.push(member);
                console.log(`[PickingQueue] Game ${gameId} - Auto-picked ${member} to team2 (party member)`);
              }
              remainingPlayers = remainingPlayers.filter(p => p !== member);
            }
          }
        } else if (partyEntries.length >= 2) {
          for (const [partyId, members] of partyEntries) {
            const partyCaptain = captains.find(c => members.includes(c));
            if (partyCaptain) {
              const isPartyOnTeam1 = team1.includes(partyCaptain);
              
              for (const member of members) {
                if (member !== partyCaptain) {
                  if (isPartyOnTeam1) {
                    team1.push(member);
                    console.log(`[PickingQueue] Game ${gameId} - Auto-picked ${member} to team1 (party member)`);
                  } else {
                    team2.push(member);
                    console.log(`[PickingQueue] Game ${gameId} - Auto-picked ${member} to team2 (party member)`);
                  }
                  remainingPlayers = remainingPlayers.filter(p => p !== member);
                }
              }
            }
          }
        }
      }
      
      session = {
        gameId,
        captains,
        remainingPlayers,
        currentPicker: pickOrder[0], 
        pickCount: 0,
        team1, 
        team2, 
        timeout: setTimeout(() => this.handlePickingTimeout(gameId), this.SESSION_TIMEOUT),
        active: true,
        partyInfo,
        partyPlayers,
        pickOrder
      };

      console.log(`[PickingQueue] Game ${gameId} - Initial teams: Team1(${team1.join(', ')}) Team2(${team2.join(', ')})`);
      console.log(`[PickingQueue] Game ${gameId} - Remaining players: ${remainingPlayers.join(', ')}`);

      this.activeSessions.set(gameId, session);

      
      await this.moveAllToPickingVC(guild, players, resources.pickingChannel!.id);

      
      await this.sendPickingEmbed(resources.gameChannel!, session, selectedMap, queueData);

      
      const finalTeams = await this.executePicking(resources.gameChannel!, session);

      if (!finalTeams) {
        throw new Error('Picking process failed or was cancelled');
      }

      
      await this.gameManager.createGame(
        gameId,
        queueData,
        finalTeams.team1,
        finalTeams.team2,
        selectedMap
      );

      
      await this.gameManager.updateGameMap(gameId, selectedMap);
      await this.gameManager.initiateGameWarp(gameId);

      
      const ignMap = await this.getPlayerIGNs([...finalTeams.team1, ...finalTeams.team2]);
      const team1Avg = await this.calculateTeamAverageElo(finalTeams.team1);
      const team2Avg = await this.calculateTeamAverageElo(finalTeams.team2);
      const gameStartEmbed = await this.buildGameStartEmbed(
        finalTeams.team1,
        finalTeams.team2,
        session.captains,
        team1Avg,
        team2Avg,
        ignMap,
        'Ongoing',
        gameId
      );

      
      if (config.channels.gamesChannel) {
        await this.workersManager.sendMessage(
          config.channels.gamesChannel,
          { embeds: [gameStartEmbed] },
          8 
        );
      }

      
      if (resources.gameChannel) {
        await this.workersManager.sendMessage(
          resources.gameChannel.id,
          { embeds: [gameStartEmbed] },
          8 
        );
      }

      
      this.cleanupPickingSession(gameId);

      console.log(`[PickingQueue] Successfully completed picking for game ${gameId}`);
      return { success: true };

    } catch (error) {
      console.error(`[PickingQueue] Error in captain picking for game ${gameId}:`, error);

      
      if (session) {
        this.cleanupPickingSession(gameId);
      }
      if (resources.pickingChannel) {
        await this.workersManager.deleteChannel(resources.pickingChannel.id, 2);
      }
      if (resources.gameChannel) {
        await this.workersManager.deleteChannel(resources.gameChannel.id, 2);
      }

      return { success: false };
    }
  }

  private async createPickingResources(
    guild: Guild,
    gameId: number,
    players: string[],
    queueData: any
  ): Promise<Partial<GameResources>> {
    try {
      console.log(`[PickingQueue] Creating picking resources for game ${gameId} using WorkersManager`);
      
      
      const [pickingChannel, gameChannel] = await Promise.all([
        this.workersManager.createChannel({
          name: `picking-${gameId}`,
          type: ChannelType.GuildVoice,
          parent: config.categories.voiceCategory,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.Connect],
              allow: [PermissionFlagsBits.Speak]
            },
            ...players.map(playerId => ({
              id: playerId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.UseVAD,
                PermissionFlagsBits.Stream
              ]
            }))
          ]
        }, 9), 

        this.workersManager.createChannel({
          name: `game-${gameId}-picking`,
          type: ChannelType.GuildText,
          parent: config.categories.gameCategory,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            ...players.map(playerId => ({
              id: playerId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
              ]
            }))
          ]
        }, 9) 
      ]);

      console.log(`[PickingQueue] Successfully created picking resources for game ${gameId}`);

      return {
        gameId,
        gameChannel,
        pickingChannel
      };

    } catch (error) {
      console.error(`[PickingQueue] Error creating picking resources:`, error);
      throw error;
    }
  }

  private async selectCaptains(players: string[]): Promise<string[]> {
    try {
      const users = await User.find({
        discordId: { $in: players }
      }).select('discordId elo').sort({ elo: -1 });

      if (users.length < 2) {
        throw new Error('Not enough players for captain selection');
      }

      
      const highestElo = users[0].discordId;
      const lowestElo = users[users.length - 1].discordId;

      return [highestElo, lowestElo];

    } catch (error) {
      console.error('[PickingQueue] Error selecting captains:', error);
      throw error;
    }
  }

  private async moveAllToPickingVC(guild: Guild, playerIds: string[], vcId: string): Promise<void> {
    try {
      console.log(`[PickingQueue] Moving ${playerIds.length} players to picking VC using WorkersManager`);
      
      
      await this.workersManager.moveMembers(playerIds, vcId, 8); 
      
      console.log(`[PickingQueue] Successfully moved players to picking voice channel`);
    } catch (error) {
      console.error('[PickingQueue] Error moving players to picking VC:', error);
    }
  }

  private async sendPickingEmbed(
    channel: TextChannel,
    session: PickingSession,
    map: string,
    queueData: any
  ): Promise<void> {
    try {
      const embed = await this.buildPickingEmbed(session, map, queueData);
      const selectMenu = await this.buildSelectMenu(session);

      await channel.send({
        content: `<@${session.currentPicker}> it's your turn to pick!`,
        embeds: [embed],
        components: selectMenu ? [selectMenu] : []
      });

    } catch (error) {
      console.error('[PickingQueue] Error sending picking embed:', error);
    }
  }

  private async buildPickingEmbed(
    session: PickingSession,
    map: string,
    queueData: any
  ): Promise<EmbedBuilder> {
    try {
      const ignMap = await this.getPlayerIGNs([...session.team1, ...session.team2, ...session.remainingPlayers]);
      
      const team1Avg = await this.calculateTeamAverageElo(session.team1);
      const team2Avg = await this.calculateTeamAverageElo(session.team2);
      const team1Captain = session.captains[0];
      const team2Captain = session.captains[1];
      const team1Players = session.team1.filter(id => id !== team1Captain);
      const team2Players = session.team2.filter(id => id !== team2Captain);
      
      const team1Value = [
        `**Average Elo:** ${team1Avg}`,
        `**Captain:** <@${team1Captain}>`,
        `**Players:**`,
        ...team1Players.map(id => `‎ <@${id}>`),
        team1Players.length === 0 ? '‎ *(No other players)*' : ''
      ].filter(Boolean).join('\n');
      
      const team2Value = [
        `**Average Elo:** ${team2Avg}`,
        `**Captain:** <@${team2Captain}>`,
        `**Players:**`,
        ...team2Players.map(id => `‎ <@${id}>`),
        team2Players.length === 0 ? '‎ *(No other players)*' : ''
      ].filter(Boolean).join('\n');
      const autoPickTime = new Date(Date.now() + this.PICK_TIMEOUT);
      const autoPickTimestamp = Math.floor(autoPickTime.getTime() / 1000);
      
      
      const mapField = [
        `**Map:** ${map}`,
        `**Status:** Ongoing`,
        `**Auto-pick:** <t:${autoPickTimestamp}:R>`
      ].join('\n');
      return new EmbedBuilder()
        .setTitle(`**Game #${session.gameId} Started**`)
        .addFields(
          {
            name: '**TEAM GREEN**',
            value: team1Value,
            inline: true
          },
          {
            name: '**TEAM RED**',
            value: team2Value,
            inline: true
          },
          {
            name: '‎ ', 
            value: mapField,
            inline: false
          }
        )
        .setColor('#00aaaa')
        .setTimestamp();
    } catch (error) {
      console.error('[PickingQueue] Error building picking embed:', error);
      return new EmbedBuilder().setTitle('Error').setDescription('Could not build picking embed');
    }
  }

  private async buildSelectMenu(session: PickingSession): Promise<ActionRowBuilder<StringSelectMenuBuilder> | null> {
    try {
      if (session.remainingPlayers.length === 0) return null;

      const availablePlayers = session.remainingPlayers;

      if (availablePlayers.length === 0) return null;

      
      const users = await User.find({
        discordId: { $in: availablePlayers }
      }).select('discordId ign elo wins losses kills deaths');

      const options = await Promise.all(availablePlayers.map(async (playerId) => {
        const user = users.find(u => u.discordId === playerId);
        
        if (!user) {
          return {
            label: `Player ${playerId.substring(0, 8)}...`,
            value: playerId,
            description: 'Stats unavailable'
          };
        }

        
        const wlr = user.losses > 0 ? (user.wins / user.losses).toFixed(2) : user.wins.toString();
        const kdr = user.deaths > 0 ? (user.kills / user.deaths).toFixed(2) : user.kills.toString();
        
        return {
          label: user.ign || `Player ${playerId.substring(0, 8)}...`,
          value: playerId,
          description: `${user.elo} ELO | ${wlr} WLR | ${kdr} KDR`
        };
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`pick_player_${session.gameId}`)
        .setPlaceholder('Select a player to pick')
        .addOptions(options.slice(0, 25)); 

      return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    } catch (error) {
      console.error('[PickingQueue] Error building select menu:', error);
      return null;
    }
  }

  private async executePicking(
    channel: TextChannel,
    session: PickingSession
  ): Promise<{ team1: string[], team2: string[] } | null> {
    try {
      while (session.remainingPlayers.length > 0 && session.active) {
        const pickedPlayer = await this.awaitPick(channel, session);

        if (!pickedPlayer) {
          await this.sendVoidNotice(channel);
          return null;
        }

        
        if (session.currentPicker === session.captains[0]) {
          session.team1.push(pickedPlayer);
        } else if (session.currentPicker === session.captains[1]) {
          session.team2.push(pickedPlayer);
        } else {
          
          
          if (session.pickCount % 2 === 0) {
            session.team1.push(pickedPlayer);
          } else {
            session.team2.push(pickedPlayer);
          }
        }

        
        session.remainingPlayers = session.remainingPlayers.filter(p => p !== pickedPlayer);
        session.pickCount++;

        
        session.currentPicker = this.getNextPickerWithParties(session);

        
        if (session.remainingPlayers.length > 0) {
          await this.sendPickingEmbed(channel, session, 'TBD', { isRanked: false });
        }
      }

      
      await this.distributeRemainingPlayers(session);

      
      const verifiedTeams = this.verifyAndCorrectTeams(session);
      
      
      const finalCheck = this.performFinalTeamVerification(verifiedTeams, session.gameId);
      if (!finalCheck.isValid) {
        console.error(`[PickingQueue] Game ${session.gameId} - Final verification failed:`, finalCheck.issues);
        throw new Error(`Team verification failed for game ${session.gameId}: ${finalCheck.issues.join(', ')}`);
      }
      
      return verifiedTeams;

    } catch (error) {
      console.error('[PickingQueue] Error executing picking:', error);
      return null;
    }
  }

  private async awaitPick(channel: TextChannel, session: PickingSession): Promise<string | null> {
    try {
      const collector = channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: this.PICK_TIMEOUT,
        filter: (interaction) => {
          return interaction.customId === `pick_player_${session.gameId}` &&
                 interaction.user.id === session.currentPicker;
        }
      });

      return new Promise((resolve) => {
        collector.on('collect', async (interaction) => {
          const pickedPlayer = interaction.values[0];
          
          
          if (!this.isValidPick(session, pickedPlayer)) {
            await interaction.reply({
              content: `❌ Invalid pick! <@${pickedPlayer}> is not available for selection.`,
              ephemeral: true
            });
            return;
          }
          
          await interaction.reply({
            content: `<@${session.currentPicker}> picked <@${pickedPlayer}>!`,
            ephemeral: false
          });

          collector.stop();
          resolve(pickedPlayer);
        });

        collector.on('end', (collected) => {
          if (collected.size === 0) {
            
            if (session.remainingPlayers.length > 0) {
              const randomPlayer = session.remainingPlayers[
                Math.floor(Math.random() * session.remainingPlayers.length)
              ];
              
              const now = new Date();
              const timestamp = Math.floor(now.getTime() / 1000);
              channel.send(`<@${session.currentPicker}> took too long! Auto-picked <@${randomPlayer}> at <t:${timestamp}:F>`);
              resolve(randomPlayer);
            } else {
              resolve(null);
            }
          }
        });
      });

    } catch (error) {
      console.error('[PickingQueue] Error awaiting pick:', error);
      return null;
    }
  }

  private isValidPick(session: PickingSession, pickedPlayer: string): boolean {
    
    if (!session.remainingPlayers.includes(pickedPlayer)) {
      console.warn(`[PickingQueue] Game ${session.gameId} - Invalid pick: ${pickedPlayer} not in remaining players`);
      return false;
    }
    
    
    if (session.team1.includes(pickedPlayer) || session.team2.includes(pickedPlayer)) {
      console.warn(`[PickingQueue] Game ${session.gameId} - Invalid pick: ${pickedPlayer} already on a team`);
      return false;
    }
    
    return true;
  }

  private getNextPicker(session: PickingSession): string {
    
    const pickRound = Math.floor(session.pickCount / 2);
    const isFirstCaptainTurn = pickRound % 2 === 0 ? 
      session.pickCount % 2 === 0 : 
      session.pickCount % 2 === 1;

    return isFirstCaptainTurn ? session.captains[0] : session.captains[1];
  }

  private getNextPickerWithParties(session: PickingSession): string {
    try {
      if (!session.pickOrder || session.pickOrder.length === 0) {
        console.log(`[PickingQueue] Game ${session.gameId} - No pick order defined, using standard picking`);
        return this.getNextPicker(session);
      }

      const partyEntries = session.partyInfo ? Array.from(session.partyInfo.entries()) : [];
      
      if (partyEntries.length === 0) {
        return this.getNextPicker(session);
      } else if (partyEntries.length === 1) {
        const [partyId, members] = partyEntries[0];
        const partyCaptain = session.captains.find(c => members.includes(c));
        const soloCaptain = session.captains.find(c => !members.includes(c));
        
        if (!partyCaptain || !soloCaptain) {
          console.warn(`[PickingQueue] Game ${session.gameId} - Invalid captain configuration, using standard picking`);
          return this.getNextPicker(session);
        }
        
        if (session.pickCount === 0) {
          return soloCaptain;
        } else if (session.pickCount === 1) {
          return partyCaptain;
        } else if (session.pickCount === 2) {
          return partyCaptain;
        } else if (session.pickCount === 3) {
          return soloCaptain;
        } else {
          return this.getNextPicker(session);
        }
      } else if (partyEntries.length >= 2) {
        return this.getNextPicker(session);
      }

      return this.getNextPicker(session);
      
    } catch (error) {
      console.error(`[PickingQueue] Game ${session.gameId} - Error in getNextPickerWithParties:`, error);
      return this.getNextPicker(session);
    }
  }

  private async distributeRemainingPlayers(session: PickingSession): Promise<void> {
    try {
      while (session.remainingPlayers.length > 0) {
        const player = session.remainingPlayers.pop()!;
        if (session.team1.length <= session.team2.length) {
          session.team1.push(player);
        } else {
          session.team2.push(player);
        }
      }
    } catch (error) {
      console.error('[PickingQueue] Error distributing remaining players:', error);
    }
  }

  private async sendVoidNotice(channel: TextChannel): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setTitle('❌ Game Cancelled')
        .setDescription('The picking process was cancelled due to timeout or other issues.')
        .setColor('#00AAAA')
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[PickingQueue] Error sending void notice:', error);
    }
  }

  private async getPlayerIGNs(playerIds: string[]): Promise<Map<string, string>> {
    try {
      const users = await User.find({ 
        discordId: { $in: playerIds } 
      }).select('discordId ign');

      return new Map(users.map(u => [u.discordId, u.ign]));

    } catch (error) {
      console.error('[PickingQueue] Error getting player IGNs:', error);
      return new Map();
    }
  }

  private async calculateTeamAverageElo(playerIds: string[]): Promise<number> {
    try {
      if (playerIds.length === 0) return 0;
  
      const users = await User.find({
        discordId: { $in: playerIds }
      }).select('elo');
  
      const totalElo = users.reduce((sum, user) => sum + (user.elo || 0), 0);
      return Math.round(totalElo / playerIds.length); 
  
    } catch (error) {
      console.error('[PickingQueue] Error calculating team average ELO:', error);
      return 0;
    }
  }
  

  private async selectRandomMap(queueData: any): Promise<string> {
    try {
      const reservedMaps = await this.mapService.getReservedMaps();
      const candidates = reservedMaps.filter(m => (m.maxplayers ?? (m as any).max_players) === queueData.maxPlayers);

      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        console.log(`[PickingQueue] Selected reserved map: ${pick.name}`);
        return pick.name;
      }

      console.warn('[PickingQueue] No reserved maps matching queue size, falling back to unlocked maps');
      const unlockedMaps = await this.mapService.getUnlockedMaps();
      const unlockedCandidates = unlockedMaps.filter(m => (m.maxplayers ?? (m as any).max_players) === queueData.maxPlayers);

      if (unlockedCandidates.length > 0) {
        const pick = unlockedCandidates[Math.floor(Math.random() * unlockedCandidates.length)];
        return pick.name;
      }

      if (unlockedMaps.length > 0) {
        const pick = unlockedMaps[Math.floor(Math.random() * unlockedMaps.length)];
        return pick.name;
      }

      return 'Aquarius';
      
    } catch (error) {
      console.error('[PickingQueue] Error selecting map:', error);
      return 'Aquarius';
    }
  }

  private handlePickingTimeout(gameId: number): void {
    try {
      console.log(`[PickingQueue] Picking session timeout for game ${gameId}`);
      this.cleanupPickingSession(gameId);
    } catch (error) {
      console.error(`[PickingQueue] Error handling picking timeout for game ${gameId}:`, error);
    }
  }

  private cleanupPickingSession(gameId: number): void {
    try {
      const session = this.activeSessions.get(gameId);
      if (session) {
        clearTimeout(session.timeout);
        session.active = false;
        this.activeSessions.delete(gameId);
      }
    } catch (error) {
      console.error(`[PickingQueue] Error cleaning up picking session ${gameId}:`, error);
    }
  }

  private async getGuild(): Promise<Guild | null> {
    try {
      return this.client.guilds.cache.first() || null;
    } catch (error) {
      console.error('[PickingQueue] Error getting guild:', error);
      return null;
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private validateTeamBalance(team1: string[], team2: string[], gameId: number): {
    isValid: boolean;
    issues: string[];
    difference: number;
  } {
    const issues: string[] = [];
    const difference = Math.abs(team1.length - team2.length);
    
    if (difference > 1) {
      issues.push(`Team size difference too large: Team1(${team1.length}) vs Team2(${team2.length})`);
    }
    
    if (team1.length === 0 || team2.length === 0) {
      issues.push('One or both teams are empty');
    }
    
    if (team1.length + team2.length < 2) {
      issues.push('Not enough players to start a game');
    }
    
    const isValid = issues.length === 0;
    
    console.log(`[PickingQueue] Game ${gameId} - Team balance validation: Team1(${team1.length}) Team2(${team2.length}) Difference: ${difference} Valid: ${isValid}`);
    
    return { isValid, issues, difference };
  }

  private fixTeamImbalance(session: PickingSession): void {
    try {
      console.log(`[PickingQueue] Game ${session.gameId} - Attempting to fix team imbalance`);
      
      const team1Size = session.team1.length;
      const team2Size = session.team2.length;
      const difference = Math.abs(team1Size - team2Size);
      
      if (difference <= 1) {
        console.log(`[PickingQueue] Game ${session.gameId} - Teams are balanced, no fix needed`);
        return;
      }
      
      
      if (team1Size > team2Size) {
        const playerToMove = session.team1.pop()!;
        session.team2.push(playerToMove);
        console.log(`[PickingQueue] Game ${session.gameId} - Moved ${playerToMove} from Team1 to Team2 to balance teams`);
      }
      
      else if (team2Size > team1Size) {
        const playerToMove = session.team2.pop()!;
        session.team1.push(playerToMove);
        console.log(`[PickingQueue] Game ${session.gameId} - Moved ${playerToMove} from Team2 to Team1 to balance teams`);
      }
      
      console.log(`[PickingQueue] Game ${session.gameId} - After fix: Team1(${session.team1.join(', ')}) Team2(${session.team2.join(', ')})`);
      
    } catch (error) {
      console.error(`[PickingQueue] Game ${session.gameId} - Error fixing team imbalance:`, error);
    }
  }

  private verifyAndCorrectTeams(session: PickingSession): { team1: string[], team2: string[] } {
    try {
      console.log(`[PickingQueue] Game ${session.gameId} - Starting team verification and correction`);
      
      
      let team1 = [...session.team1];
      let team2 = [...session.team2];
      let remainingPlayers = [...session.remainingPlayers];
      
      console.log(`[PickingQueue] Game ${session.gameId} - Initial state: Team1(${team1.join(', ')}) Team2(${team2.join(', ')}) Remaining(${remainingPlayers.join(', ')})`);

      
      if (!team1.includes(session.captains[0])) {
        console.warn(`[PickingQueue] Game ${session.gameId} - Captain 1 not in team1, fixing...`);
        team1 = [session.captains[0]];
        team2 = [session.captains[1]];
        
        remainingPlayers = remainingPlayers.filter(p => !session.captains.includes(p));
      }
      
      if (!team2.includes(session.captains[1])) {
        console.warn(`[PickingQueue] Game ${session.gameId} - Captain 2 not in team2, fixing...`);
        team2 = [session.captains[1]];
        
        remainingPlayers = remainingPlayers.filter(p => p !== session.captains[1]);
      }

      
      if (session.partyInfo && session.partyInfo.size > 0) {
        const partyEntries = Array.from(session.partyInfo.entries());
        
        for (const [partyId, members] of partyEntries) {
          const partyCaptain = session.captains.find(c => members.includes(c));
          if (partyCaptain) {
            const isPartyOnTeam1 = team1.includes(partyCaptain);
            
            
            for (const member of members) {
              if (member !== partyCaptain && remainingPlayers.includes(member)) {
                if (isPartyOnTeam1) {
                  team1.push(member);
                  console.log(`[PickingQueue] Game ${session.gameId} - Auto-assigned party member ${member} to Team1`);
                } else {
                  team2.push(member);
                  console.log(`[PickingQueue] Game ${session.gameId} - Auto-assigned party member ${member} to Team2`);
                }
                remainingPlayers = remainingPlayers.filter(p => p !== member);
              }
            }
          }
        }
      }

      
      while (remainingPlayers.length > 0) {
        const player = remainingPlayers.pop()!;
        if (team1.length <= team2.length) {
          team1.push(player);
          console.log(`[PickingQueue] Game ${session.gameId} - Assigned ${player} to Team1 for balance`);
        } else {
          team2.push(player);
          console.log(`[PickingQueue] Game ${session.gameId} - Assigned ${player} to Team2 for balance`);
        }
      }

      
      const validationResult = this.validateTeamBalance(team1, team2, session.gameId);
      if (!validationResult.isValid) {
        console.warn(`[PickingQueue] Game ${session.gameId} - Team balance validation failed:`, validationResult.issues);
        
        
        while (Math.abs(team1.length - team2.length) > 1) {
          if (team1.length > team2.length) {
            const playerToMove = team1.pop()!;
            team2.push(playerToMove);
            console.log(`[PickingQueue] Game ${session.gameId} - Moved ${playerToMove} from Team1 to Team2 for balance`);
          } else {
            const playerToMove = team2.pop()!;
            team1.push(playerToMove);
            console.log(`[PickingQueue] Game ${session.gameId} - Moved ${playerToMove} from Team2 to Team1 for balance`);
          }
        }
      }

      
      const finalValidation = this.validateTeamBalance(team1, team2, session.gameId);
      if (!finalValidation.isValid) {
        throw new Error(`Team balance validation failed after all corrections for game ${session.gameId}`);
      }

      console.log(`[PickingQueue] Game ${session.gameId} - Final verified teams: Team1(${team1.join(', ')}) Team2(${team2.join(', ')})`);
      
      return { team1, team2 };
      
    } catch (error) {
      console.error(`[PickingQueue] Game ${session.gameId} - Critical error in team verification:`, error);
      
      
      const { captains } = session;
      const allPlayers = [...session.team1, ...session.team2, ...session.remainingPlayers];
      const uniquePlayers = [...new Set(allPlayers)];
      
      let emergencyTeam1 = [captains[0]];
      let emergencyTeam2 = [captains[1]];
      let remaining = uniquePlayers.filter(p => !captains.includes(p));
      
      
      for (let i = 0; i < remaining.length; i++) {
        if (i % 2 === 0) {
          emergencyTeam1.push(remaining[i]);
        } else {
          emergencyTeam2.push(remaining[i]);
        }
      }
      
      console.log(`[PickingQueue] Game ${session.gameId} - Emergency fallback teams: Team1(${emergencyTeam1.join(', ')}) Team2(${emergencyTeam2.join(', ')})`);
      
      return { team1: emergencyTeam1, team2: emergencyTeam2 };
    }
  }

  private performFinalTeamVerification(verifiedTeams: { team1: string[], team2: string[] }, gameId: number): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    
    const allPlayers = [...verifiedTeams.team1, ...verifiedTeams.team2];
    const uniquePlayers = [...new Set(allPlayers)];

    if (uniquePlayers.length !== allPlayers.length) {
      issues.push('Duplicate players found on teams');
    }

    
    const session = this.activeSessions.get(gameId);
    if (session) {
      const originalPlayers = [...session.remainingPlayers || [], ...session.team1 || [], ...session.team2 || []];
      const uniqueOriginalPlayers = [...new Set(originalPlayers)];

      if (uniqueOriginalPlayers.length !== allPlayers.length) {
        issues.push('Some players were not assigned to a team or were assigned multiple times');
      }

      
      if (!verifiedTeams.team1.includes(session.captains[0])) {
        issues.push(`Captain 1 (${session.captains[0]}) not in Team1`);
      }
      if (!verifiedTeams.team2.includes(session.captains[1])) {
        issues.push(`Captain 2 (${session.captains[1]}) not in Team2`);
      }

      
      if (session.partyInfo && session.partyInfo.size > 0) {
        const partyEntries = Array.from(session.partyInfo.entries());
        for (const [partyId, members] of partyEntries) {
          const partyCaptain = session.captains.find(c => members.includes(c));
          if (partyCaptain) {
            const isPartyOnTeam1 = verifiedTeams.team1.includes(partyCaptain);
            for (const member of members) {
              if (member !== partyCaptain) {
                if (isPartyOnTeam1 && !verifiedTeams.team1.includes(member)) {
                  issues.push(`Party member ${member} not in Team1 for party ${partyId}`);
                } else if (!isPartyOnTeam1 && !verifiedTeams.team2.includes(member)) {
                  issues.push(`Party member ${member} not in Team2 for party ${partyId}`);
                }
              }
            }
          }
        }
      }
    }

    const isValid = issues.length === 0;
    console.log(`[PickingQueue] Game ${gameId} - Final team verification: Valid: ${isValid}, Issues: ${issues.length > 0 ? issues.join(', ') : 'None'}`);
    return { isValid, issues };
  }

  public cleanup(): void {
    try {
      for (const session of this.activeSessions.values()) {
        clearTimeout(session.timeout);
      }
      this.activeSessions.clear();
    } catch (error) {
      console.error('[PickingQueue] Error during cleanup:', error);
    }
  }
}