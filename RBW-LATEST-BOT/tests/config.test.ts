import { isSnowflake, validateConfig } from '../src/config/config';

const base = {
  token: 'tok',
  clientId: '123456789012345678',
  guildId: '1272163435467243612',
  prefixenabled: true,
  prefix: '!',
  workers: { enabled: false, tokens: [] },
  categories: { gameCategory: '', voiceCategory: '', screenshareCategory: '' },
  channels: {
    gamesChannel: '', scoringChannel: '', voidingChannel: '', alertsChannel: '',
    punishmentsChannel: '', strikerequestsChannel: '', voidrequestsChannel: '',
    screensharerequestsChannel: '', botstatusChannel: ''
  },
  voicechannels: { waitingvc: '' },
  roles: {
    registered: '', nonRegistered: '', banned: '', frozen: '',
    screensharer: '', muted: '', partyof2Queue: '', partyof3Queue: '', partyof4Queue: ''
  },
  mongoUri: 'mongodb://127.0.0.1:27017/deyorbw',
  dbname: 'deyorbw',
  websocketport: '25530',
  apiport: '3000',
  CommonPartySize: 8,
  PartyQueueSize: 1,
  strikes: { 1: 'warn', default: 'warn' },
  serverip: 'play.deyo.lol',
  bot_stats_text: 'x'
} as any;

describe('isSnowflake', () => {
  it('accepts 17-20 digits', () => {
    expect(isSnowflake('1272163435467243612')).toBe(true);
  });
  it('rejects concatenated ids and garbage', () => {
    expect(isSnowflake('13525875244757136199999168577543115594')).toBe(false);
    expect(isSnowflake('')).toBe(false);
    expect(isSnowflake('abc')).toBe(false);
  });
});

describe('validateConfig', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env.AUTH_KEY = OLD.AUTH_KEY; });
  it('passes for valid config', () => {
    process.env.AUTH_KEY = 'secret';
    expect(validateConfig(base)).toEqual([]);
  });
  it('flags missing token/auth/mongo and bad snowflakes', () => {
    process.env.AUTH_KEY = '';
    const bad = { ...base, token: '', clientId: 'bad', mongoUri: 'dedass', websocketport: '99999', roles: { ...base.roles, muted: 'notasnowflake' } };
    const errors = validateConfig(bad);
    expect(errors.join('|')).toMatch(/DISCORD_TOKEN/);
    expect(errors.join('|')).toMatch(/CLIENT_ID/);
    expect(errors.join('|')).toMatch(/AUTH_KEY/);
    expect(errors.join('|')).toMatch(/MONGO_URI/);
    expect(errors.join('|')).toMatch(/WEBSOCKETPORT/);
    expect(errors.join('|')).toMatch(/muted/);
  });
});
