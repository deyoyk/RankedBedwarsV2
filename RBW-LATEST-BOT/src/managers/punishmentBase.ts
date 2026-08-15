import { randomBytes } from 'crypto';
import User from '../models/User';

export function generatePunishmentId(): string {
  return randomBytes(12).toString('hex');
}

export async function fetchUserWithTimeout(discordId: string, timeoutMs = 5000): Promise<any> {
  const userPromise = User.findOne({ discordId });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Database timeout')), timeoutMs)
  );
  return Promise.race([userPromise, timeoutPromise]);
}

export function cleanupOperation(
  operations: Map<string, any>,
  operationId: string,
  delayMs = 5 * 60 * 1000
): void {
  setTimeout(() => {
    operations.delete(operationId);
  }, delayMs);
}
