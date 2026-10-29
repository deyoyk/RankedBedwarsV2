import { Message, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { SeasonManager } from '../../managers/SeasonManager';
import { safeReply } from '../../utils/safeReply';

export async function endseason(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager): Promise<void> {
    void args;
    void wsManager;
    try {
        const result = await SeasonManager.endSeason();


        if (result.success) {
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('Season Ended!')
                .setDescription(`**${result.seasonInfo?.name}** (Season ${result.seasonInfo?.seasonNumber} Chapter ${result.seasonInfo?.chapterNumber}) has been successfully ended`)
                .addFields(
                    { name: 'Season', value: `${result.seasonInfo?.seasonNumber}`, inline: true },
                    { name: 'Chapter', value: `${result.seasonInfo?.chapterNumber}`, inline: true },
                    { name: 'Users Migrated', value: result.usersMigrated.toString(), inline: true },
                    { name: 'Games Migrated', value: result.gamesMigrated.toString(), inline: true },
                    { name: 'Stats Created', value: result.statsCreated.toString(), inline: true }
                )
                .setFooter({ text: 'All user stats have been reset and games cleared for the new season' })
                .setTimestamp();

            await safeReply(interaction, { embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setColor('#00AAAA')
                .setTitle('❌ Error')
                .setDescription(result.message);

            await safeReply(interaction, { embeds: [embed] });
        }
    } catch (error) {
        console.error('Error ending season:', error);

        const embed = new EmbedBuilder()
            .setColor('#00AAAA')
            .setTitle('❌ Error')
            .setDescription('An error occurred while ending the season. Please check the logs and try again.');

        await safeReply(interaction, { embeds: [embed] });
    }
}

// Backward-compatible alias (previous export name).
export const executeEndSeason = endseason;
