import { ChatInputCommandInteraction, InteractionEditReplyOptions, InteractionReplyOptions, InteractionResponse, Message, MessagePayload } from 'discord.js';

function errorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return undefined;
}

function isUndeliverable(error: unknown): boolean {
  const code = errorCode(error);
  return code === 10062 || code === 10008;
}

function toEditOptions(options: string | MessagePayload | InteractionReplyOptions): string | MessagePayload | InteractionEditReplyOptions {
  if (typeof options === 'string' || options instanceof MessagePayload) return options;
  return {
    content: options.content,
    embeds: options.embeds,
    components: options.components,
    files: options.files,
    allowedMentions: options.allowedMentions
  } as InteractionEditReplyOptions;
}

async function sendFollowUp(
  interaction: ChatInputCommandInteraction,
  options: string | MessagePayload | InteractionReplyOptions
): Promise<Message | null> {
  try {
    return await interaction.webhook.send(options);
  } catch (error) {
    if (!isUndeliverable(error)) {
      console.error('Error in safeReply follow-up:', error);
    }
    return null;
  }
}

export async function safeReply(
  interaction: Message | ChatInputCommandInteraction,
  options: string | MessagePayload | InteractionReplyOptions
): Promise<Message | InteractionResponse | null> {
  try {
    if (interaction instanceof ChatInputCommandInteraction) {
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply(options);
      } else if (interaction.deferred && !interaction.replied) {
        return await interaction.editReply(toEditOptions(options));
      } else {
        return await interaction.followUp(options);
      }
    }

    return await interaction.reply(options as string | MessagePayload);
  } catch (error) {
    if (isUndeliverable(error)) {
      console.warn('safeReply: interaction response is no longer available; dropping response');
      return null;
    }

    if (interaction instanceof ChatInputCommandInteraction) {
      if (errorCode(error) === 40060 || interaction.replied || interaction.deferred) {
        return sendFollowUp(interaction, options);
      }
    }

    console.error('Error in safeReply:', error);
    throw error;
  }
}
