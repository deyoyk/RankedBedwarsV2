
export interface LevelInfo {
  level: number;
  experience: number;
  experienceForCurrentLevel: number;
  experienceForNextLevel: number;
  experienceNeededForNext: number;
  totalExperienceForLevel: number;
}


export function getExperienceForLevel(level: number): number {
  if (level <= 1) return 0;
  
  let totalExp = 0;
  let expIncrement = 100; 
  
  for (let i = 2; i <= level; i++) {
    totalExp += expIncrement;
    expIncrement += 25; 
  }
  
  return totalExp;
}


export function getExperienceForLevelUp(fromLevel: number): number {
  if (fromLevel < 1) return 100;
  
  const baseIncrement = 100;
  const incrementIncrease = 25;
  
  return baseIncrement + (incrementIncrease * (fromLevel - 1));
}


export function getLevelFromExperience(experience: number): number {
  if (experience < 100) return 1;
  
  let level = 1;
  let totalExpNeeded = 0;
  let expIncrement = 100;
  
  while (totalExpNeeded + expIncrement <= experience) {
    totalExpNeeded += expIncrement;
    level++;
    expIncrement += 25;
  }
  
  return level;
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
  levelsGained: number;
} {
  const oldLevel = getLevelFromExperience(oldExperience);
  const newLevel = getLevelFromExperience(newExperience);
  
  return {
    leveledUp: newLevel > oldLevel,
    oldLevel,
    newLevel,
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