import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';
import Game, { type IGame } from '../../models/Game';
import User from '../../models/User';
import { formatMapName } from '../../utils/mapName';
import { buildGameResultImage, formatGameDuration } from '../../utils/gameResultImage';
import { submitVoidRequest } from '../scoring/voidrequest';

const { themedEmbed, errorEmbed } = embedsFor('Game');

const STATUS_LABEL: Record<string, string> = {
  scored: 'scored',
  voided: 'voided',
  scoring: 'scoring',
  active: 'in_progress',
  pending: 'in_progress',
};

interface PlayerView {
  eloGain: number;
  kills: number;
  deaths: number;
  diamonds: number;
  hasStats: boolean;
}

const unix = (d: Date | string) => Math.floor(new Date(d).getTime() / 1000);

async function loadPlayers(game: IGame): Promise<Map<string, PlayerView>> {
  const ids = Array.from(new Set([...(game.team1 || []), ...(game.team2 || [])]));
  const users = await User.find({ discordId: { $in: ids } })
    .select({ discordId: 1, recentGames: { $elemMatch: { gameId: game.gameId } } })
    .lean() as Array<{ discordId: string; recentGames?: Array<{ eloGain?: number; kills?: number; deaths?: number; diamonds?: number; state?: string }> }>;
  const combat = new Map((game.combat || []).map(c => [c.player, c]));

  const players = new Map<string, PlayerView>();
  for (const id of ids) {
    const recent = users.find(u => u.discordId === id)?.recentGames?.[0];
    const scored = recent && recent.state === 'scored' ? recent : null;
    const fight = combat.get(id);
    players.set(id, {
      eloGain: typeof scored?.eloGain === 'number' ? scored.eloGain : 0,
      kills: scored?.kills ?? fight?.kills ?? 0,
      deaths: scored?.deaths ?? fight?.deaths ?? 0,
      diamonds: scored?.diamonds ?? 0,
      hasStats: Boolean(scored || fight),
    });
  }
  return players;
}

function buildEmbed(game: IGame, players: Map<string, PlayerView>, guild: Guild | null): EmbedBuilder {
  const state = game.state || 'pending';
  const inProgress = state === 'pending' || state === 'active' || state === 'scoring';
  const scored = state === 'scored' && (game.winners || []).length > 0;
  const winningTeam = scored ? ((game.team1 || []).includes(game.winners[0]) ? 1 : 2) : null;

  const findEmoji = (name: string, fallback: string) => {
    const emoji = guild?.emojis?.cache?.find(e => e.name === name);
    return emoji ? `<:${name}:${emoji.id}>` : fallback;
  };
  const sword = findEmoji('sword', '⚔️');
  const diamond = findEmoji('diamond', '💎');

  // Enemy diamonds: the other team's average
  const avgDiamonds = (ids: string[]) =>
    Math.round(ids.reduce((sum, id) => sum + (players.get(id)?.diamonds || 0), 0) / Math.max(1, ids.length));
  const enemyDiamonds: Record<number, number> = { 1: avgDiamonds(game.team2 || []), 2: avgDiamonds(game.team1 || []) };

  // A voided game shows +0 for everyone
  const eloChip = (gain: number) => {
    const value = state === 'voided' ? 0 : gain;
    return `\`[${value < 0 ? '−' : '+'}${Math.abs(value)}]\``;
  };

  const playerLine = (id: string, team: number) => {
    const mention = `<@${id}>`;
    const p = players.get(id);
    if (inProgress || !p) return mention;
    const badges = `${scored && (game.mvps || []).includes(id) ? ' 🏆' : ''}${scored && (game.bedbreaks || []).includes(id) ? ' 🛏️' : ''}`;
    const stats = p.hasStats ? ` ${sword} \`${p.kills}/${p.deaths}\` ${diamond} \`${p.diamonds}/${enemyDiamonds[team]}\`` : '';
    return `${mention} ${eloChip(p.eloGain)}${stats}${badges}`;
  };

  const teamField = (team: number, ids: string[]) => ({
    name: `Team ${team} · ${team === 1 ? 'Red' : 'Green'}${winningTeam === team ? ' 🏆' : ''}`,
    value: ids.length ? ids.map(id => playerLine(id, team)).join('\n') : '*None*',
    inline: false,
  });

  const subtitle = [formatMapName(game.map)];
  if (game.queueId) subtitle.push(`<#${game.queueId}>`);
  if (game.seasonNumber) subtitle.push(`Chapter ${game.chapterNumber ?? 1} Season ${game.seasonNumber}`);
  let description = `-# ➡ ${subtitle.join(' · ')}`;
  if (inProgress && game.startTime) description += `\n> Match in progress · started <t:${unix(game.startTime)}:R>`;

  const duration = inProgress && game.startTime
    ? formatElapsed(Date.now() - new Date(game.startTime).getTime())
    : formatGameDuration(game) || 'N/A';

  const embed = themedEmbed(state === 'voided' ? 'error' : 'info')
    .setDescription(description)
    .addFields(
      { name: `${game.isRanked ? '[R] ' : ''}Game`, value: `\`#${game.gameId}\``, inline: true },
      { name: 'Status', value: `\`${STATUS_LABEL[state] || state}\``, inline: true },
      { name: 'Duration', value: `\`${duration}\``, inline: true },
      teamField(1, game.team1 || []),
      teamField(2, game.team2 || []),
    )
    .setFooter({ text: 'Started' });

  if (state === 'voided' && game.reason) {
    embed.addFields({ name: '​', value: `> **Reason** ${game.reason}`, inline: false });
  }
  if (game.startTime) embed.setTimestamp(new Date(game.startTime));
  return embed;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

function buildButtons(game: IGame, guild: Guild | null): ActionRowBuilder<ButtonBuilder> {
  const state = game.state || 'pending';
  const row = new ActionRowBuilder<ButtonBuilder>();
  const threadId = game.channels?.text;
  if (threadId && guild) {
    row.addComponents(new ButtonBuilder().setLabel('Thread').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${threadId}`));
  }
  if (state === 'pending' || state === 'active') {
    // /voidrequest only accepts games that aren't scored or voided yet
    row.addComponents(new ButtonBuilder().setCustomId(`gameinfo:void:${game.gameId}`).setLabel('Request void').setStyle(ButtonStyle.Secondary));
  }
  row.addComponents(new ButtonBuilder().setCustomId('gameinfo:help').setLabel('?').setStyle(ButtonStyle.Secondary));
  return row;
}

export async function gameinfo(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  const gameId = interaction.options.getInteger('game_id', true);
  if (!gameId || isNaN(gameId)) {
    await safeReply(interaction, errorEmbed('Game IDs are numbers, for example `143`.'));
    return;
  }
  const game = await Game.findOne({ gameId });
  if (!game) {
    await safeReply(interaction, errorEmbed(`There's no game \`#${gameId}\`.`));
    return;
  }

  const guild = interaction.guild ?? interaction.client?.guilds?.cache?.first() ?? null;
  const players = await loadPlayers(game);
  const embed = buildEmbed(game, players, guild);

  const image = await buildGameResultImage(game, guild);
  const imageName = `game_${game.gameId}_results.png`;
  if (image) embed.setImage(`attachment://${imageName}`);

  await safeReply(interaction, {
    embeds: [embed],
    components: [buildButtons(game, guild)],
    files: image ? [new AttachmentBuilder(image, { name: imageName })] : [],
  });
}

/** Request void and ? buttons (routed by CommandManager, so they never expire). */
export async function handleGameInfoButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, rawId] = interaction.customId.split(':');

  if (action === 'help') {
    const embed = themedEmbed('info').setDescription(
      '> **Thread** jumps to the game thread\n' +
      '> **Request void** starts a void vote (games in progress only)\n' +
      '-# ➡ Look up any game with `/gameinfo <id>`'
    );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'void') {
    const gameId = parseInt(rawId, 10);
    const modal = new ModalBuilder()
      .setCustomId(`gameinfo:voidmodal:${gameId}`)
      .setTitle(`Request a void · Game #${gameId}`)
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setPlaceholder('Teammate disconnected before beds broke')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(3)
          .setMaxLength(300)
          .setRequired(true)
      ));
    await interaction.showModal(modal);
  }
}

export async function handleGameInfoVoidModal(interaction: ModalSubmitInteraction): Promise<void> {
  const gameId = interaction.customId.split(':')[2];
  const reason = interaction.fields.getTextInputValue('reason').trim();
  await submitVoidRequest(interaction, { gameId, reason, requesterId: interaction.user.id });
}
