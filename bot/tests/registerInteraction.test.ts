const mockFindOne = jest.fn();
const mockCreate = jest.fn();
const mockFix = jest.fn();
const mockRecordAudit = jest.fn();

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

jest.mock('../src/utils/fix', () => ({
  __esModule: true,
  fix: (...args: unknown[]) => mockFix(...args),
}));

jest.mock('../src/services/AuditService', () => ({
  __esModule: true,
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

import { register } from '../src/commands/account/register';

const UID = '123456789012345678';

function userQuery(value: unknown) {
  return {
    collation: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function setup() {
  const handlers: Record<string, (...args: any[]) => unknown> = {};
  const collector: { on: jest.Mock } = { on: jest.fn() };
  collector.on.mockImplementation((event: string, handler: (...args: any[]) => unknown) => {
    handlers[event] = handler;
    return collector;
  });

  const sentMessage = {
    edit: jest.fn().mockResolvedValue(undefined),
    createMessageComponentCollector: jest.fn(() => collector),
  };

  const interaction: any = {
    user: { id: UID, tag: 'Steve#0001' },
    guild: { id: 'guild-1' },
    guildId: 'guild-1',
    channelId: 'channel-1',
    options: { getString: jest.fn(() => 'Steve') },
    reply: jest.fn().mockResolvedValue(sentMessage),
  };

  const modals: any[] = [];
  const btnInt: any = {
    customId: 'register_button',
    user: { id: UID },
    showModal: jest.fn().mockResolvedValue(undefined),
    awaitModalSubmit: jest.fn(async () => modals[modals.length - 1]),
  };

  const wsManager: any = {
    checkPlayerOnline: jest.fn().mockResolvedValue({ online: true, original_ign_case: 'Steve' }),
    send: jest.fn(),
  };

  return { interaction, sentMessage, btnInt, wsManager, handlers };
}

describe('register modal interaction', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockCreate.mockReset();
    mockFix.mockReset();
    mockRecordAudit.mockReset();
    mockCreate.mockResolvedValue({});
    mockFix.mockResolvedValue(undefined);
    mockRecordAudit.mockResolvedValue(undefined);
  });

  it('acknowledges the modal before doing slow work and replies through editReply', async () => {
    const { interaction, btnInt, wsManager, handlers } = setup();
    mockFindOne.mockReturnValue(userQuery(null));

    await register(interaction, wsManager);

    let modalInt: any;
    btnInt.awaitModalSubmit.mockImplementation(async () => (modalInt = setupModal(wsManager)));
    await handlers.collect(btnInt);

    expect(modalInt.deferReply).toHaveBeenCalledTimes(1);
    expect(modalInt.reply).not.toHaveBeenCalled();
    expect(modalInt.editReply).toHaveBeenCalledTimes(1);
    expect(mockFix).toHaveBeenCalled();
  });

  it('stops quietly when the modal interaction has already expired', async () => {
    const { interaction, btnInt, wsManager, handlers } = setup();
    mockFindOne.mockReturnValue(userQuery(null));

    await register(interaction, wsManager);

    let modalInt: any;
    btnInt.awaitModalSubmit.mockImplementation(async () => {
      modalInt = setupModal(wsManager);
      modalInt.deferReply.mockRejectedValue(Object.assign(new Error('Unknown interaction'), { code: 10062 }));
      return modalInt;
    });

    await expect(handlers.collect(btnInt)).resolves.toBeUndefined();
    expect(modalInt.editReply).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not reject when the follow-up edit arrives after the interaction expired', async () => {
    const { interaction, btnInt, wsManager, handlers } = setup();
    mockFindOne.mockReturnValue(userQuery(null));

    await register(interaction, wsManager);

    let modalInt: any;
    btnInt.awaitModalSubmit.mockImplementation(async () => {
      modalInt = setupModal(wsManager);
      modalInt.editReply.mockRejectedValue(Object.assign(new Error('Unknown interaction'), { code: 10062 }));
      return modalInt;
    });

    await expect(handlers.collect(btnInt)).resolves.toBeUndefined();
    expect(modalInt.editReply).toHaveBeenCalledTimes(1);
  });
});

function setupModal(wsManager: any) {
  return {
    customId: 'register_modal',
    fields: {
      getTextInputValue: () => wsManager.send.mock.calls[0][0].code,
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  };
}
