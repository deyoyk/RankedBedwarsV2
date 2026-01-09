import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import User from '../../models/User';
import { getLevelInfo, EXPERIENCE_REWARDS } from '../../utils/levelSystem';
import { safeReply } from '../../utils/safeReply';

export const data = new SlashCommandBuilder()
    .setName('level')
    .setDescription('View level and experience information')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('User to view level for (leave empty for yourself)')
            .setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const user = await User.findOne({ discordId: targetUser.id });

        if (!user) {
            const embed = new EmbedBuilder()
                .setColor('#00AAAA')
                .setTitle('❌ User Not Found')
                .setDescription('This user is not registered in the system.');

            return safeReply(interaction, { embeds: [embed], ephemeral: true });
        }

        const levelInfo = getLevelInfo(user.experience || 0);
        const progressPercentage = ((levelInfo.experience - levelInfo.experienceForCurrentLevel) / levelInfo.totalExperienceForLevel * 100);
        const progressBar = '█'.repeat(Math.floor(progressPercentage / 5)) + '░'.repeat(20 - Math.floor(progressPercentage / 5));

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle(`Level Information - ${user.ign || targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL())
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

        await safeReply(interaction, { embeds: [embed] });

    } catch (error) {
        console.error('Error in level command:', error);

        const embed = new EmbedBuilder()
            .setColor('#00AAAA')
            .setTitle('❌ Error')
            .setDescription('An error occurred while fetching level information.');

        await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }
}