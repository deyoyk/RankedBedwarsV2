import { GuildMember, Guild, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import Party from '../models/Party';
import UserModel from '../models/User';
import config from '../config/config';
import { errorEmbed, successEmbed, betterEmbed } from '../utils/betterembed';

export interface PartyValidationResult {
  isValid: boolean;
  error?: string;
  party?: any;
  user?: any;
}

export interface PartyInviteResult {
  success: boolean;
  message?: string;
  embed?: EmbedBuilder;
  components?: ActionRowBuilder<ButtonBuilder>[];
}

export class PartyService {
  private static readonly INVITE_TIMEOUT = 5 * 60 * 1000;
  private static readonly MAX_MEMBERS = 8;
  private static readonly MIN_MEMBERS = 2;

  static async validateUser(userId: string): Promise<PartyValidationResult> {
    try {
      const user = await UserModel.findOne({ discordId: userId });
      if (!user) {
        return { isValid: false, error: 'User not registered' };
      }
      return { isValid: true, user };
    } catch (error) {
      console.error('[PartyService] Error validating user:', error);
      return { isValid: false, error: 'Database error' };
    }
  }

  static async validatePartyAccess(userId: string, requireLeader: boolean = false): Promise<PartyValidationResult> {
    try {
      const user = await UserModel.findOne({ discordId: userId });
      if (!user || !user.partyId) {
        return { isValid: false, error: 'Not in a party' };
      }

      const party = await Party.findOne({ partyId: user.partyId });
      if (!party) {
        await this.cleanupUserParty(userId);
        return { isValid: false, error: 'Party not found' };
      }

      if (requireLeader && party.leader !== userId) {
        return { isValid: false, error: 'Not party leader' };
      }

      return { isValid: true, party, user };
    } catch (error) {
      console.error('[PartyService] Error validating party access:', error);
      return { isValid: false, error: 'Database error' };
    }
  }

  static async createParty(userId: string): Promise<{ success: boolean; party?: any; error?: string }> {
    try {
      const user = await UserModel.findOne({ discordId: userId });
      if (!user) {
        return { success: false, error: 'User not registered' };
      }

      if (user.partyId) {
        return { success: false, error: 'Already in a party' };
      }

      const partyId = this.generatePartyId();
      const party = new Party({
        partyId,
        leader: userId,
        members: [userId],
        lastActiveTime: new Date(),
        maxMembers: this.MAX_MEMBERS,
        isPrivate: false,
        description: ''
      });

      await party.save();
      user.partyId = partyId;
      await user.save();

      return { success: true, party };
    } catch (error) {
      console.error('[PartyService] Error creating party:', error);
      return { success: false, error: 'Failed to create party' };
    }
  }

  static async inviteToParty(leaderId: string, targetId: string, guild: Guild): Promise<PartyInviteResult> {
    try {
      const leaderValidation = await this.validatePartyAccess(leaderId, true);
      if (!leaderValidation.isValid) {
        return { success: false, message: leaderValidation.error };
      }

      const targetUser = await UserModel.findOne({ discordId: targetId });
      if (!targetUser) {
        return { success: false, message: 'Target user not registered' };
      }

      if (targetUser.partyId) {
        return { success: false, message: 'Target user already in party' };
      }

      if (targetUser.settings?.togglepartyinvites) {
        return { success: false, message: 'User has party invites disabled' };
      }

      const party = leaderValidation.party!;
      if (party.members.includes(targetId)) {
        return { success: false, message: 'User already in party' };
      }

      if (party.members.length >= party.maxMembers) {
        return { success: false, message: 'Party is full' };
      }

      await this.updatePartyActivity(party.partyId);

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('Party Invitation')
        .setDescription(`<@${targetId}>, you have been invited to join the party!`)
        .addFields(
          { name: 'Party ID', value: party.partyId, inline: true },
          { name: 'Leader', value: `<@${leaderId}>`, inline: true },
          { name: 'Members', value: party.members.map((id: string) => `<@${id}>`).join(', '), inline: false },
          { name: 'Description', value: party.description || 'No description', inline: false }
        )
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`party_accept_${party.partyId}_${targetId}`)
          .setLabel('Accept Invite')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`party_decline_${party.partyId}_${targetId}`)
          .setLabel('Decline')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌')
      );

      return { success: true, embed, components: [row] };
    } catch (error) {
      console.error('[PartyService] Error inviting to party:', error);
      return { success: false, message: 'Failed to send invite' };
    }
  }

  static async acceptInvite(partyId: string, userId: string, guild: Guild): Promise<{ success: boolean; message?: string }> {
    try {
      const party = await Party.findOne({ partyId });
      if (!party) {
        return { success: false, message: 'Party not found' };
      }

      const user = await UserModel.findOne({ discordId: userId });
      if (!user) {
        return { success: false, message: 'User not registered' };
      }

      if (user.partyId) {
        return { success: false, message: 'Already in a party' };
      }

      if (party.members.includes(userId)) {
        return { success: false, message: 'Already in this party' };
      }

      if (party.members.length >= party.maxMembers) {
        return { success: false, message: 'Party is full' };
      }

      party.members.push(userId);
      await party.save();

      user.partyId = partyId;
      await user.save();

      await this.updatePartyRoles(guild, party.members);
      await this.updatePartyActivity(partyId);

      return { success: true };
    } catch (error) {
      console.error('[PartyService] Error accepting invite:', error);
      return { success: false, message: 'Failed to accept invite' };
    }
  }

  static async leaveParty(userId: string, guild: Guild): Promise<{ success: boolean; message?: string; party?: any }> {
    try {
      const validation = await this.validatePartyAccess(userId);
      if (!validation.isValid) {
        return { success: false, message: validation.error };
      }

      const party = validation.party!;
      if (party.leader === userId) {
        return { success: false, message: 'Use disband to dissolve party' };
      }

      party.members = party.members.filter((id: string) => id !== userId);
      await party.save();

      await UserModel.updateOne(
        { discordId: userId },
        { $unset: { partyId: "" } }
      );

      await this.updatePartyRoles(guild, party.members);
      await this.updatePartyActivity(party.partyId);

      return { success: true, party };
    } catch (error) {
      console.error('[PartyService] Error leaving party:', error);
      return { success: false, message: 'Failed to leave party' };
    }
  }

  static async disbandParty(userId: string, guild: Guild): Promise<{ success: boolean; message?: string; party?: any }> {
    try {
      const validation = await this.validatePartyAccess(userId, true);
      if (!validation.isValid) {
        return { success: false, message: validation.error };
      }

      const party = validation.party!;

      await UserModel.updateMany(
        { partyId: party.partyId },
        { $unset: { partyId: "" } }
      );

      await this.removePartyRoles(guild, party.members);
      await Party.deleteOne({ partyId: party.partyId });

      return { success: true, party };
    } catch (error) {
      console.error('[PartyService] Error disbanding party:', error);
      return { success: false, message: 'Failed to disband party' };
    }
  }

  static async kickFromParty(leaderId: string, targetId: string, guild: Guild): Promise<{ success: boolean; message?: string; party?: any }> {
    try {
      const validation = await this.validatePartyAccess(leaderId, true);
      if (!validation.isValid) {
        return { success: false, message: validation.error };
      }

      const party = validation.party!;
      if (!party.members.includes(targetId)) {
        return { success: false, message: 'User not in party' };
      }

      if (targetId === leaderId) {
        return { success: false, message: 'Cannot kick yourself' };
      }

      party.members = party.members.filter((id: string) => id !== targetId);
      await party.save();

      await UserModel.updateOne(
        { discordId: targetId },
        { $unset: { partyId: "" } }
      );

      await this.updatePartyRoles(guild, party.members);
      await this.updatePartyActivity(party.partyId);

      return { success: true, party };
    } catch (error) {
      console.error('[PartyService] Error kicking from party:', error);
      return { success: false, message: 'Failed to kick user' };
    }
  }

  static async promoteToLeader(leaderId: string, targetId: string): Promise<{ success: boolean; message?: string; party?: any }> {
    try {
      const validation = await this.validatePartyAccess(leaderId, true);
      if (!validation.isValid) {
        return { success: false, message: validation.error };
      }

      const party = validation.party!;
      if (!party.members.includes(targetId)) {
        return { success: false, message: 'User not in party' };
      }

      if (targetId === leaderId) {
        return { success: false, message: 'Already the leader' };
      }

      party.leader = targetId;
      await party.save();
      await this.updatePartyActivity(party.partyId);

      return { success: true, party };
    } catch (error) {
      console.error('[PartyService] Error promoting to leader:', error);
      return { success: false, message: 'Failed to promote user' };
    }
  }

  static async updatePartySettings(leaderId: string, setting: string, value: string): Promise<{ success: boolean; message?: string; party?: any }> {
    try {
      const validation = await this.validatePartyAccess(leaderId, true);
      if (!validation.isValid) {
        return { success: false, message: validation.error };
      }

      const party = validation.party!;

      switch (setting.toLowerCase()) {
        case 'maxmembers':
          const maxMembers = parseInt(value);
          if (isNaN(maxMembers) || maxMembers < this.MIN_MEMBERS || maxMembers > this.MAX_MEMBERS) {
            return { success: false, message: `Max members must be between ${this.MIN_MEMBERS} and ${this.MAX_MEMBERS}` };
          }
          party.maxMembers = maxMembers;
          break;
        case 'private':
          party.isPrivate = value.toLowerCase() === 'true';
          break;
        case 'description':
          if (value.length > 100) {
            return { success: false, message: 'Description too long (max 100 characters)' };
          }
          party.description = value;
          break;
        default:
          return { success: false, message: 'Invalid setting' };
      }

      await party.save();
      await this.updatePartyActivity(party.partyId);

      return { success: true, party };
    } catch (error) {
      console.error('[PartyService] Error updating party settings:', error);
      return { success: false, message: 'Failed to update settings' };
    }
  }

  static async joinParty(userId: string, partyId: string, guild: Guild): Promise<{ success: boolean; message?: string; party?: any }> {
    try {
      const user = await UserModel.findOne({ discordId: userId });
      if (!user) {
        return { success: false, message: 'User not registered' };
      }

      if (user.partyId) {
        return { success: false, message: 'Already in a party' };
      }

      const party = await Party.findOne({ partyId });
      if (!party) {
        return { success: false, message: 'Party not found' };
      }

      if (party.isPrivate) {
        return { success: false, message: 'Party is private' };
      }

      if (party.members.length >= party.maxMembers) {
        return { success: false, message: 'Party is full' };
      }

      party.members.push(userId);
      await party.save();

      user.partyId = partyId;
      await user.save();

      await this.updatePartyRoles(guild, party.members);
      await this.updatePartyActivity(partyId);

      return { success: true, party };
    } catch (error) {
      console.error('[PartyService] Error joining party:', error);
      return { success: false, message: 'Failed to join party' };
    }
  }

  static async getPartyInfo(userId: string): Promise<{ success: boolean; party?: any; message?: string }> {
    try {
      const validation = await this.validatePartyAccess(userId);
      if (!validation.isValid) {
        return { success: false, message: validation.error };
      }

      await this.updatePartyActivity(validation.party!.partyId);
      return { success: true, party: validation.party };
    } catch (error) {
      console.error('[PartyService] Error getting party info:', error);
      return { success: false, message: 'Failed to get party info' };
    }
  }

  static async listPublicParties(): Promise<{ success: boolean; parties?: any[]; message?: string }> {
    try {
      const parties = await Party.find({ isPrivate: false }).sort({ lastActiveTime: -1 });
      return { success: true, parties };
    } catch (error) {
      console.error('[PartyService] Error listing parties:', error);
      return { success: false, message: 'Failed to list parties' };
    }
  }

  private static generatePartyId(): string {
    return `P${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }

  private static async updatePartyActivity(partyId: string): Promise<void> {
    try {
      await Party.updateOne(
        { partyId },
        { lastActiveTime: new Date() }
      );
    } catch (error) {
      console.error('[PartyService] Error updating party activity:', error);
    }
  }

  private static async updatePartyRoles(guild: Guild, memberIds: string[]): Promise<void> {
    try {
      const roles = {
        2: config.roles.partyof2Queue,
        3: config.roles.partyof3Queue,
        4: config.roles.partyof4Queue
      };

      const partySize = memberIds.length;
      const targetRole = partySize >= 4 ? roles[4] : partySize >= 3 ? roles[3] : partySize >= 2 ? roles[2] : null;

      for (const memberId of memberIds) {
        try {
          const member = await guild.members.fetch(memberId);
          if (member) {
            await member.roles.remove([roles[2], roles[3], roles[4]]);
            if (targetRole) {
              await member.roles.add(targetRole);
            }
          }
        } catch (memberError) {
          console.warn(`[PartyService] Could not update roles for member ${memberId}:`, memberError);
        }
      }
    } catch (error) {
      console.error('[PartyService] Error updating party roles:', error);
    }
  }

  static async removePartyRoles(guild: Guild, memberIds: string[]): Promise<void> {
    try {
      const roles = {
        2: config.roles.partyof2Queue,
        3: config.roles.partyof3Queue,
        4: config.roles.partyof4Queue
      };

      for (const memberId of memberIds) {
        try {
          const member = await guild.members.fetch(memberId);
          if (member) {
            await member.roles.remove([roles[2], roles[3], roles[4]]);
          }
        } catch (memberError) {
          console.warn(`[PartyService] Could not remove roles for member ${memberId}:`, memberError);
        }
      }
    } catch (error) {
      console.error('[PartyService] Error removing party roles:', error);
    }
  }

  private static async cleanupUserParty(userId: string): Promise<void> {
    try {
      await UserModel.updateOne(
        { discordId: userId },
        { $unset: { partyId: "" } }
      );
    } catch (error) {
      console.error('[PartyService] Error cleaning up user party:', error);
    }
  }
}