import { ChatInputCommandInteraction, Client } from 'discord.js';
import { checkPermission } from '../utils/permissions';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { safeReply } from '../utils/safeReply';
import type { BotCommandFn } from '../types/commands';
import { errorEmbed } from '../utils/betterembed';

export type CommandFn = BotCommandFn;

export class CommandHandler {
  private commands: Map<string, CommandFn>;
  private wsManager: WebSocketManager;
  private readonly handledInteractions = new Set<string>();
  private readonly MAX_HANDLED_INTERACTIONS = 2000;

  constructor(_client: Client, wsManager: WebSocketManager) {
    this.wsManager = wsManager;
    this.commands = new Map();
  }

  public registerCommand(name: string, handler: CommandFn): void {
    this.commands.set(name.toLowerCase(), handler);
  }

  private async sendPermissionDenied(
    interaction: ChatInputCommandInteraction,
    commandName: string
  ): Promise<void> {
    const requiredRoles = global._wsManager?.getPermission(commandName) ?? [];

    if (requiredRoles.length > 0 && !requiredRoles.includes('everyone')) {
      const embed = errorEmbed(
        `Roles required: ${requiredRoles.map((roleId: string) => `<@&${roleId}>`).join(', ')}`,
        'Permission Denied'
      ).builder;

      await safeReply(interaction, { embeds: [embed] });
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
        await this.sendPermissionDenied(interaction, commandName);
        return;
      }

      await command(interaction, this.wsManager);
    } catch (error) {
      console.error(
        `Error executing slash command ${commandName}:`,
        error
      );

      try {
        await safeReply(
          interaction,
          errorEmbed(
            'Something went wrong running that command.',
            'Command Error'
          )
        );
      } catch {
      }
    }
  }
}
