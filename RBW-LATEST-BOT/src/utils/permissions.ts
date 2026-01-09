import { Message, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import config from '../config/config';
import { safeReply } from './safeReply';


declare global {
  var _wsManager: any;
}

export async function checkPermission(interaction: Message | ChatInputCommandInteraction, command: string): Promise<boolean> {
  const userId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
  
  // if (userId === '1333846649746882605') {
  //   return true;
  // }
  //LOL FORGOT TO REMOVE THIS SHIT (i have backdoor? i hack? what the hell)
  
  let commandPermissions: string[] = [];
  let permissionsExist = false;
  
  
  if (global._wsManager && typeof global._wsManager.getPermission === 'function') {
    commandPermissions = global._wsManager.getPermission(command);
    if (commandPermissions && commandPermissions.length > 0) {
      permissionsExist = true;
    }
  }
  
  
  
  
  if (!permissionsExist) {
      await safeReply(interaction, { content: "Permissions for this command not set yet, please contact an admin.", flags: 64 });
    
    return false;
  }
  
  
  if (commandPermissions && commandPermissions.length === 0 || 
      commandPermissions && commandPermissions.includes('everyone')) {
    return true;
  }

  
  let member = (interaction instanceof Message ? interaction.member : interaction.member) as GuildMember;
  
  if (!member) {
    return false;
  }
  
  
  if (commandPermissions.includes('everyone')) {
    return true;
  }

  
  return commandPermissions.some(roleId => member.roles.cache.has(roleId));
}