import { FastifyInstance, FastifyReply } from 'fastify';
import { authenticate } from '../hooks/authenticate';
import { scopeGuard } from '../hooks/scopeGuard';
import { listDevices } from '../services/deviceService';
import { listRealtimeAll, listRealtimeDevice } from '../services/realtimeService';
import {
  readUpstreamBody,
  requestUpstream,
} from '../services/upstreamService';
import { IProxyUser } from '../types';

type QueryValue = string | number | boolean | null | undefined;

type RawQuery = Record<string, QueryValue>;

function sanitizeQuery(rawQuery: RawQuery): Record<string, QueryValue> {
  return Object.fromEntries(
    Object.entries(rawQuery).filter(([, value]) => value !== undefined),
  );
}

function enforceScopedQuery(
  user: IProxyUser,
  query: Record<string, QueryValue>,
): Record<string, QueryValue> {
  if (user.role === 'perusahaan' && user.perusahaanId != null) {
    return {
      ...query,
      id_perusahaan: String(user.perusahaanId),
    };
  }

  return query;
}

async function forwardGet(
  fastify: FastifyInstance,
  reply: FastifyReply,
  options: {
    authMode: 'public' | 'scoped' | 'admin';
    pathname: string;
    query?: RawQuery;
    user?: IProxyUser;
  },
) {
  const upstreamResult = await requestUpstream({
    authMode: options.authMode,
    pathname: options.pathname,
    query: options.query,
    user: options.user,
  });
  const response =
    upstreamResult instanceof Response ? upstreamResult : upstreamResult.response;
  const requestUrl =
    upstreamResult instanceof Response ? options.pathname : upstreamResult.requestUrl;
  const authMode =
    upstreamResult instanceof Response ? options.authMode : upstreamResult.authMode;

  if (response.status >= 400 || options.pathname === '/realtime_all') {
    fastify.log.info(
      {
        upstreamStatus: response.status,
        upstreamUrl: requestUrl,
        upstreamAuthMode: authMode,
      },
      '[Proxy] Upstream response received',
    );
  }

  const { contentType, payload } = await readUpstreamBody(response);

  reply.status(response.status);
  reply.header('content-type', contentType);
  return reply.send(payload);
}

function logUpstreamFailure(
  fastify: FastifyInstance,
  error: unknown,
  upstreamPath: string,
  upstreamAuthMode: 'public' | 'scoped' | 'admin',
): void {
  if (error instanceof Error) {
    fastify.log.error(
      {
        err: error,
        upstreamAuthMode,
        upstreamPath,
        failureType: error.name === 'AbortError' ? 'timeout' : 'request_error',
      },
      '[Proxy] Upstream error',
    );
    return;
  }

  fastify.log.error({ err: error, upstreamAuthMode, upstreamPath }, '[Proxy] Upstream error');
}

export default async function proxyRoutes(fastify: FastifyInstance) {
  fastify.get('/map', async (_req, reply) => {
    try {
      return await forwardGet(fastify, reply, {
        authMode: 'admin',
        pathname: '/map',
      });
    } catch (error) {
      logUpstreamFailure(fastify, error, '/map', 'admin');
      return reply.status(502).send({ error: 'Upstream service unavailable' });
    }
  });

  fastify.get('/perusahaan', { preHandler: authenticate }, async (req, reply) => {
    try {
      const user = req.user as IProxyUser;
      const path =
        user.role === 'perusahaan' && user.perusahaanId != null
          ? `/perusahaan/${user.perusahaanId}`
          : '/perusahaan';

      return await forwardGet(fastify, reply, {
        authMode: 'scoped',
        pathname: path,
        user,
      });
    } catch (error) {
      logUpstreamFailure(fastify, error, '/perusahaan', 'scoped');
      return reply.status(502).send({ error: 'Upstream service unavailable' });
    }
  });

  fastify.get(
    '/perusahaan/:id',
    { preHandler: [authenticate, scopeGuard] },
    async (req, reply) => {
      try {
        const user = req.user as IProxyUser;
        const { id } = req.params as { id: string };

        return await forwardGet(fastify, reply, {
          authMode: 'scoped',
          pathname: `/perusahaan/${id}`,
          user,
        });
      } catch (error) {
        logUpstreamFailure(fastify, error, '/perusahaan/:id', 'scoped');
        return reply.status(502).send({ error: 'Upstream service unavailable' });
      }
    },
  );

  fastify.get('/device', { preHandler: [authenticate, scopeGuard] }, async (req, reply) => {
    try {
      const user = req.user as IProxyUser;
      const query = enforceScopedQuery(user, sanitizeQuery(req.query as RawQuery));
      const payload = await listDevices(user, query);
      return reply.send(payload);
    } catch (error) {
      fastify.log.error({ err: error }, '[Proxy] Device query error');
      return reply.status(500).send({ error: 'Failed to query device data' });
    }
  });

  fastify.get(
    '/realtime_all',
    { preHandler: [authenticate, scopeGuard] },
    async (req, reply) => {
      try {
        const user = req.user as IProxyUser;
        const query = enforceScopedQuery(user, sanitizeQuery(req.query as RawQuery));
        const payload = await listRealtimeAll(user, query);
        return reply.send(payload);
      } catch (error) {
        fastify.log.error({ err: error }, '[Proxy] Realtime all query error');
        return reply.status(500).send({ error: 'Failed to query realtime data' });
      }
    },
  );

  fastify.get(
    '/realtime_device',
    { preHandler: [authenticate, scopeGuard] },
    async (req, reply) => {
      try {
        const user = req.user as IProxyUser;
        const query = sanitizeQuery(req.query as RawQuery);
        const payload = await listRealtimeDevice(user, query);

        if ('error' in payload) {
          const statusCode = payload.error === 'device_id is required' ? 400 : 403;
          return reply.status(statusCode).send({ error: payload.error });
        }

        return reply.send(payload);
      } catch (error) {
        fastify.log.error({ err: error }, '[Proxy] Realtime device query error');
        return reply.status(500).send({ error: 'Failed to query realtime device data' });
      }
    },
  );
}
