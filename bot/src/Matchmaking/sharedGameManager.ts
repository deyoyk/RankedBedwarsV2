import type { Client } from 'discord.js';
import { GameManager } from './GameManager';
import type { WebSocketManager } from '../websocket/WebSocketManager';

type GameManagerHolder = {
  getGameManager?: () => unknown;
};

function isGameManager(value: unknown): value is GameManager {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameManager>;
  return typeof candidate.scoreGame === 'function'
    && typeof candidate.voidGame === 'function';
}

/**
 * Returns the single process-wide GameManager.
 *
 * Commands used to construct their own GameManager, which re-registered the
 * global warp handlers on the WebSocket manager. That left pending warps
 * handled by an instance with empty state, and it also skipped voice-channel
 * cleanup because the throw-away instance had no active game resources.
 */
export function getSharedGameManager(client: Client, wsManager: WebSocketManager): GameManager {
  const holder = wsManager as unknown as GameManagerHolder;
  if (typeof holder.getGameManager === 'function') {
    const existing = holder.getGameManager();
    if (isGameManager(existing)) return existing;
  }

  const globalManager = (global as unknown as { _gameManager?: unknown })._gameManager;
  if (isGameManager(globalManager)) return globalManager;

  const created = new GameManager(client, wsManager);
  (global as unknown as { _gameManager?: GameManager })._gameManager = created;
  try {
    wsManager.setGameManager(created);
  } catch {
  }
  return created;
}
