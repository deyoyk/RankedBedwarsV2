import { Message, ChatInputCommandInteraction } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import UserModel from '../../models/User';


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
  'winstreak': 'number',
  'losestreak': 'number',
  'kdr': 'number',
  'wlr': 'number',
} as const;

type EditableStat = keyof typeof EDITABLE_STATS;

export async function edit(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
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
    
    const user = await UserModel.findOne({ discordId: targetUserId });
    if (!user) {
      await safeReply(interaction, errorEmbed('User not found in the database. They need to register first.', 'Edit Command Error'));
      return;
    }

    
    const statType = EDITABLE_STATS[statToEdit as EditableStat];
    let convertedValue: string | number;

    if (statType === 'number') {
      const numValue = parseFloat(newValue);
      if (isNaN(numValue)) {
        await safeReply(interaction, errorEmbed(`"${newValue}" is not a valid number for stat "${statToEdit}".`, 'Edit Command Error'));
        return;
      }
      convertedValue = numValue;
    } else {
      convertedValue = newValue;
    }

    
    const oldValue = (user as any)[statToEdit];

    
    (user as any)[statToEdit] = convertedValue;

    
    if (statToEdit === 'kills' || statToEdit === 'deaths') {
      user.kdr = user.deaths > 0 ? parseFloat((user.kills / user.deaths).toFixed(2)) : user.kills;
    }
    if (statToEdit === 'wins' || statToEdit === 'losses') {
      user.wlr = user.losses > 0 ? parseFloat((user.wins / user.losses).toFixed(2)) : user.wins;
    }
    if (statToEdit === 'wins' || statToEdit === 'losses') {
      user.games = user.wins + user.losses;
    }

    await user.save();

    
    const embed = successEmbed('User stat updated successfully!', 'Stat Edited');
    embed.builder.addFields(
      { name: 'Target User', value: `<@${targetUserId}>`, inline: true },
      { name: 'Stat', value: statToEdit, inline: true },
      { name: 'Old Value', value: String(oldValue || 0), inline: true },
      { name: 'New Value', value: String(convertedValue), inline: true },
      { name: 'Editor', value: interaction instanceof ChatInputCommandInteraction ? `<@${interaction.user.id}>` : `<@${interaction.author.id}>`, inline: true }
    );

    
    if (statToEdit === 'kills' || statToEdit === 'deaths') {
      embed.builder.addFields({ name: 'Updated KDR', value: String(user.kdr), inline: true });
    }
    if (statToEdit === 'wins' || statToEdit === 'losses') {
      embed.builder.addFields(
        { name: 'Updated WLR', value: String(user.wlr), inline: true },
        { name: 'Updated Games', value: String(user.games), inline: true }
      );
    }

    embed.builder.setTimestamp();
    await safeReply(interaction, embed);

  } catch (error) {
    console.error('Error in edit command:', error);
    await safeReply(interaction, errorEmbed('There was an error updating the user stat.', 'Edit Command Error'));
  }
}