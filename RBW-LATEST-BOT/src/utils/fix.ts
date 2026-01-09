import config from '../config/config';
import { Guild } from 'discord.js';
import { WorkersManager } from '../managers/WorkersManager';


export async function fix(guild: Guild, discordId: string) {
  const User = (await import('../models/User')).default;
  const EloRank = (await import('../models/EloRank')).default;
  const workersManager = WorkersManager.getInstance();

  const member = guild.members.cache.get(discordId);
  if (!member) return;

  const user = await User.findOne({ discordId });
  const registeredRole = config.roles.registered;
  const nonRegisteredRole = config.roles.nonRegistered;
  const eloRanks = await EloRank.find();
  const eloRoleIds = eloRanks.map(r => r.roleId);

  if (!user) {

    const rolesToAdd = member.roles.cache.has(nonRegisteredRole) ? [] : [nonRegisteredRole];
    const rolesToRemove = [
      ...(member.roles.cache.has(registeredRole) ? [registeredRole] : []),
      ...eloRoleIds.filter(roleId => member.roles.cache.has(roleId))
    ];

    if (rolesToAdd.length > 0 || rolesToRemove.length > 0) {
      await workersManager.updateMemberRoles(discordId, rolesToAdd, rolesToRemove, 6);
    }
    return;
  }


  const rolesToAdd: string[] = [];
  const rolesToRemove: string[] = [];


  if (!member.roles.cache.has(registeredRole)) {
    rolesToAdd.push(registeredRole);
  }
  if (member.roles.cache.has(nonRegisteredRole)) {
    rolesToRemove.push(nonRegisteredRole);
  }


  const userElo = user.elo;
  const correctRank = eloRanks.find(r => userElo >= r.startElo && userElo <= r.endElo);

  for (const roleId of eloRoleIds) {
    if (roleId === (correctRank?.roleId || '')) {
      if (!member.roles.cache.has(roleId)) {
        rolesToAdd.push(roleId);
      }
    } else {
      if (member.roles.cache.has(roleId)) {
        rolesToRemove.push(roleId);
      }
    }
  }


  if (rolesToAdd.length > 0 || rolesToRemove.length > 0) {
    await workersManager.updateMemberRoles(discordId, rolesToAdd, rolesToRemove, 6);
  }


  try {
    let nickname: string;

    if (user.settings?.togglestaticnick) {
      nickname = '';
    } else {
      if (user.settings?.toggleprefix) {
        nickname = user.ign;
      } else {
        nickname = `[${user.elo}] ${user.ign}`;
      }

      if (user.nick && user.nick.trim() !== '') {
        nickname += ` | ${user.nick}`;
      }
    }


    if (member.nickname !== nickname) {
      await workersManager.setMemberNickname(discordId, nickname, 4);
    }
  } catch (error) {
    console.error(`Failed to update nickname for ${user.discordId}:`, error);
  }

}