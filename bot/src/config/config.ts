import { config as dotenvConfig } from 'dotenv';
import { parseDuration } from '../utils/parseDuration';

dotenvConfig();

const clean = (v: string | undefined): string => (v ?? '').trim();

export function isSnowflake(v: string): boolean {
  return /^\d{17,20}$/.test(v);
}

export function parseStatResetRoles(raw: string | undefined): Record<string, number> {
  const roles: Record<string, number> = {};
  if (!raw) return roles;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(':');
    if (idx <= 0) continue;
    const roleId = trimmed.slice(0, idx).trim();
    const count = parseInt(trimmed.slice(idx + 1).trim(), 10);
    if (!isSnowflake(roleId) || !Number.isInteger(count) || count <= 0) continue;
    roles[roleId] = count;
  }
  return roles;
}

export function parseStatResetScope(raw: string | undefined): 'season' | 'days' {
  return clean(raw).toLowerCase() === 'days' ? 'days' : 'season';
}

export function parseEloClaimRoles(raw: string | undefined): Record<string, number> {
  const roles: Record<string, number> = {};
  if (!raw) return roles;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(':');
    if (idx <= 0) continue;
    const roleId = trimmed.slice(0, idx).trim();
    const amount = parseInt(trimmed.slice(idx + 1).trim(), 10);
    if (!isSnowflake(roleId) || !Number.isInteger(amount) || amount <= 0) continue;
    roles[roleId] = amount;
  }
  return roles;
}

export function validateEloClaimRolesRaw(raw: string | undefined): string[] {
  const errors: string[] = [];
  if (!raw?.trim()) return errors;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(':');
    if (idx <= 0) {
      errors.push(`ELO_CLAIM_ROLES entry "${trimmed}" must be roleId:elo`);
      continue;
    }
    const roleId = trimmed.slice(0, idx).trim();
    const amount = parseInt(trimmed.slice(idx + 1).trim(), 10);
    if (!isSnowflake(roleId)) errors.push(`ELO_CLAIM_ROLES role "${roleId}" is not a valid Discord snowflake`);
    if (!Number.isInteger(amount) || amount <= 0) errors.push(`ELO_CLAIM_ROLES entry "${trimmed}" must have a positive ELO amount`);
  }
  return errors;
}

export function validateStatResetRolesRaw(raw: string | undefined): string[] {
  const errors: string[] = [];
  if (!raw?.trim()) return errors;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(':');
    if (idx <= 0) {
      errors.push(`STAT_RESET_ROLES entry "${trimmed}" must be roleId:resets`);
      continue;
    }
    const roleId = trimmed.slice(0, idx).trim();
    const count = parseInt(trimmed.slice(idx + 1).trim(), 10);
    if (!isSnowflake(roleId)) errors.push(`STAT_RESET_ROLES role "${roleId}" is not a valid Discord snowflake`);
    if (!Number.isInteger(count) || count <= 0) errors.push(`STAT_RESET_ROLES entry "${trimmed}" must have a positive resets count`);
  }
  return errors;
}

export function validateConfig(cfg: Config): string[] {
  const errors: string[] = [];
  if (!cfg.token) errors.push('DISCORD_TOKEN is required');
  if (!cfg.clientId || !isSnowflake(cfg.clientId)) errors.push('CLIENT_ID must be a Discord application ID (17-20 digits)');
  if (!cfg.guildId || !isSnowflake(cfg.guildId)) errors.push('GUILD_ID must be a Discord server ID (17-20 digits)');
  if (!process.env.AUTH_KEY || !process.env.AUTH_KEY.trim()) errors.push('AUTH_KEY is required (must match plugin websocket.auth_key)');
  if (!cfg.mongoUri || cfg.mongoUri === 'dedass') errors.push('MONGO_URI is required (no default)');
  const port = parseInt(cfg.websocketport, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('WEBSOCKETPORT must be 1-65535');
  for (const [k, v] of Object.entries(cfg.roles)) {
    if (v && !isSnowflake(v)) errors.push(`Role ${k} is not a valid Discord snowflake: ${v}`);
  }
  for (const [k, v] of Object.entries({ ...cfg.channels, ...cfg.categories, waitingvc: cfg.voicechannels.waitingvc })) {
    if (v && !isSnowflake(v)) errors.push(`Channel/category ${k} is not a valid Discord snowflake: ${v}`);
  }
  errors.push(...validateStatResetRolesRaw(process.env.STAT_RESET_ROLES));
  errors.push(...validateEloClaimRolesRaw(process.env.ELO_CLAIM_ROLES));
  const scopeRaw = clean(process.env.STAT_RESET_SCOPE).toLowerCase();
  if (scopeRaw && scopeRaw !== 'season' && scopeRaw !== 'days') errors.push('STAT_RESET_SCOPE must be "season" or "days"');
  const daysRaw = clean(process.env.STAT_RESET_WINDOW_DAYS);
  if (daysRaw) {
    const days = parseInt(daysRaw, 10);
    if (!Number.isInteger(days) || days <= 0) errors.push('STAT_RESET_WINDOW_DAYS must be a positive integer');
  }
  for (const [strike, action] of Object.entries(cfg.strikes ?? {})) {
    if (!action || action === 'warn') continue;
    try {
      parseDuration(action);
    } catch {
      errors.push(`STRIKE_${strike}_DURATION must be "warn", a permanent keyword, or a duration like 2h/12h/48h: ${action}`);
    }
  }
  return errors;
}

interface Config {
  token: string;
  clientId: string;
  guildId: string;
  workers: {
    enabled: boolean;
    tokens: string[];
  };
  categories: {
    gameCategory: string;
    voiceCategory: string;
    screenshareCategory: string;
  };
  channels: {

    gamesChannel: string;
    gameThreadsChannel: string;
    scoringChannel: string;
    voidingChannel: string;
    alertsChannel: string;
    punishmentsChannel: string;
    strikerequestsChannel: string;
    voidrequestsChannel: string;
    screensharerequestsChannel?: string;
    botstatusChannel: string;
  };
  voicechannels: {
    waitingvc: string;
  };
  roles: {
    registered: string;
    nonRegistered: string;
    banned: string;
    frozen: string;
    screensharer: string;
    muted: string;
    partyof2Queue: string;
    partyof3Queue: string;
    partyof4Queue: string;

  };
  mongoUri: string;
  dbname: string;
  websocketport: string;
  CommonPartySize: number;
  PartyQueueSize: number;
  maxMvpsPerGame: number;
  maxBedBreakersPerGame: number;

  strikes: {
    [key: string]: string;
  };
  serverip: string;
  bot_stats_text: string;

  eloDecay: {
    enabled: boolean;
    inactivityDays: number;
    midMin: number;
    midMax: number;
    midAmount: number;
    highMin: number;
    highAmount: number;
    rankGraceDays: number;
  };
  winStreakBonus: {
    enabled: boolean;
    tiers: string;
  };
  bounty: {
    enabled: boolean;
    tiers: string;
  };
  mapFrequency: {
    enabled: boolean;
    lookbackGames: number;
    historySize: number;
    globalWeight: number;
  };
  statReset: {
    roles: Record<string, number>;
    scope: 'season' | 'days';
    windowDays: number;
  };
  eloClaim: {
    roles: Record<string, number>;
  };

}


const workerTokens: string[] = [];
let i = 1;
while (clean(process.env[`WORKER_TOKEN_${i}`])) {
  workerTokens.push(clean(process.env[`WORKER_TOKEN_${i}`]));
  i++;
}

const parsedCommonPartySize = parseInt(clean(process.env.COMMON_PARTY_SIZE) || '8', 10);
const parsedPartyQueueSize = parseInt(clean(process.env.PARTY_QUEUE_SIZE) || '1', 10);

function parsedPositiveInt(raw: string | undefined, fallback: number): number {
  const v = parseInt(clean(raw) || '', 10);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

function parsedNonNegativeInt(raw: string | undefined, fallback: number): number {
  const v = parseInt(clean(raw) || '', 10);
  return Number.isInteger(v) && v >= 0 ? v : fallback;
}

const configuration: Config = {
  token: clean(process.env.DISCORD_TOKEN),
  clientId: clean(process.env.CLIENT_ID),
  guildId: clean(process.env.GUILD_ID),
  workers: {
    enabled: clean(process.env.WORKERS_ENABLED) === 'true',
    tokens: workerTokens
  },
  categories: {
    gameCategory: clean(process.env.GAME_CATEGORY_ID),
    voiceCategory: clean(process.env.VOICE_CATEGORY_ID),
    screenshareCategory: clean(process.env.SCREEN_SHARE_CATEGORY_ID),
  },
  channels: {
    gamesChannel: clean(process.env.GAMES_CHANNEL_ID),
    gameThreadsChannel: clean(process.env.GAME_THREADS_CHANNEL_ID),
    scoringChannel: clean(process.env.SCORING_CHANNEL_ID),
    voidingChannel: clean(process.env.VOIDING_CHANNEL_ID),
    alertsChannel: clean(process.env.ALERTS_CHANNEL_ID),
    punishmentsChannel: clean(process.env.PUNISHMENTS_CHANNEL_ID),
    strikerequestsChannel: clean(process.env.STRIKE_REQUESTS_CHANNEL_ID),
    voidrequestsChannel: clean(process.env.VOID_REQUESTS_CHANNEL_ID),
    screensharerequestsChannel: clean(process.env.SCREEN_SHARE_REQUESTS_CHANNEL_ID),
    botstatusChannel: clean(process.env.BOT_STATUS_CHANNEL_ID),
  },
  voicechannels: {
    waitingvc: clean(process.env.WAITING_ROOM_ID),
  },
  roles: {
    registered: clean(process.env.REGISTERED_ROLE_ID),
    nonRegistered: clean(process.env.NON_REGISTERED_ROLE_ID),
    banned: clean(process.env.BANNED_ROLE_ID),
    frozen: clean(process.env.FROZEN_ROLE_ID),
    screensharer: clean(process.env.SCREEN_SHARER_ROLE_ID),
    muted: clean(process.env.MUTED_ROLE_ID),
    partyof2Queue: clean(process.env.PARTY_OF_2_ROLE_ID),
    partyof3Queue: clean(process.env.PARTY_OF_3_ROLE_ID),
    partyof4Queue: clean(process.env.PARTY_OF_4_ROLE_ID),
  },
  mongoUri: clean(process.env.MONGO_URI),
  dbname: clean(process.env.DBNAME) || 'deyorbw',
  websocketport: clean(process.env.WEBSOCKETPORT) || '25565',
  CommonPartySize: Number.isInteger(parsedCommonPartySize) && parsedCommonPartySize > 0 ? parsedCommonPartySize : 8,
  PartyQueueSize: Number.isInteger(parsedPartyQueueSize) && parsedPartyQueueSize > 0 ? parsedPartyQueueSize : 1,
  maxMvpsPerGame: parsedPositiveInt(process.env.MAX_MVPS_PER_GAME, 1),
  maxBedBreakersPerGame: parsedPositiveInt(process.env.MAX_BED_BREAKERS_PER_GAME, 1),
  strikes: {
    1: clean(process.env.STRIKE_1_DURATION) || 'warn',
    2: clean(process.env.STRIKE_2_DURATION) || '2h',
    3: clean(process.env.STRIKE_3_DURATION) || '12h',
    4: clean(process.env.STRIKE_4_DURATION) || '48h',
    default: clean(process.env.STRIKE_DEFAULT_DURATION) || '48h'
  },
  serverip: clean(process.env.SERVER_IP) || 'play.deyo.lol',
  bot_stats_text: clean(process.env.BOT_STATS_TEXT) || 'DEYO RANKED BEDWARS',
  eloDecay: {
    enabled: clean(process.env.ELO_DECAY_ENABLED) !== 'false',
    inactivityDays: parsedPositiveInt(process.env.ELO_DECAY_INACTIVITY_DAYS, 5),
    midMin: parsedNonNegativeInt(process.env.ELO_DECAY_MID_MIN, 800),
    midMax: parsedNonNegativeInt(process.env.ELO_DECAY_MID_MAX, 1199),
    midAmount: parsedPositiveInt(process.env.ELO_DECAY_MID_AMOUNT, 35),
    highMin: parsedNonNegativeInt(process.env.ELO_DECAY_HIGH_MIN, 1200),
    highAmount: parsedPositiveInt(process.env.ELO_DECAY_HIGH_AMOUNT, 60),
    rankGraceDays: parsedNonNegativeInt(process.env.ELO_DECAY_RANK_GRACE_DAYS, 5),
  },
  winStreakBonus: {
    enabled: clean(process.env.ELO_STREAK_BONUS_ENABLED) !== 'false',
    tiers: clean(process.env.ELO_STREAK_BONUSES) || '10:5,15:10,20:15',
  },
  bounty: {
    enabled: clean(process.env.ELO_BOUNTY_ENABLED) !== 'false',
    tiers: clean(process.env.ELO_BOUNTIES) || '5:5,10:10,15:15,25:20',
  },
  mapFrequency: {
    enabled: clean(process.env.MAP_FREQUENCY_ENABLED) !== 'false',
    lookbackGames: parsedPositiveInt(process.env.MAP_FREQUENCY_LOOKBACK_GAMES, 5),
    historySize: parsedPositiveInt(process.env.MAP_FREQUENCY_HISTORY_SIZE, 50),
    globalWeight: parsedPositiveInt(process.env.MAP_FREQUENCY_GLOBAL_WEIGHT, 1),
  },
  statReset: {
    roles: parseStatResetRoles(process.env.STAT_RESET_ROLES),
    scope: parseStatResetScope(process.env.STAT_RESET_SCOPE),
    windowDays: parsedPositiveInt(process.env.STAT_RESET_WINDOW_DAYS, 30),
  },
  eloClaim: {
    roles: parseEloClaimRoles(process.env.ELO_CLAIM_ROLES),
  },
};

export default configuration;
