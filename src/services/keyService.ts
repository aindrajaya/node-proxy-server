import { redisClient } from '../db/redis';
import { mysqlPool } from '../db/mysql';
import { config } from '../config';
import { IDbApiKey } from '../types';
import { RowDataPacket } from 'mysql2';

const CACHE_KEY = 'tmat:apikeys';

async function refreshCache(): Promise<void> {
  const [rows] = await mysqlPool.execute<(IDbApiKey & RowDataPacket)[]>(
    `SELECT id_perusahaan, key_value, level
     FROM api_keys WHERE status = 'aktif'
     ORDER BY level ASC`
  );

  const hash: Record<string, string> = {};
  for (const row of rows) {
    if (row.id_perusahaan) {
      hash[String(row.id_perusahaan)] = row.key_value;
    }
    if (!hash['admin']) {
      hash['admin'] = row.key_value; // lowest level = admin fallback
    }
  }

  if (Object.keys(hash).length > 0) {
    await redisClient.hset(CACHE_KEY, hash);
    await redisClient.expire(CACHE_KEY, config.REDIS_KEY_CACHE_TTL);
    console.log(`[KeyService] Cache refreshed — ${Object.keys(hash).length} key(s) stored in Redis`);
  }
}

export async function resolveApiKey(perusahaanId: number | null): Promise<string> {
  const field = perusahaanId ? String(perusahaanId) : 'admin';
  let keyValue = await redisClient.hget(CACHE_KEY, field);

  if (!keyValue) {
    await refreshCache();
    keyValue = await redisClient.hget(CACHE_KEY, field)
             ?? await redisClient.hget(CACHE_KEY, 'admin');
  }

  if (!keyValue) {
    throw new Error('[KeyService] No active API key found in database');
  }

  return keyValue;
}

export async function invalidateKeyCache(): Promise<void> {
  await redisClient.del(CACHE_KEY);
  console.log('[KeyService] Redis cache invalidated');
}
