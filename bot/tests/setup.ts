process.env.AUTH_KEY = '';
process.env.DISCORD_TOKEN = '';
process.env.CLIENT_ID = '123456789012345678';
process.env.GUILD_ID = '1272163435467243612';
process.env.MONGO_URI = '';
process.env.WEBSOCKETPORT = '25530';
process.env.MAP_SELECTION_ENABLED = 'false';
process.env.ERROR_WEBHOOK_URL = '';
process.env.ERROR_WEBHOOK_INTERVAL_MS = '0';
process.env.PPP_API_URL = '';
process.env.PPP_API_KEY = '';

jest.mock('../src/models/GameSettlement', () => ({
  __esModule: true,
  default: {
    updateOne: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }),
  },
}));

jest.mock('../src/models/PickingSessionState', () => ({
  __esModule: true,
  default: {
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }),
  },
}));

jest.mock('../src/models/AuditLog', () => ({
  __esModule: true,
  default: {
    create: jest.fn().mockResolvedValue({}),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
  },
}));
