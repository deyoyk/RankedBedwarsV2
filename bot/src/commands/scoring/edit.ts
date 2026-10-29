import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import UserModel, { type IUser } from '../../models/User';


const EDITABLE_STATS = {
  'elo': 'number',
  'wins': 'number',
  'losses': 'number',
  'games': 'number',
  'mvps': 'number',
  'kills': 'number',
  'deaths': 'number',
  'bedBroken': 'number',
  'finalKills': 'number',
  'diamonds': 'number',
  'irons': 'number',
  'gold': 'number',
  'emeralds': 'number',
  'blocksPlaced': 'number',
  'winStreak': 'number',
  'loseStreak': 'number',
  'kdr': 'number',
  'wlr': 'number',
} as const;

type EditableStat = keyof typeof EDITABLE_STATS;

export async function edit(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  let targetUserId: string;
  let statToEdit: string;
  let newValue: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const targetUser = interaction.options.getUser('user', true);
    targetUserId = targetUser.id;
    statToEdit = interaction.options.getString('stat', true);
    newValue = interaction.options.getString('value', true);
  } else {
    if (!args || args.length !== 3) {
      const availableStats = Object.keys(EDITABLE_STATS).join(', ');
      await safeReply(interaction, errorEmbed(
        `Usage: =edit <@user> <stat> <value>\n\nAvailable stats:\n${availableStats}`, 
        'Edit Command Usage Error'
      ));
      return;
    }
    
    
    const userArg = args[0];
    const userIdMatch = userArg.match(/^<@!?(\d+)>$/) || userArg.match(/^(\d+)$/);
    if (!userIdMatch) {
      await safeReply(interaction, errorEmbed('Please provide a valid user mention or ID.', 'Edit Command Error'));
      return;
    }
    targetUserId = userIdMatch[1];
    statToEdit = args[1];
    newValue = args[2];
  }

  
  if (!(statToEdit in EDITABLE_STATS)) {
    const availableStats = Object.keys(EDITABLE_STATS).join(', ');
    await safeReply(interaction, errorEmbed(
      `Invalid stat "${statToEdit}". Available stats:\n${availableStats}`, 
      'Edit Command Error'
    ));
    return;
  }

  try {
    const foundUser: unknown = UserModel.findOne({ discordId: targetUserId });
    const user = typeof (foundUser as { lean?: unknown }).lean === 'function'
      ? await (foundUser as { lean: () => Promise<IUser | null> }).lean()
      : await (foundUser as Promise<IUser | null>);
    if (!user) {
      await safeReply(interaction, errorEmbed('User not found in the database. They need to register first.', 'Edit Command Error'));
      return;
    }

    
    const statType = EDITABLE_STATS[statToEdit as EditableStat];
    let convertedValue: string | number;

    if (statType === 'number') {
      const numValue = parseFloat(newValue);
      if (!Number.isFinite(numValue) || numValue < 0) {
        await safeReply(interaction, errorEmbed(`"${newValue}" is not a valid non-negative number for stat "${statToEdit}".`, 'Edit Command Error'));
        return;
      }
      convertedValue = numValue;
    } else {
      convertedValue = newValue;
    }

    
    const stat = statToEdit as EditableStat;
    const oldValue: number = (user[stat] as number | undefined) ?? 0;

    if (typeof convertedValue !== 'number') {
      await safeReply(interaction, errorEmbed(`"${newValue}" is not a valid non-negative number for stat "${statToEdit}".`, 'Edit Command Error'));
      return;
    }

    const set: Record<string, number> = { [stat]: convertedValue };
    const kills = statToEdit === 'kills' ? convertedValue : (user.kills ?? 0);
    const deaths = statToEdit === 'deaths' ? convertedValue : (user.deaths ?? 0);
    const wins = statToEdit === 'wins' ? convertedValue : (user.wins ?? 0);
    const losses = statToEdit === 'losses' ? convertedValue : (user.losses ?? 0);

    let updatedKdr: number | undefined;
    let updatedWlr: number | undefined;
    if (statToEdit === 'kills' || statToEdit === 'deaths') {
      updatedKdr = deaths > 0 ? parseFloat((kills / deaths).toFixed(2)) : kills;
      set.kdr = updatedKdr;
    }
    if (statToEdit === 'wins' || statToEdit === 'losses') {
      updatedWlr = losses > 0 ? parseFloat((wins / losses).toFixed(2)) : wins;
      set.wlr = updatedWlr;
    }

    const updated = await UserModel.findOneAndUpdate(
      { discordId: targetUserId },
      { $set: set },
      { new: true }
    );
    if (!updated) {
      await safeReply(interaction, errorEmbed('User not found in the database. They need to register first.', 'Edit Command Error'));
      return;
    }

    
    const embed = successEmbed('User stat updated successfully!', 'Stat Edited');
    embed.builder.addFields(
      { name: 'Target User', value: `<@${targetUserId}>`, inline: true },
      { name: 'Stat', value: statToEdit, inline: true },
      { name: 'Old Value', value: String(oldValue || 0), inline: true },
      { name: 'New Value', value: String(convertedValue), inline: true },
      { name: 'Editor', value: interaction instanceof ChatInputCommandInteraction ? `<@${interaction.user.id}>` : `<@${interaction.author.id}>`, inline: true }
    );

    
    if (statToEdit === 'kills' || statToEdit === 'deaths') {
      embed.builder.addFields({ name: 'Updated KDR', value: String(updatedKdr), inline: true });
    }
    if (statToEdit === 'wins' || statToEdit === 'losses') {
      embed.builder.addFields(
        { name: 'Updated WLR', value: String(updatedWlr), inline: true },
        { name: 'Updated Games', value: String(updated.games), inline: true }
      );
    }

    embed.builder.setTimestamp();
    await safeReply(interaction, embed);

  } catch (error) {
    console.error('Error in edit command:', error);
    await safeReply(interaction, errorEmbed('There was an error updating the user stat.', 'Edit Command Error'));
  }
}