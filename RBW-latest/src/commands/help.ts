
import { ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, Message } from 'discord.js';
import config from '../config/config';
import { StringSelectMenuInteraction } from 'discord.js';
import { ButtonInteraction } from 'discord.js';
import fs from 'fs';
import path from 'path';
import pkg from '../../package.json';


async function getCommandCategories() {
  const candidates = [
    path.join(__dirname),
    path.resolve(process.cwd(), 'src', 'commands'),
    path.resolve(process.cwd(), 'dist', 'commands')
  ];

  const baseDir = candidates.find((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });

  if (!baseDir) {
    return {};
  }

  const allEntries = fs.readdirSync(baseDir, { withFileTypes: true });
  const categories = allEntries
    .filter(e => e.isDirectory() && e.name !== '__tests__')
    .map(e => e.name);

  const result: Record<string, string[]> = {};
  for (const cat of categories) {
    const dir = path.join(baseDir, cat);
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.ts') || f.endsWith('.js'));
    } catch {}
    result[cat] = files.map(f => f.replace(/\.(ts|js)$/i, ''));
  }
  return result;
}

function getCommandRoles(cmd: string): string {
  
  let roles: string[] = [];
  
  if (global._wsManager && typeof global._wsManager.getPermission === 'function') {
    roles = global._wsManager.getPermission(cmd);
  }
  

  
  if (roles.length) {
    if (roles.includes('everyone')) {
      return '@everyone';
    } else {
      return roles.map((r: string) => `<@&${r}>`).join(', ');
    }
  } else {
    return 'Not set yet';
  }
}

export async function help(interaction: ChatInputCommandInteraction | Message) {
  try {
    const commandCategories = await getCommandCategories();
    const embed = new EmbedBuilder()
      .setTitle(`Ranked Bedwars System v${pkg.version}`)
      .setDescription('Made by <@919498122940547072> \`Deyo\` and Managed by [Zerocode](https://discord.com/invite/23hPVuuam3) \n\n:star2: Select a category to view commands and their required roles.')
      .setColor('#00AAAA')

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_category')
      .setPlaceholder('Select a category')
      .addOptions(
        Object.keys(commandCategories).map(cat =>
          new StringSelectMenuOptionBuilder().setLabel(cat.charAt(0).toUpperCase() + cat.slice(1)).setValue(cat)
        )
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    if ('reply' in interaction && typeof interaction.reply === 'function') {
      await interaction.reply({ embeds: [embed], components: [row] });
    } else {
      const msg = interaction as Message;
      if (msg.channel && typeof (msg.channel as any).send === 'function') {
        await (msg.channel as any).send({ embeds: [embed], components: [row] });
      }
    }
  } catch (error) {
    console.error('Error in help command:', error);
    
    try {
      if ('isRepliable' in interaction && (interaction as any).isRepliable?.()) {
        if ((interaction as any).replied) {
          await (interaction as any).followUp({ content: 'There was an error loading the help menu. Please try again.', flags: 64 });
        } else if ((interaction as any).deferred) {
          await (interaction as any).editReply({ content: 'There was an error loading the help menu. Please try again.' });
        } else {
          await (interaction as any).reply({ content: 'There was an error loading the help menu. Please try again.', flags: 64 });
        }
      }
    } catch (followUpError) {
      console.error('Error sending followUp:', followUpError);
    }
  }
}

export async function handleHelpMenu(interaction: StringSelectMenuInteraction) {
  try {
    if (!interaction.deferred && typeof interaction.deferUpdate === 'function') {
      await interaction.deferUpdate().catch(() => {});
    }
    
    const commandCategories = await getCommandCategories();
    let category: string | undefined;
    let page = 0;
    if (interaction.values && interaction.values.length > 0) {
      category = interaction.values[0];
    } else if (interaction.customId && interaction.customId.startsWith('help_category:')) {
      const parts = interaction.customId.split(':');
      category = parts[1];
      if (parts.length > 2) page = parseInt(parts[2], 10) || 0;
    } else {
      category = 'admin';
    }

    const commands = commandCategories[category] || [];
    const perPage = 15;
    const totalPages = Math.ceil(commands.length / perPage);
    const start = page * perPage;
    const end = start + perPage;
    const pagedCommands = commands.slice(start, end);

    const embed = new EmbedBuilder()
      .setTitle(`${category.charAt(0).toUpperCase() + category.slice(1)} Commands`)
      .setDescription(
        '\n' +
        pagedCommands.map((cmd) => {
          return `\`/${cmd}\` » Required: ${getCommandRoles(cmd)}`;
        }).join('\n')
      )
      .setColor('#00AAAA');

    embed.setFooter({ text: 'Commands use dynamic permissions from the plugin. Same commands applicable for prefix/message commands.' });
    
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_category')
      .setPlaceholder('Select a category')
      .addOptions(
        Object.keys(commandCategories).map(cat =>
          new StringSelectMenuOptionBuilder().setLabel(cat.charAt(0).toUpperCase() + cat.slice(1)).setValue(cat)
        )
      );
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    let components: any[] = [selectRow];
    if (totalPages > 1) {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`help_prev:${category}:${page}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(`help_next:${category}:${page}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages - 1)
      );
      components.push(row.toJSON());
    }
    
    await interaction.editReply({ embeds: [embed], components }).catch(async (error) => {
      console.error('Failed to update help menu, trying update instead:', error);
      await interaction.update({ embeds: [embed], components }).catch(e => {
        console.error('Failed both editReply and update for help menu:', e);
      });
    });
  } catch (error) {
    console.error('Error in handleHelpMenu:', error);
    try {
      await interaction.editReply({ 
        content: 'There was an error displaying the help menu. Please try again.', 
        components: [] 
      }).catch(() => {});
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
}

export async function handleHelpPagination(interaction: ButtonInteraction) {
  try {
    if (!interaction.deferred && typeof interaction.deferUpdate === 'function') {
      await interaction.deferUpdate().catch(() => {});
    }
    
    const [action, category, pageStr] = interaction.customId.replace('help_', '').split(':');
    const page = parseInt(pageStr, 10) || 0;
    let newPage = page;
    if (action === 'prev') newPage = Math.max(0, page - 1);
    if (action === 'next') newPage = page + 1;
    
    interaction.customId = `help_category:${category}:${newPage}`;
    await handleHelpMenu(interaction as any);
  } catch (error) {
    console.error('Error in handleHelpPagination:', error);
    try {
      await interaction.update({ 
        content: 'There was an error navigating the help pages. Please try again.', 
        components: [] 
      }).catch(() => {});
    } catch (replyError) {
      console.error('Failed to send pagination error message:', replyError);
    }
  }
}