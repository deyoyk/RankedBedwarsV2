import { randomBytes } from 'crypto';

export function generatePunishmentId(): string {
  return randomBytes(12).toString('hex');
}
