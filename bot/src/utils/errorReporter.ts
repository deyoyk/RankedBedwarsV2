import { randomUUID } from 'crypto';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import { embedsFor } from './betterembed';
import { safeReply } from './safeReply';

const { errorEmbed } = embedsFor('Error');
const originalConsoleError = console.error.bind(console);

const MAX_QUEUE_SIZE = 50;
const DEDUPE_WINDOW_MS = 30_000;
const DEFAULT_WEBHOOK_INTERVAL_MS = 2_000;

interface ErrorReport {
  id: string;
  context: string;
  error: unknown;
  at: Date;
}

const queue: ErrorReport[] = [];
const recentReports = new Map<string, number>();
let draining = false;
let installed = false;

function newErrorId(): string {
  return randomUUID().slice(0, 8);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return 'Unknown error';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getErrorStack(error: unknown): string | null {
  if (error instanceof Error && error.stack) return error.stack;
  return null;
}

function redact(value: string): string {
  return value
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, 'mongodb://[redacted]')
    .replace(/(token|password|passwd|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function isNodeWarning(value: string): boolean {
  return /DeprecationWarning|ExperimentalWarning|\[DEP\d+\]|punycode module is deprecated|trace-deprecation|trace-warnings/i.test(value);
}

function webhookIntervalMs(): number {
  const parsed = parseInt(process.env.ERROR_WEBHOOK_INTERVAL_MS || '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_WEBHOOK_INTERVAL_MS;
}

function webhookUrl(): string {
  return (process.env.ERROR_WEBHOOK_URL || '').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendReport(report: ErrorReport): Promise<void> {
  const url = webhookUrl();
  if (!url) return;

  const message = redact(getErrorMessage(report.error));
  const stack = getErrorStack(report.error);
  const description = stack
    ? `**${message}**\n\`\`\`\n${redact(stack)}\n\`\`\``
    : `**${message}**`;

  const payload = {
    username: 'RankedBedwars Errors',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: truncate(`Bot Error — ${report.context}`, 256),
      description: truncate(description, 4_000),
      color: 0xed4245,
      timestamp: report.at.toISOString(),
      footer: { text: `Error ID: ${report.id}` }
    }]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      originalConsoleError(`[errorReporter] Webhook responded with ${response.status}`);
    }
  } catch (error) {
    originalConsoleError('[errorReporter] Could not send error to webhook:', error);
  }
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const report = queue.shift()!;
      await sendReport(report);
      if (queue.length > 0) await sleep(webhookIntervalMs());
    }
  } finally {
    draining = false;
  }
}

function enqueueReport(report: ErrorReport): void {
  if (!webhookUrl()) return;

  const key = `${report.context}:${getErrorMessage(report.error)}`;
  const now = Date.now();
  const lastSent = recentReports.get(key);
  if (lastSent !== undefined && now - lastSent < DEDUPE_WINDOW_MS) return;
  recentReports.set(key, now);

  if (recentReports.size > 200) {
    for (const [existingKey, timestamp] of recentReports) {
      if (now - timestamp >= DEDUPE_WINDOW_MS) recentReports.delete(existingKey);
    }
  }

  if (queue.length >= MAX_QUEUE_SIZE) queue.shift();
  queue.push(report);
  void drainQueue();
}

export function reportError(context: string, error: unknown): string {
  const report: ErrorReport = {
    id: newErrorId(),
    context,
    error,
    at: new Date()
  };
  originalConsoleError(context, error);
  if (!isNodeWarning(`${context} ${getErrorMessage(error)}`)) {
    enqueueReport(report);
  }
  return report.id;
}

export function installErrorReporting(): void {
  if (installed) return;
  installed = true;

  const patched: typeof console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    const [first, ...rest] = args;
    const context = typeof first === 'string' ? first : 'Unhandled error';
    const error = rest.length === 0 ? first : rest.length === 1 ? rest[0] : rest;
    if (!isNodeWarning(`${context} ${getErrorMessage(error)}`)) {
      enqueueReport({ id: newErrorId(), context, error, at: new Date() });
    }
  };
  console.error = patched;
}

export function formatCommandError(action: string, error: unknown, errorId: string): string {
  return `Could not ${action}.\n> **Reason:** ${redact(getErrorMessage(error))}\n-# Error ID: \`${errorId}\``;
}

export function commandErrorDetails(
  action: string,
  error: unknown,
  context: string
): { id: string; description: string } {
  const id = reportError(context, error);
  return { id, description: formatCommandError(action, error, id) };
}

export async function replyCommandError(
  interaction: ChatInputCommandInteraction | Message,
  error: unknown,
  action: string,
  context: string
): Promise<void> {
  const { description } = commandErrorDetails(action, error, context);
  try {
    await safeReply(interaction, {
      embeds: [errorEmbed(description, 'Command Error').builder]
    });
  } catch (replyError) {
    reportError(`${context} (reply)`, replyError);
  }
}
