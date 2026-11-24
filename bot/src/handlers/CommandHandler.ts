import { ChatInputCommandInteraction, Client } from 'discord.js';
import { checkPermission } from '../utils/permissions';
import { PermissionService } from '../services/PermissionService';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { safeReply } from '../utils/safeReply';
import { replyCommandError } from '../utils/errorReporter';
import type { BotCommandFn } from '../types/commands';
import { embedsFor } from '../utils/betterembed';
import { auditInteractionContext, auditTargetFromOptions, describeCommandOptions, recordAudit } from '../services/AuditService';

const { errorEmbed } = embedsFor('Error');

export type CommandFn = BotCommandFn;

const REPLIES_ITSELF = new Set(['screenshare', 'rbwconfig']);
const PRIVATE_REPLY = new Set(['history', 'resetdb', 'punishment']);

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
    const requiredRoles = PermissionService.rolesFor(commandName);

    if (requiredRoles.length > 0 && !requiredRoles.includes('everyone')) {
      const embed = errorEmbed(
        `You can't use \`/${commandName}\`.\n> **Missing:** ${requiredRoles.map((roleId: string) => `<@&${roleId}>`).join(' ')}`,
        'Permission Denied'
      ).builder;

      await safeReply(interaction, { embeds: [embed], flags: 64 });
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
    const startedAt = Date.now();
    const context = auditInteractionContext(interaction);
    const target = auditTargetFromOptions(interaction);
    const base = {
      ...context,
      ...(target ? { targetType: target.targetType, targetId: target.targetId, targetName: target.targetName } : {}),
      commandName,
      category: 'command',
      source: 'discord' as const,
      metadata: { options: describeCommandOptions(interaction) },
    };

    try {
      if (!(await checkPermission(interaction, commandName))) {
        await recordAudit({
          ...base,
          action: 'command.denied',
          success: false,
          error: 'Permission denied',
          metadata: { ...base.metadata, requiredRoles: PermissionService.rolesFor(commandName) },
        });
        await this.sendPermissionDenied(interaction, commandName);
        return;
      }

      if (
        !REPLIES_ITSELF.has(commandName) &&
        !interaction.deferred &&
        !interaction.replied
      ) {
        try {
          await interaction.deferReply(PRIVATE_REPLY.has(commandName) ? { flags: 64 } : undefined);
        } catch (deferError) {
          const code = (deferError as { code?: unknown })?.code;
          if (code === 10062) {
            console.warn(
              `[CommandHandler] Interaction for /${commandName} expired before acknowledgement; skipping command`
            );
            await recordAudit({
              ...base,
              action: 'command.expired',
              success: false,
              error: 'Interaction expired before acknowledgement',
            });
            return;
          }
          console.error(
            `Error deferring reply for ${commandName}:`,
            deferError
          );
        }
      }

      await command(interaction, this.wsManager);
      await recordAudit({
        ...base,
        action: 'command.execute',
        success: true,
        metadata: { ...base.metadata, durationMs: Date.now() - startedAt },
      });
    } catch (error) {
      await recordAudit({
        ...base,
        action: 'command.failed',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { ...base.metadata, durationMs: Date.now() - startedAt },
      });
      await replyCommandError(
        interaction,
        error,
        `run /${commandName}`,
        `command:${commandName}`
      );
    }
  }
}
