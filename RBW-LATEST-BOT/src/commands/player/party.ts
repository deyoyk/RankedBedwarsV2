import { Message, ChatInputCommandInteraction, EmbedBuilder, User as DiscordUser, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { PartyService } from '../../services/PartyService';
import UserModel from '../../models/User';

export async function party(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let action: string;
  let targetUser: DiscordUser | undefined;

  if (interaction instanceof ChatInputCommandInteraction) {
    action = interaction.options.getString('action', true);
    const targetUserId = interaction.options.getUser('user')?.id;
    if (targetUserId) {
      const foundUser = await UserModel.findOne({ discordId: targetUserId });
      if (foundUser) {
        targetUser = interaction.client.users.cache.get(foundUser.discordId);
      }
    }
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =party <action> [user]', 'Party Usage Error'));
      return;
    }
    action = args[0];
    if (args[1]) {
      const foundUser = await UserModel.findOne({ discordId: args[1] });
      if (foundUser) {
        targetUser = interaction.client.users.cache.get(foundUser.discordId);
      }
    }
  }

  const userId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
  const guild = interaction.guild;

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Party Error'));
    return;
  }

  try {
    switch (action.toLowerCase()) {
      case 'create':
        await handleCreateParty(interaction, userId);
        break;
      case 'invite':
        if (!targetUser) {
          await safeReply(interaction, errorEmbed('Please specify a user to invite!', 'Party Error'));
          return;
        }
        await handleInviteToParty(interaction, userId, targetUser.id, guild);
        break;
      case 'leave':
        await handleLeaveParty(interaction, userId, guild);
        break;
      case 'info':
        await handlePartyInfo(interaction, userId);
        break;
      case 'disband':
        await handleDisbandParty(interaction, userId, guild);
        break;
      case 'kick':
        if (!targetUser) {
          await safeReply(interaction, errorEmbed('Please specify a user to kick!', 'Party Error'));
          return;
        }
        await handleKickFromParty(interaction, userId, targetUser.id, guild);
        break;
      case 'promote':
        if (!targetUser) {
          await safeReply(interaction, errorEmbed('Please specify a user to promote!', 'Party Error'));
          return;
        }
        await handlePromoteToLeader(interaction, userId, targetUser.id);
        break;
      case 'settings':
        await handlePartySettings(interaction, userId, args?.slice(1));
        break;
      case 'list':
        await handleListParties(interaction);
        break;
      case 'join':
        if (!args || args.length < 2) {
          await safeReply(interaction, errorEmbed('Usage: =party join <partyId>', 'Party Usage Error'));
          return;
        }
        await handleJoinParty(interaction, userId, args[1], guild);
        break;
      default:
        await safeReply(interaction, errorEmbed('Invalid action! Use: create, invite, leave, info, disband, kick, promote, settings, list, or join', 'Party Error'));
    }
  } catch (error) {
    console.error('Error in party command:', error);
    await safeReply(interaction, errorEmbed('There was an error processing your party command.', 'Party Error'));
  }
}

async function handleCreateParty(interaction: Message | ChatInputCommandInteraction, userId: string) {
  const result = await PartyService.createParty(userId);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.error!, 'Party Error'));
    return;
  }

  const embedObj = successEmbed('Your party has been created successfully!', 'Party Created');
  embedObj.builder.addFields(
    { name: 'Party ID', value: result.party!.partyId, inline: true },
    { name: 'Leader', value: `<@${userId}>`, inline: true },
    { name: 'Members', value: `<@${userId}>`, inline: true },
    { name: 'Max Members', value: result.party!.maxMembers.toString(), inline: true }
  ).setTimestamp();
  
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handleInviteToParty(interaction: Message | ChatInputCommandInteraction, userId: string, targetId: string, guild: any) {
  const result = await PartyService.inviteToParty(userId, targetId, guild);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

  const message = await interaction.reply({ 
    embeds: [result.embed!], 
    components: result.components!, 
    fetchReply: true 
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000
  });

  collector.on('collect', async (buttonInteraction) => {
    const [action, partyAction, partyId, targetUserId] = buttonInteraction.customId.split('_');
    
    if (buttonInteraction.user.id !== targetUserId) {
      await buttonInteraction.reply({ 
        embeds: [errorEmbed('This invitation is not for you!', 'Party Error').builder], 
        ephemeral: true 
      });
      return;
    }

    if (partyAction === 'accept') {
      const acceptResult = await PartyService.acceptInvite(partyId, targetUserId, guild);
      
      if (acceptResult.success) {
        const updatedEmbed = EmbedBuilder.from(result.embed!)
          .setDescription(`<@${targetUserId}> has joined the party!`)
          .setColor('#00ff00');
        
        await buttonInteraction.update({ 
          embeds: [updatedEmbed], 
          components: [] 
        });
      } else {
        await buttonInteraction.reply({ 
          embeds: [errorEmbed(acceptResult.message!, 'Party Error').builder], 
          ephemeral: true 
        });
      }
    } else if (partyAction === 'decline') {
      const declinedEmbed = EmbedBuilder.from(result.embed!)
        .setDescription(`<@${targetUserId}> declined the invitation.`)
        .setColor('#00AAAA');
      
      await buttonInteraction.update({ 
        embeds: [declinedEmbed], 
        components: [] 
      });
    }
    
    collector.stop();
  });

  collector.on('end', async () => {
    if (message.components.length > 0) {
      const expiredEmbed = errorEmbed('This invitation has expired.', 'Party Invitation Expired');
      await message.edit({ 
        embeds: [expiredEmbed.builder], 
        components: [] 
      });
    }
  });
}

async function handleLeaveParty(interaction: Message | ChatInputCommandInteraction, userId: string, guild: any) {
  const result = await PartyService.leaveParty(userId, guild);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

      const embedObj = betterEmbed(`<@${userId}> has left the party.`, '#ff9900', 'Left Party');
    embedObj.builder.addFields(
      { name: 'Party ID', value: result.party!.partyId, inline: true },
      { name: 'Leader', value: `<@${result.party!.leader}>`, inline: true },
      { name: 'Remaining Members', value: result.party!.members.map((id: string) => `<@${id}>`).join(', '), inline: false }
    ).setTimestamp();
  
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handlePartyInfo(interaction: Message | ChatInputCommandInteraction, userId: string) {
  const result = await PartyService.getPartyInfo(userId);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

  const party = result.party!;
      const embedObj = betterEmbed('', '#00AAAA', 'Party Information');
    embedObj.builder.addFields(
      { name: 'Party ID', value: party.partyId, inline: true },
      { name: 'Leader', value: `<@${party.leader}>`, inline: true },
      { name: 'Members', value: party.members.map((id: string) => `<@${id}>`).join('\n'), inline: false },
      { name: 'Max Members', value: party.maxMembers.toString(), inline: true },
      { name: 'Private', value: party.isPrivate ? 'Yes' : 'No', inline: true },
      { name: 'Description', value: party.description || 'No description', inline: false }
    ).setTimestamp();
  
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handleDisbandParty(interaction: Message | ChatInputCommandInteraction, userId: string, guild: any) {
  const result = await PartyService.disbandParty(userId, guild);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

      const embedObj = errorEmbed('The party has been disbanded.', 'Party Disbanded');
    embedObj.builder.addFields(
      { name: 'Party ID', value: result.party!.partyId, inline: true },
      { name: 'Former Leader', value: `<@${userId}>`, inline: true },
      { name: 'Former Members', value: result.party!.members.map((id: string) => `<@${id}>`).join(', '), inline: false }
    ).setTimestamp();
  
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handleKickFromParty(interaction: Message | ChatInputCommandInteraction, userId: string, targetId: string, guild: any) {
  const result = await PartyService.kickFromParty(userId, targetId, guild);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

      const embedObj = errorEmbed(`<@${targetId}> has been kicked from the party.`, 'Party Member Kicked');
    embedObj.builder.addFields(
      { name: 'Party ID', value: result.party!.partyId, inline: true },
      { name: 'Leader', value: `<@${result.party!.leader}>`, inline: true },
      { name: 'Remaining Members', value: result.party!.members.map((id: string) => `<@${id}>`).join(', '), inline: false }
    ).setTimestamp();
  
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handlePromoteToLeader(interaction: Message | ChatInputCommandInteraction, userId: string, targetId: string) {
  const result = await PartyService.promoteToLeader(userId, targetId);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

      const embedObj = successEmbed(`<@${targetId}> is now the party leader!`, 'New Party Leader');
    embedObj.builder.addFields(
      { name: 'Party ID', value: result.party!.partyId, inline: true },
      { name: 'Former Leader', value: `<@${userId}>`, inline: true },
      { name: 'Members', value: result.party!.members.map((id: string) => `<@${id}>`).join(', '), inline: false }
    ).setTimestamp();
  
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handlePartySettings(interaction: Message | ChatInputCommandInteraction, userId: string, args?: string[]) {
  if (!args || args.length === 0) {
    const result = await PartyService.getPartyInfo(userId);
    
    if (!result.success) {
      await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
      return;
    }

    const party = result.party!;
    const embedObj = betterEmbed('', '#00AAAA', 'Party Settings');
    embedObj.builder.addFields(
      { name: 'Max Members', value: party.maxMembers.toString(), inline: true },
      { name: 'Private', value: party.isPrivate ? 'Yes' : 'No', inline: true },
      { name: 'Description', value: party.description || 'No description set', inline: false }
    ).setTimestamp();
    
    await safeReply(interaction, { embeds: [embedObj.builder] });
    return;
  }

  const [setting, ...values] = args;
  const value = values.join(' ');

  const result = await PartyService.updatePartySettings(userId, setting, value);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

  const embedObj = successEmbed('Party settings updated.', 'Party Settings Updated');
  embedObj.builder.addFields(
    { name: 'Setting Changed', value: setting, inline: true },
    { name: 'New Value', value: value, inline: true }
  ).setTimestamp();
  
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handleListParties(interaction: Message | ChatInputCommandInteraction) {
  const result = await PartyService.listPublicParties();
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

  if (!result.parties || result.parties.length === 0) {
    await safeReply(interaction, errorEmbed('There are no public parties at the moment.', 'No Public Parties'));
    return;
  }

  const embedObj = betterEmbed('List of all public parties:', '#00AAAA', 'Public Parties');
  
  for (const party of result.parties) {
    embedObj.builder.addFields({
      name: `Party ID: ${party.partyId}`,
      value: `Leader: <@${party.leader}>\nMembers: ${party.members.length}/${party.maxMembers}\nDescription: ${party.description || 'No description'}`,
      inline: false
    });
  }
  
  embedObj.builder.setTimestamp();
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handleJoinParty(interaction: Message | ChatInputCommandInteraction, userId: string, partyId: string, guild: any) {
  const result = await PartyService.joinParty(userId, partyId, guild);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

      const embedObj = successEmbed('You have successfully joined the party!', 'Joined Party');
    embedObj.builder.addFields(
      { name: 'Party ID', value: result.party!.partyId, inline: true },
      { name: 'Leader', value: `<@${result.party!.leader}>`, inline: true },
      { name: 'Members', value: result.party!.members.map((id: string) => `<@${id}>`).join(', '), inline: false }
    ).setTimestamp();
  
  await safeReply(interaction, { embeds: [embedObj.builder] });
}