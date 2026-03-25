export type TPemdaScopeLevel = 'provinsi' | 'kabupaten';

export interface IDbUser {
  id: number;
  username: string;
  email: string;
  password: string;       // bcrypt hash
  first_name: string | null;
  last_name: string | null;
  active: 0 | 1;
  id_perusahaan: number | null;
  provinsi_id: string | null;
  kabupaten_id: string | null;
  group_id: number;
  nama_perusahaan: string | null;
}

export interface IDbApiKey {
  id_perusahaan: number | null;
  key_value: string;
  level: number;
  status: 'aktif' | 'nonaktif';
}

export interface IJwtPayload {
  sub: string;
  username: string;
  name: string;
  role: 'admin' | 'perusahaan' | 'pemda';
  pemdaScopeLevel: TPemdaScopeLevel | null;
  perusahaanId: number | null;
  perusahaanName: string | null;
  provinsiId: string | null;
  kabupatenId: string | null;
  jti: string;
  iat: number;
  exp: number;
}

export interface IProxyUser extends IJwtPayload {
  pemdaFilter?: {
    scopeLevel: TPemdaScopeLevel;
    provinsiId: string | null;
    kabupatenId: string | null;
  };
}

export interface IApiKeyCache {
  [perusahaanId: string]: string;  // id_perusahaan (or 'admin') → key_value
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: IProxyUser;
  }
}
