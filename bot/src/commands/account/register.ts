import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ComponentType, Message, MessageFlags, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from 'discord.js';
import { embedsFor } from '../../utils/betterembed';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import { fix } from '../../utils/fix';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import config from '../../config/config';
import { recordAudit } from '../../services/AuditService';

const { betterEmbed, errorEmbed, successEmbed } = embedsFor('Player');

function isUnknownInteractionCode(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === 10062 || code === 40060;
}

async function respondToModal(
  modalInt: ModalSubmitInteraction,
  payload: ReturnType<typeof errorEmbed>
): Promise<void> {
  const { embeds } = payload;
  try {
    await modalInt.editReply({ embeds });
  } catch (error) {
    if (!isUnknownInteractionCode(error)) {
      console.error('[register] Failed to respond to registration modal:', error);
    }
  }
}

export async function register(interaction: ChatInputCommandInteraction, wsManager?: WebSocketManager) {
  let ign: string;
  let discordId: string;

  
    ign = interaction.options.getString('ign', true);
    discordId = interaction.user.id;
  

  
  try {
    if (!wsManager) throw new Error('WebSocketManager instance required for register.');
    
    const ignTaken = await User.findOne({ ign }).collation({ locale: 'en', strength: 2 }).select('_id').lean();
    if (ignTaken) {
      await safeReply(interaction, errorEmbed('This IGN is already registered to another user.', 'Register Error'));
      return;
    }
    const playerStatus = await wsManager.checkPlayerOnline(ign);
    if (!playerStatus.online) {
      await safeReply(interaction, errorEmbed(`Please get online on \`${config.serverip}\` before registering.`, 'Register Error'));
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
    const sentMessage = await safeReply(interaction, { embeds: [embedObj.builder], components: [row], fetchReply: true });
    const replyMsg = sentMessage as unknown as Message;
    const filter = (i: ButtonInteraction) => i.customId === 'register_button' && i.user.id === discordId;
    const collector = replyMsg?.createMessageComponentCollector({ componentType: ComponentType.Button, filter, time: 60000, max: 1 });
    collector?.on('end', async () => {
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('register_button').setLabel('Complete Registration').setStyle(ButtonStyle.Primary).setDisabled(true)
      );
      await replyMsg?.edit({ components: [disabledRow] }).catch(() => undefined);
    });
    collector?.on('collect', async (btnInt: ButtonInteraction) => {
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
      const filter = (i: ModalSubmitInteraction) => i.customId === 'register_modal';
      const modalInt = await btnInt.awaitModalSubmit({ filter, time: 60000 }).catch(() => null);
      if (!modalInt) return;
      try {
        await modalInt.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (error) {
        console.warn('[register] Registration modal could not be acknowledged:', error);
        return;
      }
      const inputCode = modalInt.fields.getTextInputValue('reg_code');
      if (inputCode === code) {
        
        const existingUser = await User.findOne({ discordId }).select('_id').lean();
        if (existingUser) {
          try {
            await (sentMessage as Message).edit({
              embeds: [errorEmbed('You are already registered.', 'Register Error').builder],
              components: []
            });
          } catch (e) {
            console.error('Failed to edit original registration message (already registered):', e);
          }
          await respondToModal(modalInt, errorEmbed('You are already registered.', 'Registration Error'));
          return;
        }
        const ignTakenAgain = await User.findOne({ ign }).collation({ locale: 'en', strength: 2 }).select('_id').lean();
        if (ignTakenAgain) {
          try {
            await (sentMessage as Message).edit({
              embeds: [errorEmbed('This IGN is already registered to another user.', 'Register Error').builder],
              components: []
            });
          } catch (e) {
            console.error('Failed to edit original registration message (IGN taken after):', e);
          }
          await respondToModal(modalInt, errorEmbed('IGN already registered to another user.', 'Registration Error'));
          return;
        }
        try {
          await User.create({ discordId, ign });
        } catch (createError) {
          const code = (createError as { code?: unknown })?.code;
          const duplicate = code === 11000;
          try {
            await (sentMessage as Message).edit({
              embeds: [errorEmbed(
                duplicate ? 'You are already registered.' : 'Registration failed. Please try again.',
                'Register Error'
              ).builder],
              components: []
            });
          } catch (e) {
            console.error('Failed to edit original registration message (duplicate):', e);
          }
          await respondToModal(modalInt, errorEmbed(
            duplicate ? 'You are already registered.' : 'Registration failed. Please try again.',
            'Registration Error'
          ));
          return;
        }
        

        
        try {
          if (interaction.guild) {
            await fix(interaction.guild, discordId);
          }

          await recordAudit({
            action: 'account.register',
            category: 'account',
            source: 'discord',
            success: true,
            actorId: discordId,
            actorName: interaction.user?.tag,
            guildId: interaction.guildId ?? undefined,
            channelId: interaction.channelId ?? undefined,
            targetType: 'user',
            targetId: discordId,
            targetName: ign,
            after: { ign },
          });
          
          try {
            await (sentMessage as Message).edit({
              embeds: [successEmbed('Registration successful! Your nickname and roles have been set up.', 'Registration Complete').builder],
              components: []
            });
          } catch (e) {
            console.error('Failed to edit original registration message (success):', e);
          }
          await respondToModal(modalInt, successEmbed('Registration complete.', 'Registration Complete'));
        } catch (fixError) {
          console.error('Error updating nickname/roles:', fixError);
          try {
            await (sentMessage as Message).edit({
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
          await respondToModal(modalInt, errorEmbed('Registered, but there was a roles/nickname issue.', 'Registration Warning'));
        }
      } else {
        try {
          await (sentMessage as Message).edit({
            embeds: [errorEmbed('Invalid code. Please try again.', 'Register Error').builder],
            components: []
          });
        } catch (e) {
          console.error('Failed to edit original registration message (invalid code):', e);
        }
        await respondToModal(modalInt, errorEmbed('Invalid code.', 'Registration Error'));
      }
    });
  } catch (error) {
    await replyCommandError(interaction, error, 'register your account', '[register]');
  }
}