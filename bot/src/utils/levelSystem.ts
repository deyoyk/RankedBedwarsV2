
export interface LevelInfo {
  level: number;
  experience: number;
  experienceForCurrentLevel: number;
  experienceForNextLevel: number;
  experienceNeededForNext: number;
  totalExperienceForLevel: number;
}


function getExperienceForLevel(level: number): number {
  if (level <= 1) return 0;
  const n = level - 1;
  return 100 * n + 25 * (n * (n - 1)) / 2;
}


function getLevelFromExperience(experience: number): number {
  if (experience < 100) return 1;
  const n = Math.floor((-175 + Math.sqrt(30625 + 200 * experience)) / 50);
  return Math.max(1, n + 1);
}


export function getLevelInfo(experience: number): LevelInfo {
  const level = getLevelFromExperience(experience);
  const experienceForCurrentLevel = getExperienceForLevel(level);
  const experienceForNextLevel = getExperienceForLevel(level + 1);
  const experienceNeededForNext = experienceForNextLevel - experience;
  const totalExperienceForLevel = experienceForNextLevel - experienceForCurrentLevel;
  
  return {
    level,
    experience,
    experienceForCurrentLevel,
    experienceForNextLevel,
    experienceNeededForNext,
    totalExperienceForLevel
  };
}


export function checkLevelUp(oldExperience: number, newExperience: number): {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  level_before: number;
  level_after: number;
  levelsGained: number;
} {
  const oldLevel = getLevelFromExperience(oldExperience);
  const newLevel = getLevelFromExperience(newExperience);
  
  return {
    leveledUp: newLevel > oldLevel,
    oldLevel,
    newLevel,
    level_before: oldLevel,
    level_after: newLevel,
    levelsGained: newLevel - oldLevel
  };
}


export const EXPERIENCE_REWARDS = {
  WIN: 15,
  LOSS: 5,
  MVP: 10,
  BED_BREAK: 5,
  KILL: 1,
  FINAL_KILL: 2
} as const;