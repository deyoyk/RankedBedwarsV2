import {
  ActionRowBuilder,
  Client,
  ComponentType,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import config from '../config/config';
import { embedsFor } from '../utils/betterembed';
import { tallyMapVotes } from '../utils/mapVote';
import { getPlayerIgns } from '../utils/playerDirectory';

const { themedEmbed } = embedsFor('Map voting');

interface MapVoteInteraction {
  user: { id: string };
  values: string[];
  reply(options: { content: string; ephemeral: boolean }): Promise<unknown>;
  update(options: {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<StringSelectMenuBuilder>[];
  }): Promise<unknown>;
}

interface MapVoteCollector {
  on(event: 'collect', listener: (interaction: MapVoteInteraction) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  stop(reason?: string): void;
}

interface MapVoteMessage {
  edit(options: { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] }): Promise<unknown>;
}

/** The Minecraft server link: the vote is shown in game chat too, and votes clicked there come back. */
export interface InGameVoteLink {
  send(payload: object): void;
  setGlobalHandler(type: string, handler: (msg: object) => void): void;
}

/** Votes clicked in game are bundled for this long, so chat gets one update instead of one per click. */
export const IN_GAME_PUSH_MS = 1000;

/** The votes running now, by game id, so a vote clicked in game reaches the right one. */
const running = new Map<number, (ign: string, map: string) => void>();
let inGame: InGameVoteLink | null = null;

function castInGame(payload: object): void {
  const msg = payload as { game_id?: unknown; ign?: unknown; map?: unknown };
  running.get(Number(msg.game_id))?.(String(msg.ign ?? ''), String(msg.map ?? ''));
}

interface MapVoteChannel {
  id: string;
  send(options: {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<StringSelectMenuBuilder>[];
  }): Promise<MapVoteMessage>;
  createMessageComponentCollector(options: {
    componentType: ComponentType;
    time: number;
  }): MapVoteCollector;
}

function voteCounts(votes: Map<string, string>, candidates: string[]): Map<string, number> {
  const counts = new Map(candidates.map(name => [name, 0]));
  for (const selected of votes.values()) {
    if (counts.has(selected)) counts.set(selected, (counts.get(selected) ?? 0) + 1);
  }
  return counts;
}

export class MapVoteService {
  constructor(private readonly client: Client) {}

  /** Done once at startup: from then on every vote is shown in game chat too. Null unlinks. */
  static linkInGame(link: InGameVoteLink | null): void {
    inGame = link;
    link?.setGlobalHandler('map_vote_cast', castInGame);
  }

  public async run(
    gameId: number,
    channelId: string,
    playerIds: string[],
    candidateNames: string[],
  ): Promise<string | null> {
    const candidates = [...new Set(candidateNames.filter(Boolean))].slice(0, 25);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const players = [...new Set(playerIds.filter(Boolean))];
    if (players.length === 0) return candidates[0];

    const channel = await this.fetchChannel(channelId);
    if (!channel) {
      console.warn(`[MapVote] Could not open voting channel ${channelId} for game ${gameId}`);
      return candidates[0];
    }

    const votes = new Map<string, string>();
    let message: MapVoteMessage;
    try {
      message = await channel.send({
        embeds: [this.buildEmbed(gameId, candidates, votes)],
        components: [this.buildMenu(gameId, candidates)],
      });
    } catch (error) {
      console.error(`[MapVote] Could not send map vote for game ${gameId}:`, error);
      return candidates[0];
    }

    const link = inGame;
    const igns = link ? await getPlayerIgns(players).catch(() => new Map<string, string>()) : new Map<string, string>();
    const idByIgn = new Map([...igns].map(([id, ign]) => [ign.toLowerCase(), id]));
    const endsAt = Date.now() + config.mapSelection.timeoutSeconds * 1000;

    return new Promise<string>(resolve => {
      let settled = false;
      let pushTimer: NodeJS.Timeout | null = null;
      const collector = channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: config.mapSelection.timeoutSeconds * 1000,
      });

      const pushNow = (winner?: string): void => {
        if (!link) return;
        const counts = voteCounts(votes, candidates);
        const picks: Record<string, string> = {};
        for (const [id, map] of votes) {
          const ign = igns.get(id);
          if (ign) picks[ign] = map;
        }
        link.send({
          type: 'map_vote',
          game_id: gameId,
          maps: candidates.map(name => ({ name, votes: counts.get(name) ?? 0 })),
          players: [...igns.values()],
          picks,
          seconds_left: Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)),
          ...(winner ? { winner } : {}),
        });
      };
      const schedulePush = (): void => {
        if (!link || pushTimer || settled) return;
        pushTimer = setTimeout(() => {
          pushTimer = null;
          if (!settled) pushNow();
        }, IN_GAME_PUSH_MS);
      };

      const finish = (): void => {
        if (settled) return;
        settled = true;
        running.delete(gameId);
        if (pushTimer) clearTimeout(pushTimer);
        const result = tallyMapVotes(votes, candidates);
        const winner = result.winner ?? candidates[0];
        void message.edit({
          embeds: [this.buildEmbed(gameId, candidates, votes, winner)],
          components: [],
        }).catch(() => undefined);
        pushNow(winner);
        resolve(winner);
      };

      if (link) {
        running.set(gameId, (ign, map) => {
          const id = idByIgn.get(ign.toLowerCase());
          if (settled || !id || !candidates.includes(map)) return;
          votes.set(id, map);
          void message.edit({
            embeds: [this.buildEmbed(gameId, candidates, votes)],
            components: [this.buildMenu(gameId, candidates)],
          }).catch(() => undefined);
          schedulePush();
          if (votes.size >= players.length) collector.stop('all_voted');
        });
        pushNow();
      }

      collector.on('collect', interaction => {
        void (async () => {
          if (!players.includes(interaction.user.id)) {
            await interaction.reply({ content: 'Only players in this game can vote.', ephemeral: true });
            return;
          }
          const selected = interaction.values[0];
          if (!candidates.includes(selected)) {
            await interaction.reply({ content: 'That map is not part of this vote.', ephemeral: true });
            return;
          }

          votes.set(interaction.user.id, selected);
          await interaction.update({
            embeds: [this.buildEmbed(gameId, candidates, votes)],
            components: [this.buildMenu(gameId, candidates)],
          });
          schedulePush();
          if (votes.size >= players.length) collector.stop('all_voted');
        })().catch(error => {
          console.error(`[MapVote] Error recording map vote for game ${gameId}:`, error);
        });
      });

      collector.on('end', finish);
    });
  }

  private async fetchChannel(channelId: string): Promise<MapVoteChannel | null> {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) return null;
      const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return null;
      return channel as unknown as MapVoteChannel;
    } catch {
      return null;
    }
  }

  private buildEmbed(
    gameId: number,
    candidates: string[],
    votes: Map<string, string>,
    winner?: string,
  ): EmbedBuilder {
    const counts = voteCounts(votes, candidates);
    const fields = candidates.map((name, index) => ({
      name: `Map ${index + 1}`,
      value: `**${name}**\nVotes: ${counts.get(name) ?? 0}`,
      inline: true,
    }));
    if (winner) {
      fields.push({ name: 'Selected Map', value: `**${winner}**`, inline: false });
    }

    return themedEmbed('info')
      .setTitle(`Game #${gameId} Map Vote`)
      .setDescription(
        winner
          ? `Voting has ended. **${winner}** will be played for Game #${gameId}.`
          : 'Vote for the map you want to play. Each player gets one vote; the map with the most votes wins. Ties go to the higher-rated map.',
      )
      .addFields(fields);
  }

  private buildMenu(
    gameId: number,
    candidates: string[],
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`map_vote_${gameId}`)
      .setPlaceholder('Choose a map')
      .addOptions(candidates.map(name => ({ label: name, value: name })));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }
}
