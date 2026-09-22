import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from './config';
import { mysqlPool } from './db/mysql';
import { connectRedis, isRedisReady, redisClient } from './db/redis';
import authRoutes from './routes/auth';
import publicMapRoutes from './routes/publicMap';
import proxyRoutes from './routes/proxy';

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: 'info',
      redact: ['req.headers.cookie', 'req.headers["x-api-key"]'],
    },
  });

  await server.register(fastifyHelmet);
  await server.register(fastifyCors, {
    origin: ['https://gambutindonesia.kemenlh.go.id', 'http://localhost:3000', 'https://gis-monitoring.vercel.app'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  await server.register(fastifyRateLimit, {
    global: false,
  });
  await server.register(fastifyCookie);
  server.get('/live', async () => ({ status: 'live' }));
  server.get('/ready', async (_req, reply) => {
    if (!isRedisReady()) {
      return reply.status(503).send({ status: 'not_ready' });
    }

    return { status: 'ready' };
  });
  await server.register(authRoutes);
  await server.register(publicMapRoutes, { prefix: '/public' });
  await server.register(proxyRoutes, { prefix: '/proxy' });

  return server;
}

export async function closeServer(server: FastifyInstance): Promise<void> {
  await server.close();
  await mysqlPool.end();
  if (redisClient.status !== 'end') {
    await redisClient.quit();
  }
}

export async function start(): Promise<FastifyInstance> {
  await connectRedis();
  const server = await buildServer();

  const shutdown = async (signal: string) => {
    server.log.info(`[Shutdown] Received ${signal}; closing gracefully`);
    await closeServer(server);
    server.log.info('[Shutdown] All connections closed. Exiting.');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await server.listen({ port: config.PORT, host: '0.0.0.0' });
  server.log.info({ port: config.PORT }, '[Startup] HTTP server listening');
  return server;
}

if (require.main === module) {
  void start().catch((error: unknown) => {
    const details = error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: 'UnknownError', message: 'Unexpected startup failure' };
    console.error('[Startup] Fatal bootstrap failure', details);
    process.exit(1);
  });
}
