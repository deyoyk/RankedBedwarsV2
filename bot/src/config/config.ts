import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const clean = (v: string | undefined): string => (v ?? '').trim();

export function isSnowflake(v: string): boolean {
  return /^\d{17,20}$/.test(v);
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
  return errors;
}

interface Config {
  token: string;
  clientId: string;
  guildId: string;
  prefixenabled?: boolean;
  prefix: string;
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
  prefixenabled: clean(process.env.PREFIX_ENABLED) === 'true',
  prefix: clean(process.env.PREFIX) || '!',
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
    1: 'warn',
    2: '10h',
    3: '1d',
    4: '7d',
    default: 'warn'
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
};

export default configuration;