import { ChatInputCommandInteraction } from 'discord.js';
import { WebSocketManager } from '../websocket/WebSocketManager';

/**
 * Canonical slash-command context passed to every command.
 */
export type CommandInteraction = ChatInputCommandInteraction;

export type BotCommandFn = (
  interaction: CommandInteraction,
  wsManager?: WebSocketManager,
) => Promise<void> | void;

export interface BotCommand {
  name: string;
  description: string;
  execute: BotCommandFn;
}

/**
 * Resolve the active WebSocketManager.
 * Prefers the injected instance, falls back to the global.
 */
export function resolveWsManager(injected?: WebSocketManager): WebSocketManager | undefined {
  if (injected) return injected;
  const g = global as unknown as { _wsManager?: WebSocketManager };
  return g._wsManager;
}

/** Get the invoking user's id. */
export function getInvokerId(interaction: CommandInteraction): string {
  return interaction.user.id;
}
