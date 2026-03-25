import { FastifyRequest, FastifyReply } from 'fastify';
import { IProxyUser } from '../types';

function getScopedUrl(req: FastifyRequest): URL {
  return new URL(req.raw.url ?? req.url, 'http://proxy');
}

function getScopedPathname(req: FastifyRequest): string {
  const pathname = getScopedUrl(req).pathname;
  return pathname.startsWith('/proxy') ? pathname.slice('/proxy'.length) || '/' : pathname;
}

export async function scopeGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = req.user as IProxyUser;
  const scopedUrl = getScopedUrl(req);
  const scopedPathname = getScopedPathname(req);

  if (user.role !== 'perusahaan') {
    if (user.role === 'pemda') {
      if (!user.pemdaScopeLevel) {
        return reply.status(403).send({ error: 'No pemda scope assigned' });
      }

      user.pemdaFilter = {
        scopeLevel: user.pemdaScopeLevel,
        provinsiId: user.provinsiId,
        kabupatenId: user.kabupatenId,
      };
    }

    return;
  }

  if (!user.perusahaanId) {
    return reply.status(403).send({ error: 'No perusahaan scope assigned' });
  }

  if (req.params && typeof req.params === 'object' && 'id' in req.params) {
    const perusahaanId = Number((req.params as { id?: string }).id);
    if (Number.isFinite(perusahaanId) && perusahaanId !== user.perusahaanId) {
      return reply.status(403).send({ error: 'Access denied: not your perusahaan' });
    }
  }

  if (scopedPathname === '/device' || scopedPathname === '/realtime_all') {
    scopedUrl.searchParams.set('id_perusahaan', String(user.perusahaanId));
    req.raw.url = `${scopedUrl.pathname}?${scopedUrl.searchParams.toString()}`;
  }
}
