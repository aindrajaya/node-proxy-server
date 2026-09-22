import Redis from 'ioredis';
import { config } from '../config';

export const redisClient = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  enableReadyCheck: true,
});

const REDIS_STARTUP_MAX_ATTEMPTS = 6;
const REDIS_STARTUP_BASE_DELAY_MS = 250;
const REDIS_STARTUP_MAX_DELAY_MS = 2_000;

export interface RedisStartupPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultRedisStartupPolicy: RedisStartupPolicy = {
  maxAttempts: REDIS_STARTUP_MAX_ATTEMPTS,
  baseDelayMs: REDIS_STARTUP_BASE_DELAY_MS,
  maxDelayMs: REDIS_STARTUP_MAX_DELAY_MS,
};

function logLifecycle(event: string, details: Record<string, unknown> = {}): void {
  console.info('[Redis] Lifecycle', { event, status: redisClient.status, ...details });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRedisReady(): boolean {
  return redisClient.status === 'ready';
}

redisClient.on('connect', () => logLifecycle('connect'));
redisClient.on('ready', () => logLifecycle('ready'));
redisClient.on('reconnecting', (delayMs: number) => logLifecycle('reconnecting', { delayMs }));
redisClient.on('close', () => logLifecycle('close'));
redisClient.on('end', () => logLifecycle('end'));
redisClient.on('error', (err: Error) => {
  console.error('[Redis] Lifecycle', {
    event: 'error',
    status: redisClient.status,
    name: err.name,
    message: err.message,
  });
});

export async function connectRedis(
  policy: RedisStartupPolicy = defaultRedisStartupPolicy,
): Promise<void> {
  let lastError: unknown;
  let initialConnectionAttempted = false;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (isRedisReady()) {
      return;
    }

    if (redisClient.status === 'wait' && !initialConnectionAttempted) {
      initialConnectionAttempted = true;
      try {
        await redisClient.connect();
      } catch (error) {
        lastError = error;
      }
    }

    if (isRedisReady()) {
      return;
    }

    if (attempt < policy.maxAttempts) {
      const delayMs = Math.min(
        policy.baseDelayMs * 2 ** (attempt - 1),
        policy.maxDelayMs,
      );
      logLifecycle('startup_wait', { attempt, delayMs });
      await delay(delayMs);
    }
  }

  const cause = lastError instanceof Error ? `: ${lastError.name}` : '';
  throw new Error(
    `Redis did not become ready after ${policy.maxAttempts} startup attempts${cause}`,
  );
}
