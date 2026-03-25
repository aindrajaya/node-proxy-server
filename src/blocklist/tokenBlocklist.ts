import { redisClient } from '../db/redis';

const PREFIX = 'tmat:blocklist:';

export async function blockToken(jti: string, exp: number): Promise<void> {
  const remainingTtl = exp - Math.floor(Date.now() / 1000);
  if (remainingTtl > 0) {
    await redisClient.set(`${PREFIX}${jti}`, '1', 'EX', remainingTtl);
  }
}

export async function isTokenBlocked(jti: string): Promise<boolean> {
  const result = await redisClient.exists(`${PREFIX}${jti}`);
  return result === 1;
}
