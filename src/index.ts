import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from './config';
import { mysqlPool } from './db/mysql';
import { connectRedis, redisClient } from './db/redis';
import authRoutes from './routes/auth';
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
    origin: ['https://gambutindonesia.kemenlh.go.id'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  await server.register(fastifyRateLimit, {
    global: false,
  });
  await server.register(fastifyCookie);
  await server.register(authRoutes, { prefix: '/auth' });
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

async function start(): Promise<void> {
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

  try {
    await server.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
