import { getLevelInfo, checkLevelUp, EXPERIENCE_REWARDS } from '../src/utils/levelSystem';

describe('getLevelInfo', () => {
  it('starts at level 1 with no experience', () => {
    const info = getLevelInfo(0);
    expect(info.level).toBe(1);
    expect(info.experienceForCurrentLevel).toBe(0);
  });

  it('levels up after 100 experience (level 2)', () => {
    const info = getLevelInfo(100);
    expect(info.level).toBe(2);
    expect(info.experienceForCurrentLevel).toBe(100);
  });

  it('level 3 requires 225 total experience', () => {
    const info = getLevelInfo(225);
    expect(info.level).toBe(3);
    expect(info.experienceForCurrentLevel).toBe(225);
  });

  it('remaining experience is non-negative', () => {
    for (let exp = 0; exp <= 10000; exp += 37) {
      const info = getLevelInfo(exp);
      expect(info.experienceNeededForNext).toBeGreaterThanOrEqual(0);
      expect(info.totalExperienceForLevel).toBeGreaterThan(0);
    }
  });

  it('never divides by zero', () => {
    const info = getLevelInfo(10000);
    expect(info.totalExperienceForLevel).toBeGreaterThan(0);
  });
});

describe('checkLevelUp', () => {
  it('detects a level up', () => {
    const result = checkLevelUp(0, 250);
    expect(result.leveledUp).toBe(true);
    expect(result.oldLevel).toBe(1);
    expect(result.newLevel).toBe(3);
    expect(result.levelsGained).toBe(2);
  });

  it('reports no level up within the same level', () => {
    const result = checkLevelUp(10, 90);
    expect(result.leveledUp).toBe(false);
    expect(result.levelsGained).toBe(0);
  });

  it('handles exact boundary', () => {
    const result = checkLevelUp(100, 100);
    expect(result.leveledUp).toBe(false);
    expect(result.oldLevel).toBe(2);
  });
});

describe('EXPERIENCE_REWARDS', () => {
  it('has the expected reward values', () => {
    expect(EXPERIENCE_REWARDS.WIN).toBe(15);
    expect(EXPERIENCE_REWARDS.LOSS).toBe(5);
    expect(EXPERIENCE_REWARDS.MVP).toBe(10);
    expect(EXPERIENCE_REWARDS.BED_BREAK).toBe(5);
    expect(EXPERIENCE_REWARDS.KILL).toBe(1);
    expect(EXPERIENCE_REWARDS.FINAL_KILL).toBe(2);
  });
});
