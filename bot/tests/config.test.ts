import { isSnowflake, validateConfig, parseEmbedColor, DEFAULT_EMBED_THEME } from '../src/config/config';

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

describe('parseEmbedColor', () => {
  it('parses hex strings with and without #', () => {
    expect(parseEmbedColor('#3498DB', 0)).toBe(0x3498DB);
    expect(parseEmbedColor('e74c3c', 0)).toBe(0xE74C3C);
    expect(parseEmbedColor('  #2ECC71  ', 0)).toBe(0x2ECC71);
  });

  it('parses decimal values', () => {
    expect(parseEmbedColor('3447003', 0)).toBe(3447003);
    expect(parseEmbedColor('0x3498DB', 0)).toBe(0x3498DB);
  });

  it('falls back for empty or invalid colors', () => {
    expect(parseEmbedColor('', 0x123456)).toBe(0x123456);
    expect(parseEmbedColor(undefined, 0x123456)).toBe(0x123456);
    expect(parseEmbedColor('#GGGGGG', 0x123456)).toBe(0x123456);
    expect(parseEmbedColor('#1234567', 0x123456)).toBe(0x123456);
    expect(parseEmbedColor('-1', 0x123456)).toBe(0x123456);
  });

  it('keeps the documented theme defaults', () => {
    expect(DEFAULT_EMBED_THEME.defaultColor).toBe(0x3498DB);
    expect(DEFAULT_EMBED_THEME.errorColor).toBe(0xE74C3C);
    expect(DEFAULT_EMBED_THEME.successColor).toBe(0x2ECC71);
    expect(DEFAULT_EMBED_THEME.footer).toBe('deyo Ranked Bedwars');
  });
});

describe('validateConfig', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env.AUTH_KEY = OLD.AUTH_KEY;
    if (OLD.ELO_CLAIM_ROLES === undefined) delete process.env.ELO_CLAIM_ROLES;
    else process.env.ELO_CLAIM_ROLES = OLD.ELO_CLAIM_ROLES;
  });
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

  it('accepts warn, permanent and duration strike actions', () => {
    process.env.AUTH_KEY = 'secret';
    expect(validateConfig({
      ...base,
      strikes: { 1: 'warn', 2: '2h', 3: '12h', 4: '48h', default: 'perm' }
    })).toEqual([]);
  });

  it('flags invalid strike durations', () => {
    process.env.AUTH_KEY = 'secret';
    const errors = validateConfig({
      ...base,
      strikes: { 1: 'warn', 2: 'not-a-duration', default: 'warn' }
    });
    expect(errors.join('|')).toMatch(/STRIKE_2_DURATION/);
  });

  it('accepts valid ELO claim roles', () => {
    process.env.AUTH_KEY = 'secret';
    process.env.ELO_CLAIM_ROLES = '1341829830924046346:100,1396112212778684606:300';
    expect(validateConfig(base)).toEqual([]);
  });

  it('flags invalid ELO claim roles', () => {
    process.env.AUTH_KEY = 'secret';
    process.env.ELO_CLAIM_ROLES = 'bad:100,1341829830924046346:0,justarole';
    const errors = validateConfig(base);
    expect(errors.join('|')).toMatch(/ELO_CLAIM_ROLES/);
    expect(errors.join('|')).toMatch(/snowflake/);
    expect(errors.join('|')).toMatch(/positive/);
    expect(errors.join('|')).toMatch(/roleId:elo/);
  });
});
