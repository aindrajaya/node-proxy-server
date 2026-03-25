import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHget, mockHset, mockExpire, mockDel, mockExecute } = vi.hoisted(() => ({
  mockHget: vi.fn(),
  mockHset: vi.fn(),
  mockExpire: vi.fn(),
  mockDel: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock('../src/db/redis', () => ({
  redisClient: {
    hget: mockHget,
    hset: mockHset,
    expire: mockExpire,
    del: mockDel,
  },
}));

vi.mock('../src/db/mysql', () => ({
  mysqlPool: {
    execute: mockExecute,
  },
}));

describe('key service', async () => {
  const { invalidateKeyCache, resolveApiKey } = await import('../src/services/keyService');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached key on Redis hit', async () => {
    mockHget.mockResolvedValueOnce('cached-company-key');

    await expect(resolveApiKey(10)).resolves.toBe('cached-company-key');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('refreshes cache from MySQL on Redis miss', async () => {
    mockHget
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('company-key');
    mockExecute.mockResolvedValueOnce([
      [
        { id_perusahaan: null, key_value: 'admin-key', level: 1, status: 'aktif' },
        { id_perusahaan: 10, key_value: 'company-key', level: 2, status: 'aktif' },
      ],
    ]);

    await expect(resolveApiKey(10)).resolves.toBe('company-key');
    expect(mockHset).toHaveBeenCalledWith('tmat:apikeys', {
      admin: 'admin-key',
      '10': 'company-key',
    });
    expect(mockExpire).toHaveBeenCalled();
  });

  it('invalidates the Redis cache explicitly', async () => {
    await invalidateKeyCache();
    expect(mockDel).toHaveBeenCalledWith('tmat:apikeys');
  });
});
