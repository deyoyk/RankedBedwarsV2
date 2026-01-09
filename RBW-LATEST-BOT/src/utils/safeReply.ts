import { Message, ChatInputCommandInteraction, InteractionReplyOptions, MessagePayload, InteractionEditReplyOptions } from 'discord.js';


export async function safeReply(
  interaction: Message | ChatInputCommandInteraction, 
  options: string | MessagePayload | InteractionReplyOptions
) {
  try {
    if (interaction instanceof ChatInputCommandInteraction) {
      
      if (!interaction.replied && !interaction.deferred) {
        
        return await interaction.reply(options as string | MessagePayload | InteractionReplyOptions);
      } else if (interaction.deferred && !interaction.replied) {
        
        const editOptions = typeof options === 'string' 
          ? options 
          : options instanceof MessagePayload 
            ? options 
            : {
                content: options.content,
                embeds: options.embeds,
                components: options.components,
                files: options.files,
                allowedMentions: options.allowedMentions
              } as InteractionEditReplyOptions;
        return await interaction.editReply(editOptions);
      } else {
        
        return await interaction.followUp(options as string | MessagePayload | InteractionReplyOptions);
      }
    } else {
      
      return await interaction.reply(options as string | MessagePayload);
    }
  } catch (error) {
    console.error('Error in safeReply:', error);
    console.error('Interaction state:', {
      replied: interaction instanceof ChatInputCommandInteraction ? interaction.replied : 'N/A',
      deferred: interaction instanceof ChatInputCommandInteraction ? interaction.deferred : 'N/A'
    });
    
    
    if (interaction instanceof ChatInputCommandInteraction) {
      try {
        
        if (interaction.replied || interaction.deferred) {
          return await interaction.followUp(options as string | MessagePayload | InteractionReplyOptions);
        }
      } catch (innerError) {
        console.error('Failed to recover from reply error:', innerError);
      }
    }
    
    
    throw error;
  }
}