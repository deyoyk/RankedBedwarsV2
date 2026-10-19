import { Message, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import config from '../../config/config';
import { fix } from '../../utils/fix';
import { WebSocketManager } from '../../websocket/WebSocketManager';

 


export async function register(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  let ign: string;
  let discordId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    ign = interaction.options.getString('ign', true);
    discordId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =register <ign>', 'Register Usage Error'));
      return;
    }
    ign = args[0];
    discordId = interaction.author.id;
  }

  
  try {
    if (!wsManager) throw new Error('WebSocketManager instance required for register.');
    
    const ignTaken = await User.findOne({ ign: { $regex: `^${ign}$`, $options: 'i' } });
    if (ignTaken) {
      await safeReply(interaction, errorEmbed('This IGN is already registered to another user.', 'Register Error'));
      return;
    }
    const playerStatus = await wsManager.checkPlayerOnline(ign);
    if (!playerStatus.online) {
      await safeReply(interaction, errorEmbed('Please get online on the server.', 'Register Error'));
      return;
    }
    if (playerStatus.original_ign_case && playerStatus.original_ign_case !== ign) {
      console.warn(`IGN case mismatch: playerData.originalign='${playerStatus.original_ign_case}', provided ign='${ign}'`);
      await safeReply(interaction, errorEmbed('Your IGN case did not match. Make sure all the capitals are matching.', 'Register Error'));
      return;
    }
    const code = Math.floor(1000 + Math.random() * 9000).toString(); 
    wsManager.send({
      type: 'verification',
      ign,
      code
    });
    const embedObj = betterEmbed(`IGN: **${ign}**\nClick the button below to complete registration.`, '#00ff99', 'Registration');
    const button = new ButtonBuilder()
      .setCustomId('register_button')
      .setLabel('Complete Registration')
      .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
    const sentMessage: any = await safeReply(interaction, { embeds: [embedObj.builder], components: [row], fetchReply: true }); 
    const filter = (i: any) => i.customId === 'register_button' && i.user.id === discordId;
    const collector = interaction.channel?.createMessageComponentCollector({ filter, time: 60000, max: 1 });
    collector?.on('collect', async (btnInt: any) => {
      const modal = new ModalBuilder()
        .setCustomId('register_modal')
        .setTitle('Enter Registration Code')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('reg_code')
              .setLabel('Paste your 4-digit code')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      await btnInt.showModal(modal);
      const filter = (i: any) => i.customId === 'register_modal';
      const modalInt = await btnInt.awaitModalSubmit({ filter, time: 60000 }).catch(() => null);
      if (!modalInt) return;
      const inputCode = modalInt.fields.getTextInputValue('reg_code');
      if (inputCode === code) {
        
        const existingUser = await User.findOne({ discordId });
        if (existingUser) {
          try {
            await sentMessage.edit({
              embeds: [errorEmbed('You are already registered.', 'Register Error').builder],
              components: []
            });
          } catch (e) {
            console.error('Failed to edit original registration message (already registered):', e);
          }
          await modalInt.reply({ content: 'You are already registered.', ephemeral: true });
          return;
        }
        const ignTakenAgain = await User.findOne({ ign: { $regex: `^${ign}$`, $options: 'i' } });
        if (ignTakenAgain) {
          try {
            await sentMessage.edit({
              embeds: [errorEmbed('This IGN is already registered to another user.', 'Register Error').builder],
              components: []
            });
          } catch (e) {
            console.error('Failed to edit original registration message (IGN taken after):', e);
          }
          await modalInt.reply({ content: 'IGN already registered to another user.', ephemeral: true });
          return;
        }
        const user = await User.create({ discordId, ign });
        

        
        try {
          if (interaction.guild) {
            await fix(interaction.guild, discordId);
          }
          
          try {
            await sentMessage.edit({
              embeds: [successEmbed('Registration successful! Your nickname and roles have been set up.', 'Registration Complete').builder],
              components: []
            });
          } catch (e) {
            console.error('Failed to edit original registration message (success):', e);
          }
          await modalInt.reply({ content: 'Registration complete.', ephemeral: true });
        } catch (fixError) {
          console.error('Error updating nickname/roles:', fixError);
          try {
            await sentMessage.edit({
              embeds: [
                errorEmbed(
                  'Registration successful, but there was an issue updating your nickname/roles. An administrator can help fix this.',
                  'Registration Complete'
                ).builder
              ],
              components: []
            });
          } catch (e) {
            console.error('Failed to edit original registration message (fix error):', e);
          }
          await modalInt.reply({ content: 'Registered, but there was a roles/nickname issue.', ephemeral: true });
        }
      } else {
        try {
          await sentMessage.edit({
            embeds: [errorEmbed('Invalid code. Please try again.', 'Register Error').builder],
            components: []
          });
        } catch (e) {
          console.error('Failed to edit original registration message (invalid code):', e);
        }
        await modalInt.reply({ content: 'Invalid code.', ephemeral: true });
      }
    });
  } catch (error) {
    console.error('Error during API registration:', error);
    await safeReply(interaction, errorEmbed('An error occurred during registration. Please try again later.', 'Register Error'));
  }
}