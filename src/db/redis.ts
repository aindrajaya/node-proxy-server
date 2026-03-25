import Redis from 'ioredis';
import { config } from '../config';

export const redisClient = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  enableReadyCheck: true,
});

redisClient.on('connect', () => console.log('[Redis] Connected'));
redisClient.on('error', (err) => console.error('[Redis] Error:', err));

export async function connectRedis(): Promise<void> {
  if (redisClient.status === 'wait') {
    await redisClient.connect();
  }
}
