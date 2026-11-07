import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { EXPERIENCE_REWARDS, getLevelInfo } from '../../utils/levelSystem';
import { safeReply } from '../../utils/safeReply';
import { themedEmbed } from '../../utils/betterembed';

export async function level(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
    void _wsManager;
    try {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const targetId = targetUser.id;
        const targetAvatar = targetUser.displayAvatarURL();
        const targetUsername = targetUser.username;

        const user = await User.findOne({ discordId: targetId }).select('discordId ign experience').lean();

        if (!user) {
            const embed = themedEmbed()
                .setColor('#00AAAA')
                .setTitle('\u274c User Not Found')
                .setDescription('This user is not registered in the system.');

            await safeReply(interaction, { embeds: [embed], ephemeral: true });
            return;
        }

        const levelInfo = getLevelInfo(user.experience || 0);
        const progressPercentage = ((levelInfo.experience - levelInfo.experienceForCurrentLevel) / levelInfo.totalExperienceForLevel * 100);
        const progressBar = '\u2588'.repeat(Math.floor(progressPercentage / 5)) + '\u2591'.repeat(20 - Math.floor(progressPercentage / 5));

        const embed = themedEmbed()
            .setColor('#00ff00')
            .setTitle(`Level Information - ${user.ign || targetUsername || targetId}`)
            .addFields(
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
            )
            .setFooter({ text: 'Keep playing to level up!' })
            .setTimestamp();
        if (targetAvatar) embed.setThumbnail(targetAvatar);

        await safeReply(interaction, { embeds: [embed] });

    } catch (error) {
        console.error('Error in level command:', error);

        const embed = themedEmbed()
            .setColor('#00AAAA')
            .setTitle('\u274c Error')
            .setDescription('An error occurred while fetching level information.');

        await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }
}

export const execute = level;
