import { FastifyInstance } from 'fastify';
import {
  getPublicMapAnalytics,
  getPublicMapFilters,
  getPublicMapSummary,
  listPublicMapDevices,
} from '../services/publicMapService';
import {
  PublicMapAccessError,
  resolvePublicMapScope,
} from '../services/publicMapIdentityService';

type QueryValue = string | number | boolean | null | undefined;

type RawQuery = Record<string, QueryValue>;

export default async function publicMapRoutes(fastify: FastifyInstance) {
  fastify.get('/map/summary', async (_req, reply) => {
    try {
      const payload = await getPublicMapSummary();
      return reply.send(payload);
    } catch (error) {
      fastify.log.error({ err: error }, '[PublicMap] Summary query error');
      return reply.status(500).send({ error: 'Failed to query public map summary' });
    }
  });

  fastify.get('/map/devices', async (req, reply) => {
    try {
      const query = req.query as RawQuery;
      const scope = await resolvePublicMapScope(query);
      const payload = await listPublicMapDevices(query, scope);
      return reply.send(payload);
    } catch (error) {
      if (error instanceof PublicMapAccessError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }

      fastify.log.error({ err: error }, '[PublicMap] Devices query error');
      return reply.status(500).send({ error: 'Failed to query public map devices' });
    }
  });

  fastify.get('/map/analytics', async (req, reply) => {
    try {
      const payload = await getPublicMapAnalytics(req.query as RawQuery);
      return reply.send(payload);
    } catch (error) {
      fastify.log.error({ err: error }, '[PublicMap] Analytics query error');
      return reply.status(500).send({ error: 'Failed to query public map analytics' });
    }
  });

  fastify.get('/map/filters', async (req, reply) => {
    try {
      const payload = await getPublicMapFilters(req.query as RawQuery);
      return reply.send(payload);
    } catch (error) {
      fastify.log.error({ err: error }, '[PublicMap] Filters query error');
      return reply.status(500).send({ error: 'Failed to query public map filters' });
    }
  });
}
