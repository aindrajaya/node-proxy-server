import { config } from '../config';
import { IProxyUser } from '../types';
import { canUserAccessDeviceFromDb } from './deviceService';
import { resolveApiKey } from './keyService';

type QueryValue = string | number | boolean | null | undefined;

type UpstreamAuthMode = 'public' | 'scoped' | 'admin';

interface UpstreamRequestOptions {
  authMode: UpstreamAuthMode;
  pathname: string;
  query?: Record<string, QueryValue>;
  user?: IProxyUser;
}

interface UpstreamRequestResult {
  response: Response;
  requestUrl: string;
  authMode: UpstreamAuthMode;
}

function buildUpstreamUrl(pathname: string, query?: Record<string, QueryValue>): URL {
  const baseUrl = config.BACKEND_BASE_URL.endsWith('/')
    ? config.BACKEND_BASE_URL.slice(0, -1)
    : config.BACKEND_BASE_URL;
  const sanitizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(`${baseUrl}${sanitizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url;
}

async function resolveHeaderApiKey(
  authMode: UpstreamAuthMode,
  user?: IProxyUser,
): Promise<string | null> {
  if (authMode === 'public') {
    return null;
  }

  if (authMode === 'admin') {
    return resolveApiKey(null);
  }

  if (!user) {
    throw new Error('Scoped upstream request requires an authenticated user');
  }

  return user.role === 'perusahaan'
    ? resolveApiKey(user.perusahaanId)
    : resolveApiKey(null);
}

export async function requestUpstream(
  options: UpstreamRequestOptions,
): Promise<UpstreamRequestResult> {
  const apiKey = await resolveHeaderApiKey(options.authMode, options.user);
  const headers = new Headers();
  const requestUrl = buildUpstreamUrl(options.pathname, options.query).toString();

  if (apiKey) {
    headers.set('X-API-KEY', apiKey);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.BACKEND_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.BACKEND_TIMEOUT_MS);

    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok || attempt === config.BACKEND_RETRY_ATTEMPTS) {
        return {
          response,
          requestUrl,
          authMode: options.authMode,
        };
      }

      lastError = new Error(`Upstream status ${response.status}`);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error('Unknown upstream error');
    }
  }

  throw lastError ?? new Error('Upstream request failed');
}

export async function readUpstreamBody(response: Response): Promise<{
  contentType: string;
  payload: string | unknown;
}> {
  const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8';

  if (contentType.includes('application/json')) {
    return {
      contentType,
      payload: (await response.json()) as unknown,
    };
  }

  return {
    contentType,
    payload: await response.text(),
  };
}

export async function canAccessDevice(
  user: IProxyUser,
  deviceId: string,
): Promise<boolean> {
  return canUserAccessDeviceFromDb(user, deviceId);
}
