import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeFix } from '../../utils/fix';
import { safeReply } from '../../utils/safeReply';
import { getEloClaimEligibility, getEloClaimGrant } from '../../utils/eloClaim';
import { getMemberRoleIds } from '../../utils/memberRoles';
import { SeasonManager } from '../../managers/SeasonManager';
import config from '../../config/config';

function actorId(interaction: Message | ChatInputCommandInteraction): string {
  return interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
}

interface ClaimableUser {
  games?: number;
  elo?: number;
  eloClaims?: Array<{
    date: Date;
    seasonNumber?: number;
    chapterNumber?: number;
    roleId?: string;
    amount?: number;
  }>;
}

export async function claimelo(interaction: Message | ChatInputCommandInteraction, _args?: string[], _wsManager?: WebSocketManager) {
  const discordId = actorId(interaction);
  try {
    const roleIds = await getMemberRoleIds(interaction, discordId);
    const grant = getEloClaimGrant(roleIds, config.eloClaim.roles);
    if (!grant) {
      await safeReply(interaction, errorEmbed('You do not have a role that can claim ELO.', 'ELO Claim Error'));
      return;
    }

    const currentSeason = await SeasonManager.getCurrentSeason();
    if (!currentSeason) {
      await safeReply(interaction, errorEmbed('There is no active season right now.', 'ELO Claim Error'));
      return;
    }

    const user = await User.findOne({ discordId }).select('discordId games elo eloClaims').lean() as unknown as ClaimableUser | null;
    if (!user) {
      await safeReply(interaction, errorEmbed('You need to register first!', 'ELO Claim Error'));
      return;
    }

    const eligibility = getEloClaimEligibility(user.games, user.eloClaims, currentSeason);
    if (eligibility === 'played') {
      await safeReply(interaction, errorEmbed('You cannot claim ELO after playing a game this season.', 'ELO Claim Error'));
      return;
    }
    if (eligibility === 'claimed') {
      await safeReply(interaction, errorEmbed('You have already claimed ELO this season.', 'ELO Claim Error'));
      return;
    }

    const entry = {
      date: new Date(),
      seasonNumber: currentSeason.seasonNumber,
      chapterNumber: currentSeason.chapterNumber,
      roleId: grant.roleId,
      amount: grant.amount,
    };

    const claimed = await User.findOneAndUpdate(
      {
        discordId,
        games: { $in: [0, null] },
        $nor: [{
          eloClaims: {
            $elemMatch: {
              seasonNumber: currentSeason.seasonNumber,
              chapterNumber: currentSeason.chapterNumber,
            },
          },
        }],
      },
      {
        $max: { elo: grant.amount },
        $push: { eloClaims: entry },
      },
      { new: true },
    );

    if (!claimed) {
      await safeReply(interaction, errorEmbed(
        'Could not claim ELO. You may have already claimed this season or already played a game.',
        'ELO Claim Error',
      ));
      return;
    }

    await safeFix(interaction.guild, discordId);

    await safeReply(interaction, successEmbed(
      `You claimed **${grant.amount}** ELO for this season.\nYour ELO is now **${claimed.elo}**.`,
      'ELO Claimed',
    ));
  } catch (error) {
    console.error('Error in claimelo command:', error);
    await safeReply(interaction, errorEmbed('There was an error claiming your ELO.', 'ELO Claim Error'));
  }
}
