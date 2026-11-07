import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, ComponentType, Guild, Message } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { betterEmbed, errorEmbed, successEmbed, themedFrom } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { type PartyDocument, PartyService } from '../../services/PartyService';
import { PrivateGameService } from '../../services/PrivateGameService';

export async function party(interaction: ChatInputCommandInteraction, wsManager?: WebSocketManager) {
  const action = interaction.options.getString('action', true);
  const targetUser = interaction.options.getUser('user') || undefined;
  const partyId = interaction.options.getString('party_id');
  const argsString = interaction.options.getString('args');
  const extraArgs = partyId ? ['join', partyId] : argsString ? argsString.split(/\s+/) : undefined;

  const userId = interaction.user.id;
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
        if (targetUser.id === userId) {
          await safeReply(interaction, errorEmbed('You cannot invite yourself.', 'Party Error'));
          return;
        }
        if (targetUser.bot) {
          await safeReply(interaction, errorEmbed('You cannot invite a bot.', 'Party Error'));
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
        await handlePartySettings(interaction, userId, extraArgs);
        break;
      case 'private':
        await handleStartPrivateGame(interaction, userId, guild, wsManager, extraArgs);
        break;
      case 'cancel':
        await handleCancelPrivateGame(interaction, userId, wsManager);
        break;
      case 'list':
        await handleListParties(interaction);
        break;
      case 'join': {
        const partyIdToJoin = interaction.options.getString('party_id') ?? extraArgs?.[0];
        if (!partyIdToJoin) {
          await safeReply(interaction, errorEmbed(`Usage: /party join <partyId>`, 'Party Usage Error'));
          return;
        }
        await handleJoinParty(interaction, userId, partyIdToJoin, guild);
        break;
      }
      default:
        await safeReply(interaction, errorEmbed('Invalid action! Use: create, invite, leave, info, disband, kick, promote, settings, list, join, private, or cancel', 'Party Error'));
    }
  } catch (error) {
    console.error('Error in party command:', error);
    await safeReply(interaction, errorEmbed('There was an error processing your party command.', 'Party Error'));
  }
}

async function handleCreateParty(interaction: ChatInputCommandInteraction, userId: string) {
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

async function handleInviteToParty(interaction: ChatInputCommandInteraction, userId: string, targetId: string, guild: Guild) {
  const result = await PartyService.inviteToParty(userId, targetId, guild);
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

  const message = (await safeReply(interaction, {
    embeds: [result.embed!],
    components: result.components!,
    fetchReply: true
  })) as unknown as Message | undefined;
  if (!message || typeof message.createMessageComponentCollector !== 'function') return;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === targetId,
    time: PartyService.INVITE_TIMEOUT,
    max: 1
  });

  let resolved = false;
  collector.on('collect', async (buttonInteraction) => {
    const [, partyAction, partyId, targetUserId] = buttonInteraction.customId.split('_');

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
        resolved = true;
        const updatedEmbed = themedFrom(result.embed!)
          .setDescription(`<@${targetUserId}> has joined the party!`)
          .setColor('success');

        await buttonInteraction.update({
          embeds: [updatedEmbed],
          components: []
        });
      } else {
        resolved = true;
        await buttonInteraction.update({
          embeds: [errorEmbed(acceptResult.message!, 'Party Error').builder],
          components: []
        });
      }
    } else if (partyAction === 'decline') {
      resolved = true;
      const declinedEmbed = themedFrom(result.embed!)
        .setDescription(`<@${targetUserId}> declined the invitation.`)
        .setColor('info');
      
      await buttonInteraction.update({ 
        embeds: [declinedEmbed], 
        components: [] 
      });
    }
    
    collector.stop();
  });

  collector.on('end', async () => {
    if (resolved || message.components.length === 0) return;
    const expiredEmbed = errorEmbed('This invitation has expired.', 'Party Invitation Expired');
    await message.edit({
      embeds: [expiredEmbed.builder],
      components: []
    }).catch(() => undefined);
  });
}

function buildPartyEmbed(party: PartyDocument, description: string, color: string, title: string, extraFields?: Array<{ name: string; value: string; inline: boolean }>) {
  const embedObj = betterEmbed(description, color, title);
  const fields = [
    { name: 'Party ID', value: party.partyId, inline: true },
    { name: 'Leader', value: `<@${party.leader}>`, inline: true },
    { name: 'Members', value: party.members.map((id: string) => `<@${id}>`).join(', ') || 'None', inline: false },
    ...(extraFields || [])
  ];
  embedObj.builder.addFields(...fields).setTimestamp();
  return embedObj;
}

async function handlePartyAction(
  interaction: ChatInputCommandInteraction,
  serviceCall: Promise<{ success: boolean; message?: string; party?: PartyDocument }>,
  embedConfig: { description: string; color: string; title: string; extraFields?: Array<{ name: string; value: string; inline: boolean }> }
) {
  const result = await serviceCall;
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }
  const embedObj = buildPartyEmbed(result.party!, embedConfig.description, embedConfig.color, embedConfig.title, embedConfig.extraFields);
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handleLeaveParty(interaction: ChatInputCommandInteraction, userId: string, guild: Guild) {
  await handlePartyAction(
    interaction,
    PartyService.leaveParty(userId, guild),
    { description: `<@${userId}> has left the party.`, color: '#ff9900', title: 'Left Party' }
  );
}

async function handlePartyInfo(interaction: ChatInputCommandInteraction, userId: string) {
  const result = await PartyService.getPartyInfo(userId);
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }
  const party = result.party!;
  const embedObj = betterEmbed(`Party information for <@${party.leader}>.`, 'info', 'Party Information');
  embedObj.builder.addFields(
    { name: 'Party ID', value: party.partyId, inline: true },
    { name: 'Leader', value: `<@${party.leader}>`, inline: true },
    { name: 'Members', value: party.members.map((id: string) => `<@${id}>`).join('\n'), inline: false },
    { name: 'Max Members', value: party.maxMembers.toString(), inline: true },
    { name: 'Private', value: party.isPrivate ? 'Yes' : 'No', inline: true },
    { name: 'Description', value: party.description || 'No description', inline: false }
  );
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handleDisbandParty(interaction: ChatInputCommandInteraction, userId: string, guild: Guild) {
  await handlePartyAction(
    interaction,
    PartyService.disbandParty(userId, guild),
    { description: 'The party has been disbanded.', color: '#ff0000', title: 'Party Disbanded', extraFields: [
      { name: 'Former Leader', value: `<@${userId}>`, inline: true }
    ]}
  );
}

async function handleKickFromParty(interaction: ChatInputCommandInteraction, userId: string, targetId: string, guild: Guild) {
  await handlePartyAction(
    interaction,
    PartyService.kickFromParty(userId, targetId, guild),
    { description: `<@${targetId}> has been kicked from the party.`, color: '#ff0000', title: 'Party Member Kicked' }
  );
}

async function handlePromoteToLeader(interaction: ChatInputCommandInteraction, userId: string, targetId: string) {
  await handlePartyAction(
    interaction,
    PartyService.promoteToLeader(userId, targetId),
    { description: `<@${targetId}> is now the party leader!`, color: '#00ff00', title: 'New Party Leader', extraFields: [
      { name: 'Former Leader', value: `<@${userId}>`, inline: true }
    ]}
  );
}

async function handlePartySettings(interaction: ChatInputCommandInteraction, userId: string, args?: string[]) {
  if (!args || args.length === 0) {
    const result = await PartyService.getPartyInfo(userId);
    
    if (!result.success) {
      await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
      return;
    }

    const party = result.party!;
    const embedObj = betterEmbed(`Party settings for <@${party.leader}>.`, 'info', 'Party Settings');
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

async function handleListParties(interaction: ChatInputCommandInteraction) {
  const result = await PartyService.listPublicParties();
  
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }

  if (!result.parties || result.parties.length === 0) {
    await safeReply(interaction, errorEmbed('There are no public parties at the moment.', 'No Public Parties'));
    return;
  }

  const embedObj = betterEmbed('List of all public parties:', 'info', 'Public Parties');
  
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

async function handleJoinParty(interaction: ChatInputCommandInteraction, userId: string, partyId: string, guild: Guild) {
  const result = await PartyService.joinParty(userId, partyId, guild);
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message!, 'Party Error'));
    return;
  }
  const embedObj = buildPartyEmbed(
    result.party!, 'You have successfully joined the party!', '#00ff00', 'Joined Party',
    [{ name: 'Members', value: result.party!.members.map((id: string) => `<@${id}>`).join(', '), inline: false }]
  );
  await safeReply(interaction, { embeds: [embedObj.builder] });
}

async function handleStartPrivateGame(
  interaction: ChatInputCommandInteraction,
  userId: string,
  guild: Guild,
  wsManager?: WebSocketManager,
  args?: string[],
) {
  if (!wsManager) {
    await safeReply(interaction, errorEmbed('The game service is not ready yet. Please try again shortly.', 'Private Game Error'));
    return;
  }

  const validation = await PartyService.validatePartyAccess(userId, true);
  if (!validation.isValid || !validation.party) {
    await safeReply(interaction, errorEmbed(validation.error || 'Not in a party', 'Private Game Error'));
    return;
  }

  const party = validation.party;
  const map = args?.length ? args.join(' ').trim() : '';
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const confirmId = `private_confirm_${userId}_${nonce}`;
  const cancelId = `private_cancel_${userId}_${nonce}`;

  const confirmEmbed = betterEmbed('Review the private game details below. Only the party leader can confirm this game.', 'warning', 'Confirm Private Game');
  confirmEmbed.builder.addFields(
    { name: 'Party ID', value: party.partyId, inline: true },
    { name: 'Leader', value: `<@${party.leader}>`, inline: true },
    { name: 'Members', value: party.members.map((id: string) => `<@${id}>`).join('\n'), inline: false },
    { name: 'Map', value: map || 'Random eligible map', inline: true },
    { name: 'Mode', value: 'Unranked private game', inline: true },
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  const message = await safeReply(interaction, {
    embeds: [confirmEmbed.builder],
    components: [row],
  });
  if (!message) return;

  let resolved = false;
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 2 * 60 * 1000,
  });

  collector.on('collect', async (buttonInteraction) => {
    if (buttonInteraction.user.id !== userId) {
      await buttonInteraction.reply({
        embeds: [errorEmbed('Only the party leader can confirm this game.', 'Private Game Error').builder],
        ephemeral: true,
      }).catch(() => undefined);
      return;
    }

    if (resolved) return;

    if (buttonInteraction.customId === cancelId) {
      resolved = true;
      collector.stop('cancelled');
      await buttonInteraction.update({
        embeds: [errorEmbed('Private game creation cancelled.', 'Private Game Cancelled').builder],
        components: [],
      }).catch(() => undefined);
      return;
    }

    if (buttonInteraction.customId !== confirmId) return;
    resolved = true;

    const startingEmbed = betterEmbed('Validating your party and creating the game...', '#00AAAA', 'Starting Private Game');
    startingEmbed.builder.setTimestamp();
    await buttonInteraction.update({
      embeds: [startingEmbed.builder],
      components: [],
    }).catch(() => undefined);

    let result: Awaited<ReturnType<typeof PrivateGameService.startPrivateGame>>;
    try {
      result = await PrivateGameService.startPrivateGame(userId, guild, wsManager, {
        ...(map ? { map } : {}),
      });
    } catch (error) {
      console.error('Error starting private game:', error);
      await buttonInteraction.editReply({
        embeds: [errorEmbed('There was an error starting the private game.', 'Private Game Error').builder],
      }).catch(() => undefined);
      return;
    }

    if (!result.success) {
      await buttonInteraction.editReply({
        embeds: [errorEmbed(result.message || 'Could not create the private game.', 'Private Game Error').builder],
      }).catch(() => undefined);
      return;
    }

    const successEmbedObj = successEmbed(
      `Private game #${result.gameId} has been created and is starting now.`,
      'Private Game Started',
    );
    successEmbedObj.builder.addFields(
      { name: 'Game ID', value: `#${result.gameId}`, inline: true },
      { name: 'Map', value: result.map || 'Unknown', inline: true },
      {
        name: 'Team 1',
        value: (result.team1 || []).map((id: string) => `<@${id}>`).join(', '),
        inline: false,
      },
      {
        name: 'Team 2',
        value: (result.team2 || []).map((id: string) => `<@${id}>`).join(', '),
        inline: false,
      },
    ).setTimestamp();

    await buttonInteraction.editReply({
      content: [...(result.team1 || []), ...(result.team2 || [])].map((id: string) => `<@${id}>`).join(' '),
      embeds: [successEmbedObj.builder],
    }).catch(() => undefined);
    collector.stop('started');
  });

  collector.on('end', async (_collected, reason) => {
    if (resolved || reason === 'cancelled' || reason === 'started') return;
    await message.edit({
      embeds: [errorEmbed('This private game confirmation has expired.', 'Confirmation Expired').builder],
      components: [],
    }).catch(() => undefined);
  });
}

async function handleCancelPrivateGame(
  interaction: ChatInputCommandInteraction,
  userId: string,
  wsManager?: WebSocketManager,
) {
  if (!wsManager) {
    await safeReply(interaction, errorEmbed('The game service is not ready yet. Please try again shortly.', 'Private Game Error'));
    return;
  }

  const result = await PrivateGameService.cancelPrivateGame(userId, wsManager);
  if (!result.success) {
    await safeReply(interaction, errorEmbed(result.message || 'Could not cancel the private game.', 'Private Game Error'));
    return;
  }

  const embedObj = successEmbed(`Private game #${result.gameId} has been cancelled.`, 'Private Game Cancelled');
  embedObj.builder.addFields({ name: 'Game ID', value: `#${result.gameId}`, inline: true }).setTimestamp();
  await safeReply(interaction, { embeds: [embedObj.builder] });
}
