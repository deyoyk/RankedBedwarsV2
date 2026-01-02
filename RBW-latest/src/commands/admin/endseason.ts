import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import Season from '../../models/Season';
import User from '../../models/User';
import Game from '../../models/Game';
import SeasonStats from '../../models/SeasonStats';
import SeasonGames from '../../models/SeasonGames';

export const data = new SlashCommandBuilder()
    .setName('endseason')
    .setDescription('End the current active season and migrate data');

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
        
        const activeSeason = await Season.findOne({ isActive: true });
        if (!activeSeason) {
            const embed = new EmbedBuilder()
                .setColor('#00AAAA')
                .setTitle('❌ Error')
                .setDescription('No active season found to end.');

            return interaction.editReply({ embeds: [embed] });
        }

        const seasonNumber = activeSeason.seasonNumber;
        const chapterNumber = activeSeason.chapterNumber;

        
        const users = await User.find({});
        const userMigrationPromises = users.map(async (user) => {
            const seasonStats = new SeasonStats({
                discordId: user.discordId,
                seasonNumber: seasonNumber,
                chapterNumber: chapterNumber,
                ign: user.ign,
                elo: user.elo,
                level: user.level || 1,
                experience: user.experience || 0,
                wins: user.wins,
                losses: user.losses,
                games: user.games,
                mvps: user.mvps,
                kills: user.kills,
                deaths: user.deaths,
                bedBroken: user.bedBroken,
                finalKills: user.finalKills,
                diamonds: user.diamonds || 0,
                irons: user.irons || 0,
                gold: user.gold || 0,
                emeralds: user.emeralds || 0,
                blocksPlaced: user.blocksPlaced || 0,
                winstreak: user.winstreak || 0,
                losestreak: user.losestreak || 0,
                kdr: user.kdr || 0,
                wlr: user.wlr || 0,
                recentGames: user.recentGames,
                dailyElo: user.dailyElo
            });

            return seasonStats.save();
        });

        
        const games = await Game.find({});
        const gameMigrationPromises = games.map(async (game) => {
            const seasonGame = new SeasonGames({
                gameId: game.gameId,
                seasonNumber: seasonNumber,
                chapterNumber: chapterNumber,
                map: game.map,
                team1: game.team1,
                team2: game.team2,
                winners: game.winners,
                losers: game.losers,
                mvps: game.mvps,
                bedbreaks: game.bedbreaks,
                startTime: game.startTime,
                endTime: game.endTime,
                state: game.state,
                channels: game.channels,
                queueId: game.queueId,
                isRanked: game.isRanked,
                partiesInThisGame: game.partiesInThisGame,
                reason: game.reason
            });

            return seasonGame.save();
        });

        
        await Promise.all([...userMigrationPromises, ...gameMigrationPromises]);

        
        await User.updateMany({}, {
            $set: {
                elo: 0,
                level: 1,
                experience: 0,
                wins: 0,
                losses: 0,
                games: 0,
                mvps: 0,
                kills: 0,
                deaths: 0,
                bedBroken: 0,
                finalKills: 0,
                diamonds: 0,
                irons: 0,
                gold: 0,
                emeralds: 0,
                blocksPlaced: 0,
                winstreak: 0,
                losestreak: 0,
                kdr: 0,
                wlr: 0,
                recentGames: [],
                dailyElo: [],
                seasonNumber: null,
                chapterNumber: null
            }
        });

        
        await Game.deleteMany({});

        
        activeSeason.endDate = new Date();
        activeSeason.isActive = false;
        await activeSeason.save();

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🏁 Season Ended!')
            .setDescription(`**${activeSeason.name}** (Season ${seasonNumber} Chapter ${chapterNumber}) has been successfully ended`)
            .addFields(
                { name: 'Season', value: `${seasonNumber}`, inline: true },
                { name: 'Chapter', value: `${chapterNumber}`, inline: true },
                { name: 'End Date', value: `<t:${Math.floor(activeSeason.endDate!.getTime() / 1000)}:F>`, inline: true },
                { name: 'Users Migrated', value: users.length.toString(), inline: true },
                { name: 'Games Migrated', value: games.length.toString(), inline: true }
            )
            .setFooter({ text: 'All user stats have been reset and games cleared for the new season' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error ending season:', error);

        const embed = new EmbedBuilder()
            .setColor('#00AAAA')
            .setTitle('❌ Error')
            .setDescription('An error occurred while ending the season. Please check the logs and try again.');

        await interaction.editReply({ embeds: [embed] });
    }
}