import { Events, GuildMember, EmbedBuilder, Client } from 'discord.js';
import User from '../models/User';
import { fix } from '../utils/fix';
import config from '../config/config';

export class GuildJoinListener {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
    this.setupListener();
  }

  private setupListener() {
    this.client.on(Events.GuildMemberAdd, this.handleGuildMemberAdd.bind(this));
  }

  private async handleGuildMemberAdd(member: GuildMember) {
    try {
      console.log(`[GuildJoinListener] User ${member.user.tag} (${member.id}) joined the server`);
      
      const user = await User.findOne({ discordId: member.id });
      
      if (user) {
        console.log(`[GuildJoinListener] User ${member.user.tag} exists in database, sending welcome back embed`);
        
        const embed = new EmbedBuilder()
          .setTitle('Welcome Back!')
          .setDescription(`Hey <@${member.id}>, it's not your first time being in this server, lemme fix your roles`)
          .setColor('#00ff00')
          .setTimestamp();
        
        try {
          const alertsChannel = member.guild.channels.cache.get(config.channels.alertsChannel);
          if (alertsChannel && alertsChannel.isTextBased()) {
            await alertsChannel.send({ embeds: [embed] });
          }
        } catch (error) {
          console.error(`[GuildJoinListener] Failed to send embed to alerts channel:`, error);
        }
      } else {
        console.log(`[GuildJoinListener] User ${member.user.tag} is new to the server`);
      }
      
      await fix(member.guild, member.id);
      console.log(`[GuildJoinListener] Fixed roles and nickname for ${member.user.tag}`);
      
    } catch (error) {
      console.error(`[GuildJoinListener] Error handling guild member add for ${member.user.tag}:`, error);
    }
  }
}