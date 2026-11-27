import PartySize from '../models/PartySize';
import config from '../config/config';

export const PARTY_SIZES = [0, 2, 4] as const;

export const PARTY_SIZE_LABELS: Record<number, string> = {
  0: 'Solo season (no parties)',
  2: 'Parties of 2',
  4: 'Parties of 4',
};

export function isPartySize(size: number): boolean {
  return (PARTY_SIZES as readonly number[]).includes(size);
}

export class PartySizeService {
  private static guildId = '';
  private static size: number | null = null;

  static async load(guildId: string): Promise<void> {
    PartySizeService.guildId = guildId;
    const doc = await PartySize.findOne({ guildId }).lean();
    PartySizeService.size = doc && isPartySize(doc.size) ? doc.size : null;
  }

  static current(): number {
    if (PartySizeService.size !== null) {
      return PartySizeService.size;
    }
    return isPartySize(config.partyMaxMembers) ? config.partyMaxMembers : 2;
  }

  static async set(size: number): Promise<number> {
    if (!isPartySize(size)) {
      throw new Error(`Party size must be one of ${PARTY_SIZES.join(', ')}`);
    }
    if (!PartySizeService.guildId) {
      throw new Error('The party size is not loaded yet');
    }
    await PartySize.updateOne({ guildId: PartySizeService.guildId }, { $set: { size } }, { upsert: true });
    PartySizeService.size = size;
    return size;
  }
}
