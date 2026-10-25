import { randomBytes } from 'crypto';

export function generatePunishmentId(): string {
  return randomBytes(12).toString('hex');
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
