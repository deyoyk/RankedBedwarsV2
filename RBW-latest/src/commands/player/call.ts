import { Message, ChatInputCommandInteraction, VoiceChannel, PermissionFlagsBits } from 'discord.js';
import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import Game from '../../models/Game';
import User from '../../models/User';

 


export async function call(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetUser: string;
  let senderId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const targetUserOption = interaction.options.getUser('user', true);
    targetUser = targetUserOption.id;
    senderId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =call <@user>', 'Usage Error'));
      return;
    }
    const userArg = args[0];
    const userMatch = userArg.match(/^<@!?(\d+)>$/) || userArg.match(/^(\d+)$/);
    if (!userMatch) {
      await safeReply(interaction, errorEmbed('Please provide a valid user mention or ID.', 'Usage Error'));
      return;
    }
    targetUser = userMatch[1];
    senderId = interaction.author.id;
  }

  try {
    
    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Error'));
      return;
    }

    const senderMember = await guild.members.fetch(senderId);
    const senderVoiceState = senderMember.voice;

    if (!senderVoiceState.channel) {
      await safeReply(interaction, errorEmbed('You must be in a voice channel to use this command.', '❌ Not in Voice Channel'));
      return;
    }

    const voiceChannel = senderVoiceState.channel as VoiceChannel;

    
    const game = await Game.findOne({
      $or: [
        { 'channels.team1Voice': voiceChannel.id },
        { 'channels.team2Voice': voiceChannel.id },
        { 'channels.picking': voiceChannel.id }
      ]
    });

    if (!game) {
      await safeReply(interaction, errorEmbed('You must be in a game voice channel to use this command.', '❌ Invalid Voice Channel'));
      return;
    }

    
    const targetUserDoc = await User.findOne({ discordId: targetUser });
    if (!targetUserDoc) {
      await safeReply(interaction, errorEmbed('The target user is not registered in the system.', '❌ User Not Found'));
      return;
    }

    
    let targetMember;
    try {
      targetMember = await guild.members.fetch(targetUser);
    } catch (error) {
      await safeReply(interaction, errorEmbed('The target user is not a member of this server.', '❌ User Not Found'));
      return;
    }

    

    try {
      await voiceChannel.permissionOverwrites.create(targetUser, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        Stream: true,
        UseVAD: true
      });

      const embedObj = successEmbed(
        `<@${targetUser}> has been granted access to join and speak in ${voiceChannel.name}.`,
        'Call Access Granted'
      );
      embedObj.builder.addFields(
        { name: 'Voice Channel', value: `<#${voiceChannel.id}>`, inline: true },
        { name: 'Game ID', value: `#${game.gameId}`, inline: true },
        { name: 'Granted by', value: `<@${senderId}>`, inline: true }
      );
      embedObj.builder.setFooter({ text: 'The user can now join and speak in this voice channel.' });
      embedObj.builder.setTimestamp();
      await safeReply(interaction, { embeds: [embedObj.builder] });
    } catch (permError) {
      console.error('Error granting voice channel permissions:', permError);
      await safeReply(interaction, errorEmbed('Failed to grant voice channel permissions. Please try again or check my permissions.', '❌ Permission Error'));
    }

  } catch (error) {
    console.error('Error in call command:', error);
    
    await safeReply(interaction, errorEmbed('An error occurred while processing the call command.', '❌ Error'));
  }
}