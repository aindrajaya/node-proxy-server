import dotenv from 'dotenv';
dotenv.config();

function getEnv(key: string, required = true, defaultVal = ''): string {
  const val = process.env[key];
  if (!val && required && !defaultVal) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val || defaultVal;
}

function getOptionalNumberEnv(key: string): number | null {
  const val = process.env[key];
  if (!val) {
    return null;
  }

  const parsed = parseInt(val, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${key}`);
  }

  return parsed;
}

const legacyPemdaGroupId = getOptionalNumberEnv('ROLE_PEMDA_GROUP_ID');
const pemdaProvGroupId = getOptionalNumberEnv('ROLE_PEMDA_PROV_GROUP_ID');
const pemdaKabGroupId = getOptionalNumberEnv('ROLE_PEMDA_KAB_GROUP_ID');
const pemdaGroupIds = [
  pemdaProvGroupId,
  pemdaKabGroupId,
  legacyPemdaGroupId,
].filter((value): value is number => value !== null);

if (pemdaGroupIds.length === 0) {
  throw new Error(
    'Missing pemda group configuration. Set ROLE_PEMDA_GROUP_ID or ROLE_PEMDA_PROV_GROUP_ID / ROLE_PEMDA_KAB_GROUP_ID.',
  );
}

export const config = {
  PORT: parseInt(getEnv('PORT', false, '4000'), 10),
  NODE_ENV: getEnv('NODE_ENV', false, 'development'),
  JWT_SECRET: getEnv('JWT_SECRET'),
  JWT_EXPIRES_IN: parseInt(getEnv('JWT_EXPIRES_IN', false, '3600'), 10),
  COOKIE_NAME: getEnv('COOKIE_NAME', false, 'tmat_session'),
  COOKIE_SECURE: getEnv('COOKIE_SECURE', false, 'true') === 'true',
  ALLOWED_ORIGINS: getEnv('ALLOWED_ORIGINS'),
  BACKEND_BASE_URL: getEnv('BACKEND_BASE_URL'),
  BACKEND_TIMEOUT_MS: parseInt(getEnv('BACKEND_TIMEOUT_MS', false, '10000'), 10),
  BACKEND_RETRY_ATTEMPTS: parseInt(getEnv('BACKEND_RETRY_ATTEMPTS', false, '2'), 10),
  DB_HOST: getEnv('DB_HOST'),
  DB_PORT: parseInt(getEnv('DB_PORT', false, '3306'), 10),
  DB_NAME: getEnv('DB_NAME'),
  DB_USER: getEnv('DB_USER'),
  DB_PASSWORD: getEnv('DB_PASSWORD'),
  DB_CONNECTION_LIMIT: parseInt(getEnv('DB_CONNECTION_LIMIT', false, '10'), 10),
  REDIS_URL: getEnv('REDIS_URL'),
  REDIS_KEY_CACHE_TTL: parseInt(getEnv('REDIS_KEY_CACHE_TTL', false, '300'), 10),
  ROLE_ADMIN_GROUP_ID: parseInt(getEnv('ROLE_ADMIN_GROUP_ID'), 10),
  ROLE_PERUSAHAAN_GROUP_ID: parseInt(getEnv('ROLE_PERUSAHAAN_GROUP_ID'), 10),
  ROLE_PEMDA_GROUP_ID: legacyPemdaGroupId ?? pemdaGroupIds[0],
  ROLE_PEMDA_PROV_GROUP_ID: pemdaProvGroupId,
  ROLE_PEMDA_KAB_GROUP_ID: pemdaKabGroupId,
  ROLE_PEMDA_GROUP_IDS: pemdaGroupIds,
  BCRYPT_SALT_ROUNDS: parseInt(getEnv('BCRYPT_SALT_ROUNDS', false, '12'), 10),
};
