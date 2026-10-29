import { Message, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { getLevelInfo, EXPERIENCE_REWARDS } from '../../utils/levelSystem';
import { safeReply } from '../../utils/safeReply';

export async function level(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager): Promise<void> {
    void wsManager;
    try {
        let targetId: string;
        let targetAvatar: string | undefined;
        let targetUsername: string | undefined;
        if (interaction instanceof ChatInputCommandInteraction) {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            targetId = targetUser.id;
            targetAvatar = targetUser.displayAvatarURL();
            targetUsername = targetUser.username;
        } else {
            if (args && args.length > 0) {
                const m = args[0].match(/^<@!?(\d+)>$/);
                targetId = m ? m[1] : args[0].replace(/[<@!>]/g, '');
            } else {
                targetId = interaction.author.id;
            }
        }
        const user = await User.findOne({ discordId: targetId }).select('discordId ign experience').lean();

        if (!user) {
            const embed = new EmbedBuilder()
                .setColor('#00AAAA')
                .setTitle('\u274c User Not Found')
                .setDescription('This user is not registered in the system.');

            await safeReply(interaction, { embeds: [embed], ephemeral: true });
            return;
        }

        const levelInfo = getLevelInfo(user.experience || 0);
        const progressPercentage = ((levelInfo.experience - levelInfo.experienceForCurrentLevel) / levelInfo.totalExperienceForLevel * 100);
        const progressBar = '\u2588'.repeat(Math.floor(progressPercentage / 5)) + '\u2591'.repeat(20 - Math.floor(progressPercentage / 5));

        const embed = new EmbedBuilder()
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

        const embed = new EmbedBuilder()
            .setColor('#00AAAA')
            .setTitle('\u274c Error')
            .setDescription('An error occurred while fetching level information.');

        await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }
}

// Backward-compatible alias (previous export name).
export const execute = level;
