import { randomInt } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
export const LINK_CODE_TTL = 5 * 60 * 1000;
export const MAX_WRONG_CODES = 5;
export const WRONG_CODE_WINDOW = 10 * 60 * 1000;

export type LinkClaim = { ign: string } | { error: 'invalid' | 'locked' };

export class LinkCodes {
  private readonly byCode = new Map<string, { ign: string; expiresAt: number }>();
  private readonly wrong = new Map<string, { count: number; since: number }>();

  create(ign: string, now = Date.now()): string {
    const key = ign.toLowerCase();
    for (const [code, pending] of this.byCode) {
      if (pending.expiresAt <= now || pending.ign.toLowerCase() === key) {
        this.byCode.delete(code);
      }
    }
    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    } while (this.byCode.has(code));
    this.byCode.set(code, { ign, expiresAt: now + LINK_CODE_TTL });
    return code;
  }

  claim(input: string, discordId: string, now = Date.now()): LinkClaim {
    const tries = this.wrong.get(discordId);
    if (tries && now - tries.since >= WRONG_CODE_WINDOW) {
      this.wrong.delete(discordId);
    } else if (tries && tries.count >= MAX_WRONG_CODES) {
      return { error: 'locked' };
    }
    const code = input.trim().replace(/^\/?link\s+/i, '').replace(/^code:\s*/i, '').toUpperCase();
    const pending = this.byCode.get(code);
    if (pending && pending.expiresAt > now) {
      this.byCode.delete(code);
      this.wrong.delete(discordId);
      return { ign: pending.ign };
    }
    const current = this.wrong.get(discordId);
    this.wrong.set(discordId, { count: (current?.count ?? 0) + 1, since: current?.since ?? now });
    return { error: 'invalid' };
  }
}

export const linkCodes = new LinkCodes();
