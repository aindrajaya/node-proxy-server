import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedisClient = vi.hoisted(() => ({
  status: 'wait',
  connect: vi.fn(),
  on: vi.fn(),
}));

vi.mock('ioredis', () => ({
  default: class RedisMock {
    constructor() {
      return mockRedisClient;
    }
  },
}));

import { connectRedis } from '../src/db/redis';

const fastPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1,
  maxDelayMs: 1,
};

describe('Redis startup connection', () => {
  beforeEach(() => {
    mockRedisClient.status = 'wait';
    mockRedisClient.connect.mockReset();
    mockRedisClient.on.mockClear();
  });

  it('returns when Redis is already ready', async () => {
    mockRedisClient.status = 'ready';

    await expect(connectRedis(fastPolicy)).resolves.toBeUndefined();
    expect(mockRedisClient.connect).not.toHaveBeenCalled();
  });

  it('starts a lazy connection and continues when Redis becomes ready', async () => {
    mockRedisClient.connect.mockImplementation(async () => {
      mockRedisClient.status = 'ready';
    });

    await expect(connectRedis(fastPolicy)).resolves.toBeUndefined();
    expect(mockRedisClient.connect).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-progress reconnect without calling connect again', async () => {
    mockRedisClient.status = 'reconnecting';
    setTimeout(() => {
      mockRedisClient.status = 'ready';
    }, 0);

    await expect(connectRedis(fastPolicy)).resolves.toBeUndefined();
    expect(mockRedisClient.connect).not.toHaveBeenCalled();
  });

  it('rejects after the bounded startup window when Redis stays unavailable', async () => {
    mockRedisClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(connectRedis({ ...fastPolicy, maxAttempts: 2 })).rejects.toThrow(
      'Redis did not become ready after 2 startup attempts: Error',
    );
    expect(mockRedisClient.connect).toHaveBeenCalledTimes(1);
  });
});
