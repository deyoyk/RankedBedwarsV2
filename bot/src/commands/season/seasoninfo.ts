import { ChatInputCommandInteraction, EmbedBuilder, Message } from 'discord.js';
import { parse } from 'yaml';
import fs from 'fs';
import path from 'path';
import { safeReply } from '../../utils/safeReply';
import Season from '../../models/Season';

interface SeasonInfo {
  field1: string;
  field1value: string[];
  field2: string;
  field2value: string[];
  field3: string;
  field3value: string[];
}

export async function seasoninfo(interaction: ChatInputCommandInteraction | Message) {
  try {
    const configPath = path.join(__dirname, '../../config/seasoninfo.yml');
    
    if (!fs.existsSync(configPath)) {
      const errorMessage = 'Season info configuration file not found.';
      await safeReply(interaction, { content: errorMessage, ephemeral: true });
      return;
    }

    const yamlContent = fs.readFileSync(configPath, 'utf8');
    const seasonData: SeasonInfo = parse(yamlContent);

    const currentSeason = await Season.findOne({ isActive: true });
    
    const embed = new EmbedBuilder()
      .setTitle('Season Information')
      .setColor('#00AAAA')
      .setTimestamp();

    if (currentSeason) {
      embed.addFields({
        name: 'Current Season',
        value: `C ${currentSeason.chapterNumber} - S ${currentSeason.seasonNumber} ${currentSeason.name}`,
        inline: false
      });

    }

    embed.addFields(
      {
        name: seasonData.field1,
        value: seasonData.field1value.join('\n'),
        inline: false
      },
      {
        name: seasonData.field2,
        value: ' ' + seasonData.field2value.join('\n '),
        inline: false
      },
      {
        name: seasonData.field3,
        value: ' ' + seasonData.field3value.join('\n '),
        inline: false
      }
    );

    await safeReply(interaction, { embeds: [embed] });
  } catch (error) {
    console.error('Error in seasoninfo command:', error);
    
    const errorMessage = 'There was an error loading the season information. Please try again.';
    
    try {
      await safeReply(interaction, { content: errorMessage, ephemeral: true });
    } catch (replyError) {
      console.error('Error sending error message:', replyError);
    }
  }
}