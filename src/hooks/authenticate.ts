import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { isTokenBlocked } from '../blocklist/tokenBlocklist';
import { IJwtPayload, IProxyUser } from '../types';

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[config.COOKIE_NAME];
  if (!token) {
    return reply.status(401).send({ error: 'No session cookie found' });
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as IJwtPayload;

    if (await isTokenBlocked(payload.jti)) {
      return reply.status(401).send({ error: 'Session has been revoked' });
    }

    (req as FastifyRequest & { user: IProxyUser }).user = payload;
  } catch {
    return reply.status(403).send({ error: 'Invalid or expired session' });
  }
}
