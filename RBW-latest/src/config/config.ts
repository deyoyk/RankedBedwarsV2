import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export interface Config {
  embed?: {
    defaultText?: string;
    defaultColor?: string;
    defaultTitle?: string;
    defaultEphemeral?: boolean;
    defaultFooter?: string;
    errorText?: string;
    errorColor?: string;
    errorTitle?: string;
    errorEphemeral?: boolean;
    errorFooter?: string;
    successText?: string;
    successColor?: string;
    successTitle?: string;
    successEphemeral?: boolean;
    successFooter?: string;
  };
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
  apiport: string;
  CommonPartySize: number;
  PartyQueueSize: number;

  strikes: {
    [key: string]: string;
  };
}


// Dynamic worker token detection
const workerTokens: string[] = [];
let i = 1;
while (process.env[`WORKER_TOKEN_${i}`]) {
  workerTokens.push(process.env[`WORKER_TOKEN_${i}`]!);
  i++;
}

const configuration: Config = {
  embed: {
    defaultText: process.env.EMBED_DEFAULT_TEXT ?? ' ',
    defaultColor: process.env.EMBED_DEFAULT_COLOR ?? '#00AAAA',
    defaultTitle: process.env.EMBED_DEFAULT_TITLE ?? 'Notice',
    defaultEphemeral: process.env.EMBED_DEFAULT_EPHEMERAL === 'true',
    defaultFooter: process.env.EMBED_DEFAULT_FOOTER ?? 'Deyo.lol',
    errorText: process.env.EMBED_ERROR_TEXT ?? '',
    errorColor: process.env.EMBED_ERROR_COLOR ?? '#00AAAA',
    errorTitle: process.env.EMBED_ERROR_TITLE ?? 'Error',
    errorEphemeral: process.env.EMBED_ERROR_EPHEMERAL === 'true',
    errorFooter: process.env.EMBED_ERROR_FOOTER ?? 'Deyo.lol',
    successText: process.env.EMBED_SUCCESS_TEXT ?? '',
    successColor: process.env.EMBED_SUCCESS_COLOR ?? '#00ff00',
    successTitle: process.env.EMBED_SUCCESS_TITLE ?? 'Success',
    successEphemeral: process.env.EMBED_SUCCESS_EPHEMERAL === 'true',
    successFooter: process.env.EMBED_SUCCESS_FOOTER ?? 'Deyo.lol',
  },
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  prefixenabled: process.env.PREFIX_ENABLED === 'true',
  prefix: process.env.PREFIX || '=',
  workers: {
    enabled: process.env.WORKERS_ENABLED === 'true',
    tokens: workerTokens
  },
  categories: {
    gameCategory: process.env.GAME_CATEGORY_ID || '',
    voiceCategory: process.env.VOICE_CATEGORY_ID || '',
    screenshareCategory: process.env.SCREEN_SHARE_CATEGORY_ID || '',
  },
  channels: {
    gamesChannel: process.env.GAMES_CHANNEL_ID || '',
    scoringChannel: process.env.SCORING_CHANNEL_ID || '',
    voidingChannel: process.env.VOIDING_CHANNEL_ID || '',
    alertsChannel: process.env.ALERTS_CHANNEL_ID || '',
    punishmentsChannel: process.env.PUNISHMENTS_CHANNEL_ID || '',
    strikerequestsChannel: process.env.STRIKE_REQUESTS_CHANNEL_ID || '',
    voidrequestsChannel: process.env.VOID_REQUESTS_CHANNEL_ID || '',
    screensharerequestsChannel: process.env.SCREEN_SHARE_REQUESTS_CHANNEL_ID || '',
    botstatusChannel: process.env.BOT_STATUS_CHANNEL_ID || '',
  },
  voicechannels: {
    waitingvc: process.env.WAITING_ROOM_ID || '',
  },
  roles: {
    registered: process.env.REGISTERED_ROLE_ID || '',
    nonRegistered: process.env.NON_REGISTERED_ROLE_ID || '',
    banned: process.env.BANNED_ROLE_ID || '',
    frozen: process.env.FROZEN_ROLE_ID || '',
    screensharer: process.env.SCREEN_SHARER_ROLE_ID || '',
    muted: process.env.MUTED_ROLE_ID || '',
    partyof2Queue: process.env.PARTY_OF_2_ROLE_ID || '',
    partyof3Queue: process.env.PARTY_OF_3_ROLE_ID || '',
    partyof4Queue: process.env.PARTY_OF_4_ROLE_ID || '',
  },
  mongoUri: process.env.MONGO_URI || 'dedass',
  dbname: process.env.DBNAME || 'ayorrbw',
  websocketport: process.env.WEBSOCKETPORT || '25565',
  apiport: process.env.APIPORT || '3000',
  CommonPartySize: parseInt(process.env.COMMON_PARTY_SIZE || '4', 10),
  PartyQueueSize: parseInt(process.env.PARTY_QUEUE_SIZE || '4', 10),
  strikes: {
    1: 'warn',
    2: '10h',
    3: '1d',
    4: '7d',
    default: 'warn'
  },
};

export default configuration;