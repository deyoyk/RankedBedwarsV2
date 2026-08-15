import mongoose from 'mongoose';
import { generatePunishmentId, cleanupOperation } from '../src/managers/punishmentBase';

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

describe('cleanupOperation', () => {
  jest.useFakeTimers();

  it('removes the operation after the delay', () => {
    const operations = new Map<string, any>();
    operations.set('op1', { status: 'pending' });

    cleanupOperation(operations, 'op1', 1000);
    expect(operations.has('op1')).toBe(true);

    jest.advanceTimersByTime(1100);
    expect(operations.has('op1')).toBe(false);
  });
});
