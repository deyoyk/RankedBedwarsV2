import { claimVoteRequest, releaseVoteRequest } from '../src/utils/voteRequest';

jest.mock('../src/models/VoteRequest', () => ({
  __esModule: true,
  default: { create: jest.fn(), deleteOne: jest.fn() }
}));

const VoteRequest = require('../src/models/VoteRequest').default;

describe('vote request claims', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('grants the first claim for a game scope', async () => {
    VoteRequest.create.mockResolvedValue({});
    await expect(claimVoteRequest('42', 'void', 'user1')).resolves.toBe(true);
    expect(VoteRequest.create).toHaveBeenCalledTimes(1);
    expect(VoteRequest.create.mock.calls[0][0].key).toBe('42:void');
  });

  it('rejects a duplicate claim for the same game scope', async () => {
    const duplicate = new Error('duplicate key');
    (duplicate as unknown as { code: number }).code = 11000;
    VoteRequest.create.mockRejectedValueOnce(duplicate);
    await expect(claimVoteRequest('42', 'void', 'user2')).resolves.toBe(false);
  });

  it('keeps strike scopes per target so different targets do not collide', async () => {
    VoteRequest.create.mockResolvedValue({});
    await claimVoteRequest('42', 'strike:targetA', 'user1');
    await claimVoteRequest('42', 'strike:targetB', 'user1');
    expect(VoteRequest.create.mock.calls[0][0].key).toBe('42:strike:targetA');
    expect(VoteRequest.create.mock.calls[1][0].key).toBe('42:strike:targetB');
  });

  it('releases the claim when voting closes', async () => {
    VoteRequest.deleteOne.mockResolvedValue({ deletedCount: 1 });
    await releaseVoteRequest('42', 'void');
    expect(VoteRequest.deleteOne).toHaveBeenCalledWith({ key: '42:void' });
  });

  it('surfaces non-duplicate claim errors', async () => {
    VoteRequest.create.mockRejectedValueOnce(new Error('db down'));
    await expect(claimVoteRequest('42', 'void', 'user1')).rejects.toThrow('db down');
  });
});
