import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { EXPERIENCE_REWARDS, getLevelInfo } from '../../utils/levelSystem';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';

const { errorEmbed, infoEmbed } = embedsFor('Player');

export async function level(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
    void _wsManager;
    try {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const targetId = targetUser.id;
        const targetUsername = targetUser.username;

        const user = await User.findOne({ discordId: targetId }).select('discordId ign experience').lean();

        if (!user) {
            await safeReply(interaction, {
                embeds: [errorEmbed('This user is not registered in the system.', 'User Not Found').builder],
                ephemeral: true
            });
            return;
        }

        const levelInfo = getLevelInfo(user.experience || 0);
        const progressPercentage = ((levelInfo.experience - levelInfo.experienceForCurrentLevel) / levelInfo.totalExperienceForLevel * 100);
        const progressBar = '\u2588'.repeat(Math.floor(progressPercentage / 5)) + '\u2591'.repeat(20 - Math.floor(progressPercentage / 5));

        const embed = infoEmbed(
            `Level information for ${user.ign || targetUsername || targetId}.`,
            'Level Information'
        ).builder.addFields(
                {
                    name: 'Current Level',
                    value: [
                        `**Level:** ${levelInfo.level}`,
                        `**Total Experience:** ${levelInfo.experience.toLocaleString()} XP`,
                        `**Experience for Current Level:** ${levelInfo.experienceForCurrentLevel.toLocaleString()} XP`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: 'Next Level Progress',
                    value: [
                        `**Next Level:** ${levelInfo.level + 1}`,
                        `**Experience Needed:** ${levelInfo.experienceNeededForNext.toLocaleString()} XP`,
                        `**Experience for Next Level:** ${levelInfo.experienceForNextLevel.toLocaleString()} XP`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: 'Progress Bar',
                    value: [
                        `${progressBar} ${progressPercentage.toFixed(1)}%`,
                        `${(levelInfo.experience - levelInfo.experienceForCurrentLevel).toLocaleString()}/${levelInfo.totalExperienceForLevel.toLocaleString()} XP`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Experience Rewards',
                    value: [
                        `**Win:** +${EXPERIENCE_REWARDS.WIN} XP`,
                        `**Loss:** +${EXPERIENCE_REWARDS.LOSS} XP`,
                        `**MVP:** +${EXPERIENCE_REWARDS.MVP} XP`,
                        `**Bed Break:** +${EXPERIENCE_REWARDS.BED_BREAK} XP`,
                        `**Kill:** +${EXPERIENCE_REWARDS.KILL} XP`,
                        `**Final Kill:** +${EXPERIENCE_REWARDS.FINAL_KILL} XP`
                    ].join('\n'),
                    inline: false
                }
            );
        await safeReply(interaction, { embeds: [embed] });

    } catch (error) {
        console.error('Error in level command:', error);
        await safeReply(interaction, {
            embeds: [errorEmbed('An error occurred while fetching level information.', 'Level Information Error').builder],
            ephemeral: true
        });
    }
}

export const execute = level;
