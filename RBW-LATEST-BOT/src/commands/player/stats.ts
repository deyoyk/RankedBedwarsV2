import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import User, { IUser } from '../../models/User';
import { betterEmbed } from '../../utils/betterembed';
import { resolveTheme } from '../../themes';

 

export async function stats(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetUserId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    targetUserId = interaction.options.getUser('user')?.id || interaction.user.id;
  } else {
    targetUserId = args && args[0] ? args[0].replace(/[<@!>]/g, '') : interaction.author.id;
  }


  

  const user: IUser | null = await User.findOne({ discordId: targetUserId });

  if (!user) {
    const notFoundEmbed = betterEmbed('User not found or not registered.', '#00AAAA', 'Stats Error');
    await safeReply(interaction, { embeds: [notFoundEmbed.builder] });
    return;
  }

  if (!(interaction instanceof ChatInputCommandInteraction) && (!args || args.length === 0)) {
    const usageEmbed = betterEmbed('Usage: =stats <@user|userId>', '#ffcc00', 'Stats Usage');
    await safeReply(interaction, { embeds: [usageEmbed.builder] });
    return;
  }

  
  const playerData = {
    discordid: user.discordId,
    ign: user.ign || 'Player',
    wins: user.wins || 0,
    losses: user.losses || 0,
    mvps: user.mvps || 0,
    elo: user.elo || 0,
    gamesplayed: user.games || 0,
  };

  // bruh this sorting logic is absolutely unhinged but it works (don't question it)
  // we're sorting recent games by date in descending order - newest games first fr fr
  const sortedRecent = [...(user.recentGames || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const recentGames = sortedRecent.slice(0, 10).map(g => {
    let result: string | undefined;
    if (g.state === 'scored') result = g.won ? 'win' : 'lose';
    else if (g.state === 'voided') result = 'voided';
    else result = 'pending';
    return { gameid: g.gameId, result };
  });

  
  async function calculatePosition(discordId: string): Promise<number> {
    const current = await User.findOne({ discordId });
    if (!current) return 0;
    const higher = await User.countDocuments({ elo: { $gt: current.elo } });
    return higher + 1;
  }

  const themeName = (user.currentTheme || 'elite').toLowerCase();
  const generator = resolveTheme(themeName);

  const buffer = await generator(playerData, recentGames, {
    calculatePosition,
    calculateRating: (pd) => pd.elo,
  });

  await safeReply(interaction, { files: [{ attachment: buffer, name: `${playerData.ign}_stats.png` }], content: '' });
}