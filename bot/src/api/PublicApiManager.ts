import cors from 'cors';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { Client } from 'discord.js';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { ApiManager, PUBLIC_API_PREFIX } from './ApiManager';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function isPublicApiPath(path: string): boolean {
  return path === PUBLIC_API_PREFIX || path.startsWith(`${PUBLIC_API_PREFIX}/`);
}

export class PublicApiManager extends ApiManager {
  constructor(client: Client, wsManager: WebSocketManager) {
    super(client, wsManager, {
      routePrefix: PUBLIC_API_PREFIX,
      requireAuth: false,
      mountRoutes: false
    });

    const publicCors = cors();
    const publicLimiter = rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: parseInt(process.env.RBW_PUBLIC_RATE_LIMIT_MAX || '120', 10),
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false, forwardedHeader: false },
      handler: (req, res) => {
        res.status(429).json({ error: 'Too many requests, slow down' });
      }
    });

    const publicStrictLimiter = rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: parseInt(process.env.RBW_PUBLIC_RATE_LIMIT_STRICT_MAX || '30', 10),
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false, forwardedHeader: false },
      handler: (req, res) => {
        res.status(429).json({ error: 'Too many requests, slow down' });
      }
    });

    this.wsManager.app.use((req, res, next) => {
      if (!isPublicApiPath(req.path)) {
        next();
        return;
      }
      publicCors(req, res, next);
    });

    this.wsManager.app.use((req, res, next) => {
      if (!isPublicApiPath(req.path)) {
        next();
        return;
      }
      publicLimiter(req, res, next);
    });

    this.wsManager.app.use((req, res, next) => {
      if (!isPublicApiPath(req.path) || !this.isHeavyEndpoint(req.path)) {
        next();
        return;
      }
      publicStrictLimiter(req, res, next);
    });

    this.setupRoutes();
  }
}
