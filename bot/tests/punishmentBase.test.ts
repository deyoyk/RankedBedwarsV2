import mongoose from 'mongoose';
import { generatePunishmentId } from '../src/managers/punishmentBase';

describe('generatePunishmentId', () => {
  it('generates a valid mongoose ObjectId', () => {
    const id = generatePunishmentId();
    expect(id).toHaveLength(24);
    expect(mongoose.isValidObjectId(id)).toBe(true);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePunishmentId()));
    expect(ids.size).toBe(1000);
  });
});

