import { ChatInputCommandInteraction, Message } from 'discord.js';
import { WebSocketManager } from '../websocket/WebSocketManager';

/**
 * Canonical command context passed to every command.
 * Keeps business logic identical while giving every file the same shape.
 */
export type CommandInteraction = Message | ChatInputCommandInteraction;

export type BotCommandFn = (
  interaction: CommandInteraction,
  args?: string[],
  wsManager?: WebSocketManager,
) => Promise<void> | void;

export interface BotCommand {
  name: string;
  description: string;
  execute: BotCommandFn;
}

/**
 * Resolve the active WebSocketManager.
 * Prefers the injected instance, falls back to the global for legacy call sites.
 */
export function resolveWsManager(injected?: WebSocketManager): WebSocketManager | undefined {
  if (injected) return injected;
  const g = global as unknown as { _wsManager?: WebSocketManager };
  return g._wsManager;
}

/** Get the invoking user's id regardless of interaction type. */
export function getInvokerId(interaction: CommandInteraction): string {
  return interaction instanceof ChatInputCommandInteraction
    ? interaction.user.id
    : interaction.author.id;
}
