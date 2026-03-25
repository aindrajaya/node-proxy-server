import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getUserByIdentifier, verifyPassword } from '../services/userService';
import { resolveRoleFromGroup } from '../services/roleService';
import { loginSchema } from '../schemas/auth.schema';
import { authenticate } from '../hooks/authenticate';
import { blockToken } from '../blocklist/tokenBlocklist';
import { IDbUser, IJwtPayload, TPemdaScopeLevel } from '../types';

function buildUserProfile(payload: IJwtPayload) {
  return {
    id: Number(payload.sub),
    username: payload.username,
    name: payload.name,
    role: payload.role,
    pemdaScopeLevel: payload.pemdaScopeLevel,
    perusahaanId: payload.perusahaanId,
    perusahaanName: payload.perusahaanName,
    provinsiId: payload.provinsiId,
    kabupatenId: payload.kabupatenId,
  };
}

function buildEffectiveScope(payload: IJwtPayload) {
  if (payload.role === 'admin') {
    return { type: 'global' as const };
  }

  if (payload.role === 'perusahaan') {
    return {
      type: 'perusahaan' as const,
      perusahaanId: payload.perusahaanId,
      perusahaanName: payload.perusahaanName,
    };
  }

  if (payload.pemdaScopeLevel === 'kabupaten') {
    return {
      type: 'pemda_kabupaten' as const,
      provinsiId: payload.provinsiId,
      kabupatenId: payload.kabupatenId,
    };
  }

  return {
    type: 'pemda_provinsi' as const,
    provinsiId: payload.provinsiId,
  };
}

function resolvePemdaScopeLevel(user: IDbUser): TPemdaScopeLevel | null {
  if (user.kabupaten_id) {
    return 'kabupaten';
  }

  if (user.provinsi_id) {
    return 'provinsi';
  }

  return null;
}

function decodeSessionToken(token: string | undefined): IJwtPayload | null {
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, config.JWT_SECRET) as IJwtPayload;
  } catch {
    return null;
  }
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, _req, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 429
    ) {
      return reply
        .status(429)
        .send({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }

    return reply.send(error);
  });

  fastify.post(
    '/login',
    {
      schema: loginSchema,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body as Record<string, string>;

      const user = await getUserByIdentifier(username);
      if (!user || user.active === 0) {
        return reply
          .status(user ? 403 : 401)
          .send({ error: user ? 'Account is inactive' : 'Invalid credentials' });
      }

      const isValid = await verifyPassword(password, user.password);
      if (!isValid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const role = resolveRoleFromGroup(user.group_id);
      const pemdaScopeLevel = role === 'pemda' ? resolvePemdaScopeLevel(user) : null;
      if (role === 'pemda' && pemdaScopeLevel === null) {
        return reply.status(403).send({ error: 'No pemda scope assigned' });
      }

      const displayName = user.first_name
        ? `${user.first_name} ${user.last_name || ''}`.trim()
        : user.username;
      const jti = randomUUID();
      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + config.JWT_EXPIRES_IN;

      const payload: IJwtPayload = {
        sub: String(user.id),
        username: user.username,
        name: displayName,
        role,
        pemdaScopeLevel,
        perusahaanId: user.id_perusahaan,
        perusahaanName: user.nama_perusahaan,
        provinsiId: user.provinsi_id,
        kabupatenId: user.kabupaten_id,
        jti,
        iat,
        exp,
      };

      const token = jwt.sign(payload, config.JWT_SECRET);

      reply.setCookie(config.COOKIE_NAME, token, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: 'strict',
        path: '/',
        maxAge: config.JWT_EXPIRES_IN,
      });

      return reply.send({
        user: {
          ...buildUserProfile(payload),
        },
      });
    },
  );

  fastify.post('/logout', async (req, reply) => {
    const payload = decodeSessionToken(req.cookies[config.COOKIE_NAME]);

    if (payload) {
      await blockToken(payload.jti, payload.exp);
    }

    reply.clearCookie(config.COOKIE_NAME, {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: config.COOKIE_SECURE,
    });

    return reply.send({ message: 'Logged out successfully' });
  });

  fastify.get('/me', { preHandler: authenticate }, async (req, reply) => {
    return reply.send({ user: buildUserProfile(req.user as IJwtPayload) });
  });

  fastify.get('/debug-session', { preHandler: authenticate }, async (req, reply) => {
    const payload = req.user as IJwtPayload;
    return reply.send({
      user: buildUserProfile(payload),
      effectiveScope: buildEffectiveScope(payload),
    });
  });
}
