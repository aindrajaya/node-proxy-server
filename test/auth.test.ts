import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import { buildServer } from '../src/index';
import { FastifyInstance } from 'fastify';

const {
  mockGetUserByIdentifier,
  mockVerifyPassword,
  mockIsTokenBlocked,
  mockBlockToken,
} = vi.hoisted(() => ({
  mockGetUserByIdentifier: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockIsTokenBlocked: vi.fn(),
  mockBlockToken: vi.fn(),
}));

vi.mock('../src/services/userService', () => ({
  getUserByIdentifier: mockGetUserByIdentifier,
  verifyPassword: mockVerifyPassword,
}));

vi.mock('../src/blocklist/tokenBlocklist', () => ({
  isTokenBlocked: mockIsTokenBlocked,
  blockToken: mockBlockToken,
}));

describe('auth routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockIsTokenBlocked.mockResolvedValue(false);
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    vi.clearAllMocks();
  });

  it('sets HttpOnly cookie on login and omits token from body', async () => {
    mockGetUserByIdentifier.mockResolvedValue({
      id: 7,
      username: 'admin',
      email: 'admin@example.com',
      password: 'hashed',
      first_name: 'System',
      last_name: 'Administrator',
      active: 1,
      id_perusahaan: null,
      provinsi_id: null,
      kabupaten_id: null,
      group_id: config.ROLE_ADMIN_GROUP_ID,
      nama_perusahaan: null,
    });
    mockVerifyPassword.mockResolvedValue(true);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'admin',
        password: 'secret',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies[0]?.httpOnly).toBe(true);
    expect(response.json()).toEqual({
      user: {
        id: 7,
        username: 'admin',
        name: 'System Administrator',
        role: 'admin',
        pemdaScopeLevel: null,
        perusahaanId: null,
        perusahaanName: null,
        provinsiId: null,
        kabupatenId: null,
      },
    });
    expect(response.body).not.toContain('token');
  });

  it('returns current user profile from JWT cookie via /auth/me', async () => {
    const token = jwt.sign(
      {
        sub: '99',
        username: 'pemda-user',
        name: 'Pemda User',
        role: 'pemda',
        pemdaScopeLevel: 'kabupaten',
        perusahaanId: null,
        perusahaanName: null,
        provinsiId: '31',
        kabupatenId: '3171',
        jti: 'abc',
        iat: 1,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      config.JWT_SECRET,
    );

    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: {
        [config.COOKIE_NAME]: token,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: 99,
        username: 'pemda-user',
        name: 'Pemda User',
        role: 'pemda',
        pemdaScopeLevel: 'kabupaten',
        perusahaanId: null,
        perusahaanName: null,
        provinsiId: '31',
        kabupatenId: '3171',
      },
    });
  });

  it('returns debug session scope details for pemda kabupaten users', async () => {
    const token = jwt.sign(
      {
        sub: '99',
        username: 'pemda-user',
        name: 'Pemda User',
        role: 'pemda',
        pemdaScopeLevel: 'kabupaten',
        perusahaanId: null,
        perusahaanName: null,
        provinsiId: '31',
        kabupatenId: '3171',
        jti: 'debug-abc',
        iat: 1,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      config.JWT_SECRET,
    );

    const response = await server.inject({
      method: 'GET',
      url: '/auth/debug-session',
      cookies: {
        [config.COOKIE_NAME]: token,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: 99,
        username: 'pemda-user',
        name: 'Pemda User',
        role: 'pemda',
        pemdaScopeLevel: 'kabupaten',
        perusahaanId: null,
        perusahaanName: null,
        provinsiId: '31',
        kabupatenId: '3171',
      },
      effectiveScope: {
        type: 'pemda_kabupaten',
        provinsiId: '31',
        kabupatenId: '3171',
      },
    });
  });

  it('blocklists session token on logout', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = jwt.sign(
      {
        sub: '7',
        username: 'admin',
        name: 'System Administrator',
        role: 'admin',
        pemdaScopeLevel: null,
        perusahaanId: null,
        perusahaanName: null,
        provinsiId: null,
        kabupatenId: null,
        jti: 'logout-jti',
        iat: 1,
        exp,
      },
      config.JWT_SECRET,
    );

    const response = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: {
        [config.COOKIE_NAME]: token,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockBlockToken).toHaveBeenCalledWith('logout-jti', exp);
    expect(response.json()).toEqual({ message: 'Logged out successfully' });
  });

  it('returns success on logout without session cookie', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Logged out successfully' });
    expect(mockBlockToken).not.toHaveBeenCalled();
  });

  it('sets pemda provinsi scope level on login when only provinsi_id is present', async () => {
    mockGetUserByIdentifier.mockResolvedValue({
      id: 8,
      username: 'pemda-prov',
      email: 'pemda-prov@example.com',
      password: 'hashed',
      first_name: 'Pemda',
      last_name: 'Provinsi',
      active: 1,
      id_perusahaan: null,
      provinsi_id: '31',
      kabupaten_id: null,
      group_id: config.ROLE_PEMDA_PROV_GROUP_ID ?? config.ROLE_PEMDA_GROUP_ID,
      nama_perusahaan: null,
    });
    mockVerifyPassword.mockResolvedValue(true);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'pemda-prov',
        password: 'secret',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: 8,
        username: 'pemda-prov',
        name: 'Pemda Provinsi',
        role: 'pemda',
        pemdaScopeLevel: 'provinsi',
        perusahaanId: null,
        perusahaanName: null,
        provinsiId: '31',
        kabupatenId: null,
      },
    });
  });

  it('rejects pemda login when no provinsi_id or kabupaten_id is assigned', async () => {
    mockGetUserByIdentifier.mockResolvedValue({
      id: 9,
      username: 'pemda-noscope',
      email: 'pemda-noscope@example.com',
      password: 'hashed',
      first_name: 'Pemda',
      last_name: 'No Scope',
      active: 1,
      id_perusahaan: null,
      provinsi_id: null,
      kabupaten_id: null,
      group_id: config.ROLE_PEMDA_KAB_GROUP_ID ?? config.ROLE_PEMDA_GROUP_ID,
      nama_perusahaan: null,
    });
    mockVerifyPassword.mockResolvedValue(true);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'pemda-noscope',
        password: 'secret',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'No pemda scope assigned' });
  });

  it('accepts pemda kabupaten group id as pemda role on login', async () => {
    mockGetUserByIdentifier.mockResolvedValue({
      id: 10,
      username: 'pemda-kab',
      email: 'pemda-kab@example.com',
      password: 'hashed',
      first_name: 'Pemda',
      last_name: 'Kabupaten',
      active: 1,
      id_perusahaan: null,
      provinsi_id: '14',
      kabupaten_id: '1410',
      group_id: config.ROLE_PEMDA_KAB_GROUP_ID ?? config.ROLE_PEMDA_GROUP_ID,
      nama_perusahaan: null,
    });
    mockVerifyPassword.mockResolvedValue(true);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'pemda-kab',
        password: 'secret',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: 10,
        username: 'pemda-kab',
        name: 'Pemda Kabupaten',
        role: 'pemda',
        pemdaScopeLevel: 'kabupaten',
        perusahaanId: null,
        perusahaanName: null,
        provinsiId: '14',
        kabupatenId: '1410',
      },
    });
  });

  it('returns 429 after repeated failed login attempts', async () => {
    mockGetUserByIdentifier.mockResolvedValue(null);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'unknown',
          password: 'wrong',
        },
      });

      expect(response.statusCode).toBe(401);
    }

    const blockedResponse = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'unknown',
        password: 'wrong',
      },
    });

    expect(blockedResponse.statusCode).toBe(429);
    expect(blockedResponse.json()).toEqual({
      error: 'Too many login attempts. Try again in 15 minutes.',
    });
  });
});
