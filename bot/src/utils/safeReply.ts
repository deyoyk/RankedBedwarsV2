import { ChatInputCommandInteraction, InteractionEditReplyOptions, InteractionReplyOptions, InteractionResponse, Message, MessagePayload } from 'discord.js';

function errorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return undefined;
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
    const code = errorCode(error);

    if (interaction instanceof ChatInputCommandInteraction) {
      if (code === 10062) {
        console.warn('safeReply: interaction expired before a response could be sent; dropping response');
        return null;
      }
      if (code === 40060) {
        return await interaction.followUp(options).catch((followUpError) => {
          if (errorCode(followUpError) !== 10062) {
            console.error('Error in safeReply follow-up:', followUpError);
          }
          return null;
        }) ?? null;
      }
      if (interaction.replied || interaction.deferred) {
        return await interaction.followUp(options).catch((followUpError) => {
          if (errorCode(followUpError) !== 10062) {
            console.error('Error in safeReply follow-up:', followUpError);
          }
          return null;
        }) ?? null;
      }
    }

    console.error('Error in safeReply:', error);
    throw error;
  }
}
