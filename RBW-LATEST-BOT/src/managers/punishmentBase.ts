import User from '../models/User';

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generatePunishmentId(length = 9): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
  }
  return result;
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
