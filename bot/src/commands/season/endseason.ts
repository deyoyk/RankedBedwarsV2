import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { SeasonManager } from '../../managers/SeasonManager';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';

const { errorEmbed, successEmbed } = embedsFor('Season');

export async function endseason(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
    void _wsManager;
    try {
        const result = await SeasonManager.endSeason();

        if (result.success) {
            const embed = successEmbed(
                `**${result.seasonInfo?.name}** (Season ${result.seasonInfo?.seasonNumber} Chapter ${result.seasonInfo?.chapterNumber}) has been successfully ended`,
                'Season Ended'
            ).builder.addFields(
                { name: 'Season', value: `${result.seasonInfo?.seasonNumber}`, inline: true },
                { name: 'Chapter', value: `${result.seasonInfo?.chapterNumber}`, inline: true },
                { name: 'Users Migrated', value: result.usersMigrated.toString(), inline: true },
                { name: 'Games Migrated', value: result.gamesMigrated.toString(), inline: true },
                { name: 'Stats Created', value: result.statsCreated.toString(), inline: true }
            );

            await safeReply(interaction, { embeds: [embed] });
        } else {
            await safeReply(interaction, { embeds: [errorEmbed(result.message, 'Season End Failed').builder] });
        }
    } catch (error) {
        console.error('Error ending season:', error);
        await safeReply(interaction, {
            embeds: [errorEmbed('An error occurred while ending the season. Please check the logs and try again.', 'Season End Failed').builder]
        });
    }
}

export const executeEndSeason = endseason;
