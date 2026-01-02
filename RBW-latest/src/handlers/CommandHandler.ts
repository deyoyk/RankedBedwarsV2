import { Client, Message, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import config from '../config/config';
import { checkPermission } from '../utils/permissions';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { safeReply } from '../utils/safeReply';

 


export class CommandHandler {
  private client: Client;
  private commands: Map<string, Function>;
  private wsManager: WebSocketManager;

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.wsManager = wsManager;
    this.commands = new Map();
  }

  public registerCommand(name: string, handler: Function) {
    this.commands.set(name, handler);
  }

  public async handleMessage(message: Message) {

    if (message.author.bot || !message.content.startsWith(config.prefix)) return;

    
    if (config.prefixenabled === false) {
      const replyMsg = await message.reply('Oopss! Message commands are disabled at the moment, please use ``/help``. ');
      setTimeout(() => {
        replyMsg.delete().catch(() => {});
      }, 10000);
      return;
    }

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName || !this.commands.has(commandName)) {
      const replyMsg = await message.reply(`Oopss! ${commandName || 'Command'} doesn't exist use \`/help\``);
      setTimeout(() => {
        replyMsg.delete().catch(() => {});
      }, 10000);
      return;
    }

    const command = this.commands.get(commandName)!;

    try {
      if (!await checkPermission(message, commandName)) {
        
        
        
        
        
        const wsPermissions = global._wsManager?.getPermission(commandName) || [];
        const requiredRoles = wsPermissions  || [];
        
        
        if (requiredRoles.length > 0 && !requiredRoles.includes('everyone')) {
          const embed = new EmbedBuilder()
            .setColor('#00AAAA')
            .setTitle('You do not have permission')
            .setDescription(`Roles required: ${requiredRoles.map((roleId: string) => `<@&${roleId}>`).join(', ')}`)
            .setTimestamp();

          await message.reply({ embeds: [embed] });
        }
        return;
      }
      await command(message, args, this.wsManager);
    } catch (error) {
      console.error(`Error executing command ${commandName}:`, error);
      await message.reply('There was an error executing this command.');
    }
  }

  public async handleInteraction(interaction: ChatInputCommandInteraction) {
    const commandName = interaction.commandName;

    if (!this.commands.has(commandName)) return;

    const command = this.commands.get(commandName)!;

    try {
      
      if (commandName !== 'help' && commandName !== 'screenshare' && !interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferReply(); 
        } catch (deferError) {
          console.error(`Error deferring reply for ${commandName}:`, deferError);
          
        }
      }

      if (!await checkPermission(interaction, commandName)) {
        const wsPermissions = global._wsManager?.getPermission(commandName) || [];
        const requiredRoles = wsPermissions || [];

        if (requiredRoles.length > 0 && !requiredRoles.includes('everyone')) {
          const embed = new EmbedBuilder()
            .setColor('#00AAAA')
            .setTitle('You do not have permission')
            .setDescription(`Roles required: ${requiredRoles.map((roleId: string) => `<@&${roleId}>`).join(', ')}`)
            .setTimestamp();

          await safeReply(interaction, { embeds: [embed] });
          return;
        }
        return;
      }
      
      await command(interaction, undefined, this.wsManager);
    } catch (error) {
      console.error(`Error executing slash command ${commandName}:`, error);
      
    }
  }
}