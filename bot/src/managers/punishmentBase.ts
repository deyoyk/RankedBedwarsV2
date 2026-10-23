import { randomBytes } from 'crypto';
import User, { IUser } from '../models/User';

export function generatePunishmentId(): string {
  return randomBytes(12).toString('hex');
}

export async function fetchUserWithTimeout(discordId: string, timeoutMs = 5000): Promise<IUser | null> {
  const userPromise: Promise<IUser | null> = Promise.resolve().then(() => User.findOne({ discordId }));
  const timeoutPromise = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error('Database timeout')), timeoutMs)
  );
  return Promise.race([userPromise, timeoutPromise]);
}

export function cleanupOperation(
  operations: Map<string, unknown>,
  operationId: string,
  delayMs = 5 * 60 * 1000
): void {
  setTimeout(() => {
    operations.delete(operationId);
  }, delayMs);
}
