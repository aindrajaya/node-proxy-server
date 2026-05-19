import { getUserByEmail } from './userService';
import { resolveRoleFromGroup } from './roleService';
import { IDbUser, TPemdaScopeLevel } from '../types';

type PublicRole = 'admin' | 'perusahaan' | 'pemda';

export type PublicMapScope =
  | { role: 'admin' }
  | { role: 'perusahaan'; perusahaanId: number }
  | { role: 'pemda'; pemdaScopeLevel: TPemdaScopeLevel; provinsiId: string | null; kabupatenId: string | null };

export class PublicMapAccessError extends Error {
  readonly statusCode: 400 | 403;

  constructor(statusCode: 400 | 403, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function toRequiredTrimmed(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function parseRequestedRole(value: string): PublicRole | null {
  if (value === 'admin' || value === 'perusahaan' || value === 'pemda') {
    return value;
  }

  return null;
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

export async function resolvePublicMapScope(query: Record<string, unknown>): Promise<PublicMapScope> {
  const email = toRequiredTrimmed(query.email);
  const rawRole = toRequiredTrimmed(query.role).toLowerCase();

  if (!email || !rawRole) {
    throw new PublicMapAccessError(400, 'email and role are required');
  }

  const requestedRole = parseRequestedRole(rawRole);
  if (!requestedRole) {
    throw new PublicMapAccessError(400, 'role must be one of: admin, perusahaan, pemda');
  }

  const user = await getUserByEmail(email);
  if (!user || user.active === 0) {
    throw new PublicMapAccessError(403, 'Access denied');
  }

  const actualRole = resolveRoleFromGroup(user.group_id);
  if (requestedRole !== actualRole) {
    throw new PublicMapAccessError(403, 'Access denied');
  }

  if (actualRole === 'admin') {
    return { role: 'admin' };
  }

  if (actualRole === 'perusahaan') {
    if (user.id_perusahaan == null) {
      throw new PublicMapAccessError(403, 'Access denied');
    }

    return {
      role: 'perusahaan',
      perusahaanId: user.id_perusahaan,
    };
  }

  const pemdaScopeLevel = resolvePemdaScopeLevel(user);
  if (!pemdaScopeLevel) {
    throw new PublicMapAccessError(403, 'Access denied');
  }

  return {
    role: 'pemda',
    pemdaScopeLevel,
    provinsiId: user.provinsi_id,
    kabupatenId: user.kabupaten_id,
  };
}
