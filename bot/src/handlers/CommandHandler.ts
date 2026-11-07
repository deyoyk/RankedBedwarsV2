
import { Client, Message, ChatInputCommandInteraction } from 'discord.js';

import config from '../config/config';
import { checkPermission } from '../utils/permissions';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { safeReply } from '../utils/safeReply';

import type { BotCommandFn } from '../types/commands';
import { themedEmbed } from '../utils/betterembed';

export type CommandFn = BotCommandFn;

export class CommandHandler {
  private client: Client;
  private commands: Map<string, CommandFn>;
  private aliases: Map<string, string>;
  private wsManager: WebSocketManager;
  private readonly handledInteractions = new Set<string>();
  private readonly MAX_HANDLED_INTERACTIONS = 2000;

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.wsManager = wsManager;
    this.commands = new Map();
    this.aliases = new Map();
  }

  public registerCommand(name: string, handler: CommandFn): void {
    const commandName = name.toLowerCase();

    this.commands.set(commandName, handler);
  }


  public registerAlias(alias: string, commandName: string): void {
    const normalizedAlias = alias.toLowerCase();
    const normalizedCommand = commandName.toLowerCase();

    if (!this.commands.has(normalizedCommand)) {
      throw new Error(
        `Cannot register alias "${alias}": command "${commandName}" does not exist.`
      );
    }

    if (this.commands.has(normalizedAlias)) {
      throw new Error(
        `Cannot register alias "${alias}": that name is already a command.`
      );
    }

    if (normalizedAlias === normalizedCommand) {
      throw new Error(
        `Cannot register alias "${alias}": an alias cannot reference itself.`
      );
    }

    this.aliases.set(normalizedAlias, normalizedCommand);
  }

  private resolveCommandName(name: string): string {
    const normalizedName = name.toLowerCase();

    return this.aliases.get(normalizedName) ?? normalizedName;
  }

  private async sendPermissionDenied(
    target: Message | ChatInputCommandInteraction,
    commandName: string
  ): Promise<void> {
    const wsPermissions =
      global._wsManager?.getPermission(commandName) ?? [];

    const requiredRoles = wsPermissions;

    if (
      requiredRoles.length > 0 &&
      !requiredRoles.includes('everyone')
    ) {
      const embed = themedEmbed()
        .setColor('#00AAAA')
        .setTitle('You do not have permission')
        .setDescription(
          `Roles required: ${requiredRoles
            .map((roleId: string) => `<@&${roleId}>`)
            .join(', ')}`
        )
        .setTimestamp();

      if (target instanceof Message) {
        await target.reply({ embeds: [embed] });
      } else {
        await safeReply(target, { embeds: [embed] });
      }
    }
  }

  public async handleMessage(message: Message): Promise<void> {
    if (
      message.author.bot ||
      !message.content.startsWith(config.prefix)
    ) {
      return;
    }

    if (config.prefixenabled === false) {
      const replyMsg = await message.reply(
        'Oopss! Message commands are disabled at the moment, please use `/help`.'
      );

      setTimeout(() => {
        replyMsg.delete().catch(() => {});
      }, 10000);

      return;
    }

    const args = message.content
      .slice(config.prefix.length)
      .trim()
      .split(/ +/);

    const inputName = args.shift()?.toLowerCase();

    if (!inputName) {
      return;
    }


    const commandName = this.resolveCommandName(inputName);
    const command = this.commands.get(commandName);

    if (!command) {
      const replyMsg = await message.reply(
        `Oopss! ${inputName} doesn't exist use \`/help\``
      );

      setTimeout(() => {
        replyMsg.delete().catch(() => {});
      }, 10000);

      return;
    }

    try {
      if (!(await checkPermission(message, commandName))) {
        await this.sendPermissionDenied(message, commandName);
        return;
      }

      await command(message, args, this.wsManager);
    } catch (error) {
      console.error(
        `Error executing command ${commandName}:`,
        error
      );

      await message.reply(
        'There was an error executing this command.'
      );
    }
  }

  public async handleInteraction(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const commandName = interaction.commandName.toLowerCase();

    const interactionId = interaction.id;
    if (interactionId) {
      if (this.handledInteractions.has(interactionId)) {
        console.warn(`[CommandHandler] Ignoring duplicate interaction ${interactionId} for /${commandName}`);
        return;
      }
      this.handledInteractions.add(interactionId);
      if (this.handledInteractions.size > this.MAX_HANDLED_INTERACTIONS) {
        const oldest = this.handledInteractions.values().next();
        if (!oldest.done) this.handledInteractions.delete(oldest.value);
      }
    }

    if (!this.commands.has(commandName)) {
      return;
    }

    const command = this.commands.get(commandName)!;

    try {
      if (
        commandName !== 'help' &&
        commandName !== 'screenshare' &&
        !interaction.deferred &&
        !interaction.replied
      ) {
        try {
          await interaction.deferReply();
        } catch (deferError) {
          const code = (deferError as { code?: unknown })?.code;
          if (code === 10062) {
            console.warn(
              `[CommandHandler] Interaction for /${commandName} expired before acknowledgement; skipping command`
            );
            return;
          }
          console.error(
            `Error deferring reply for ${commandName}:`,
            deferError
          );
        }
      }

      if (!(await checkPermission(interaction, commandName))) {
        await this.sendPermissionDenied(
          interaction,
          commandName
        );
        return;
      }

      await command(
        interaction,
        undefined,
        this.wsManager
      );
    } catch (error) {
      console.error(
        `Error executing slash command ${commandName}:`,
        error
      );

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(
            'Something went wrong running that command.'
          );
        }
      } catch {
      }
    }
  }
}
