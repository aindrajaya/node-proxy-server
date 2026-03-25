import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { FastifyInstance } from 'fastify';
import { config } from '../src/config';
import { buildServer } from '../src/index';

const {
  mockIsTokenBlocked,
  mockRequestUpstream,
  mockReadUpstreamBody,
  mockListDevices,
  mockListRegions,
  mockListRealtimeAll,
  mockListRealtimeDevice,
  mockResolveRegionLookup,
} = vi.hoisted(() => ({
  mockIsTokenBlocked: vi.fn(),
  mockRequestUpstream: vi.fn(),
  mockReadUpstreamBody: vi.fn(),
  mockListDevices: vi.fn(),
  mockListRegions: vi.fn(),
  mockListRealtimeAll: vi.fn(),
  mockListRealtimeDevice: vi.fn(),
  mockResolveRegionLookup: vi.fn(),
}));

vi.mock('../src/blocklist/tokenBlocklist', () => ({
  isTokenBlocked: mockIsTokenBlocked,
  blockToken: vi.fn(),
}));

vi.mock('../src/services/upstreamService', () => ({
  requestUpstream: mockRequestUpstream,
  readUpstreamBody: mockReadUpstreamBody,
}));

vi.mock('../src/services/deviceService', () => ({
  listDevices: mockListDevices,
}));

vi.mock('../src/services/regionService', () => ({
  listRegions: mockListRegions,
  resolveRegionLookup: mockResolveRegionLookup,
}));

vi.mock('../src/services/realtimeService', () => ({
  listRealtimeAll: mockListRealtimeAll,
  listRealtimeDevice: mockListRealtimeDevice,
}));

function buildCookie(payload: Record<string, unknown>): string {
  return jwt.sign(
    {
      jti: 'test-jti',
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    },
    config.JWT_SECRET,
  );
}

describe('proxy RBAC routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    mockIsTokenBlocked.mockResolvedValue(false);
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    vi.clearAllMocks();
  });

  it('forces perusahaan id query on /proxy/device', async () => {
    mockListDevices.mockResolvedValue({
      status: true,
      message: 'Daftar device berhasil diambil',
      total: 1,
      filters: { id_perusahaan: '10' },
      data: [{ id: 1, id_perusahaan: 10 }],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/device?id_perusahaan=99',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '10',
          username: 'perusahaan-user',
          name: 'Perusahaan User',
          role: 'perusahaan',
          pemdaScopeLevel: null,
          perusahaanId: 10,
          perusahaanName: 'PT Test',
          provinsiId: null,
          kabupatenId: null,
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockListDevices).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'perusahaan',
        perusahaanId: 10,
      }),
      {
        id_perusahaan: '10',
      },
    );
  });

  it('blocks cross-company detail access', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/proxy/perusahaan/99',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '10',
          username: 'perusahaan-user',
          name: 'Perusahaan User',
          role: 'perusahaan',
          pemdaScopeLevel: null,
          perusahaanId: 10,
          perusahaanName: 'PT Test',
          provinsiId: null,
          kabupatenId: null,
        }),
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Access denied: not your perusahaan' });
    expect(mockRequestUpstream).not.toHaveBeenCalled();
  });

  it('filters pemda device payload by regional scope', async () => {
    mockListDevices.mockResolvedValue({
      status: true,
      message: 'Daftar device berhasil diambil',
      total: 1,
      filters: {
        provinsi_id: '31',
        kabupaten_id: '3171',
      },
      data: [
        {
          device_id: 'A',
          kabupaten_id: '3171',
        },
      ],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/device',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '11',
          username: 'pemda-user',
          name: 'Pemda User',
          role: 'pemda',
          pemdaScopeLevel: 'kabupaten',
          perusahaanId: null,
          perusahaanName: null,
          provinsiId: '31',
          kabupatenId: '3171',
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: true,
      message: 'Daftar device berhasil diambil',
      total: 1,
      filters: {
        provinsi_id: '31',
        kabupaten_id: '3171',
      },
      data: [
        {
          device_id: 'A',
          kabupaten_id: '3171',
        },
      ],
    });
  });

  it('returns province lookup payload for authenticated users', async () => {
    mockListRegions.mockResolvedValue({
      status: true,
      message: 'Data provinsi berhasil diambil',
      total: 1,
      data: [{ id: '14', nama: 'Riau', latitude: 0, longitude: 0 }],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/regions/provinces',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '1',
          username: 'admin',
          name: 'Administrator',
          role: 'admin',
          pemdaScopeLevel: null,
          perusahaanId: null,
          perusahaanName: null,
          provinsiId: null,
          kabupatenId: null,
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockListRegions).toHaveBeenCalledWith('provinsi', {});
    expect(response.json()).toEqual({
      status: true,
      message: 'Data provinsi berhasil diambil',
      total: 1,
      data: [{ id: '14', nama: 'Riau', latitude: 0, longitude: 0 }],
    });
  });

  it('resolves region names from ids', async () => {
    mockResolveRegionLookup.mockResolvedValue({
      status: true,
      message: 'Nama wilayah berhasil di-resolve',
      data: {
        provinsi_nama: 'Riau',
        kabupaten_nama: 'Kepulauan Meranti',
        kecamatan_nama: null,
        kelurahan_nama: null,
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/regions/resolve?provinsi_id=14&kabupaten_id=1410',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '1',
          username: 'admin',
          name: 'Administrator',
          role: 'admin',
          pemdaScopeLevel: null,
          perusahaanId: null,
          perusahaanName: null,
          provinsiId: null,
          kabupatenId: null,
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockResolveRegionLookup).toHaveBeenCalledWith({
      provinsi_id: '14',
      kabupaten_id: '1410',
    });
    expect(response.json()).toEqual({
      status: true,
      message: 'Nama wilayah berhasil di-resolve',
      data: {
        provinsi_nama: 'Riau',
        kabupaten_nama: 'Kepulauan Meranti',
        kecamatan_nama: null,
        kelurahan_nama: null,
      },
    });
  });

  it('forwards /proxy/perusahaan with scoped auth for admin users', async () => {
    mockRequestUpstream.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    mockReadUpstreamBody.mockResolvedValue({
      contentType: 'application/json',
      payload: [],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/perusahaan',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '1',
          username: 'admin',
          name: 'Administrator',
          role: 'admin',
          pemdaScopeLevel: null,
          perusahaanId: null,
          perusahaanName: null,
          provinsiId: null,
          kabupatenId: null,
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRequestUpstream).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: 'scoped',
        pathname: '/perusahaan',
      }),
    );
  });

  it('rewrites /proxy/perusahaan to own company detail for perusahaan users', async () => {
    mockRequestUpstream.mockResolvedValue(new Response(JSON.stringify({ id: 10 }), { status: 200 }));
    mockReadUpstreamBody.mockResolvedValue({
      contentType: 'application/json',
      payload: { id: 10 },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/perusahaan',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '10',
          username: 'perusahaan-user',
          name: 'Perusahaan User',
          role: 'perusahaan',
          pemdaScopeLevel: null,
          perusahaanId: 10,
          perusahaanName: 'PT Test',
          provinsiId: null,
          kabupatenId: null,
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRequestUpstream).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: 'scoped',
        pathname: '/perusahaan/10',
      }),
    );
  });

  it('allows public /proxy/map without session cookie using admin key', async () => {
    mockRequestUpstream.mockResolvedValue(new Response('map-data', { status: 200 }));
    mockReadUpstreamBody.mockResolvedValue({
      contentType: 'text/html',
      payload: 'map-data',
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/map',
    });

    expect(response.statusCode).toBe(200);
    expect(mockRequestUpstream).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: 'admin',
        pathname: '/map',
      }),
    );
  });

  it('filters pemda provinsi payload by provinsi_id when kabupaten scope is not assigned', async () => {
    mockListDevices.mockResolvedValue({
      status: true,
      message: 'Daftar device berhasil diambil',
      total: 1,
      filters: {
        provinsi_id: '31',
      },
      data: [{ device_id: 'A', provinsi_id: '31', kabupaten_id: '3171' }],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/device',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '12',
          username: 'pemda-provinsi',
          name: 'Pemda Provinsi',
          role: 'pemda',
          pemdaScopeLevel: 'provinsi',
          perusahaanId: null,
          perusahaanName: null,
          provinsiId: '31',
          kabupatenId: null,
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: true,
      message: 'Daftar device berhasil diambil',
      total: 1,
      filters: {
        provinsi_id: '31',
      },
      data: [{ device_id: 'A', provinsi_id: '31', kabupaten_id: '3171' }],
    });
  });

  it('rejects realtime_device when device is outside user scope', async () => {
    mockListRealtimeDevice.mockResolvedValue({
      error: 'Access denied for the requested device',
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/realtime_device?device_id=123&start_date=2026-01-01&end_date=2026-01-02',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '11',
          username: 'pemda-user',
          name: 'Pemda User',
          role: 'pemda',
          pemdaScopeLevel: 'kabupaten',
          perusahaanId: null,
          perusahaanName: null,
          provinsiId: '31',
          kabupatenId: '3171',
        }),
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Access denied for the requested device' });
  });

  it('forces perusahaan id query on /proxy/realtime_all', async () => {
    mockListRealtimeAll.mockResolvedValue({
      status: true,
      message: 'Data realtime terbaru berhasil diambil',
      total: 1,
      filters: { id_perusahaan: '10' },
      data: [{ device_id_unik: 'DEV-10' }],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/realtime_all?id_perusahaan=99',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '10',
          username: 'perusahaan-user',
          name: 'Perusahaan User',
          role: 'perusahaan',
          pemdaScopeLevel: null,
          perusahaanId: 10,
          perusahaanName: 'PT Test',
          provinsiId: null,
          kabupatenId: null,
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockListRealtimeAll).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'perusahaan',
        perusahaanId: 10,
      }),
      { id_perusahaan: '10' },
    );
  });

  it('returns scoped realtime_all payload for pemda kabupaten users', async () => {
    mockListRealtimeAll.mockResolvedValue({
      status: true,
      message: 'Data realtime terbaru berhasil diambil',
      total: 1,
      filters: {},
      data: [{ device_id_unik: 'DEV-A', kabupaten_id: '3171' }],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/realtime_all',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '11',
          username: 'pemda-user',
          name: 'Pemda User',
          role: 'pemda',
          pemdaScopeLevel: 'kabupaten',
          perusahaanId: null,
          perusahaanName: null,
          provinsiId: '31',
          kabupatenId: '3171',
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: true,
      message: 'Data realtime terbaru berhasil diambil',
      total: 1,
      filters: {},
      data: [{ device_id_unik: 'DEV-A', kabupaten_id: '3171' }],
    });
  });

  it('returns realtime_device payload when device is inside authorized scope', async () => {
    mockListRealtimeDevice.mockResolvedValue({
      status: true,
      message: 'Data realtime device berhasil diambil',
      total: 1,
      filters: {
        device_id: 'DEV-1',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
      },
      data: [{ device_id_unik: 'DEV-1', timestamp_data: '2026-01-01 10:00:00' }],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/proxy/realtime_device?device_id=DEV-1&start_date=2026-01-01&end_date=2026-01-02',
      cookies: {
        [config.COOKIE_NAME]: buildCookie({
          sub: '11',
          username: 'pemda-user',
          name: 'Pemda User',
          role: 'pemda',
          pemdaScopeLevel: 'kabupaten',
          perusahaanId: null,
          perusahaanName: null,
          provinsiId: '31',
          kabupatenId: '3171',
        }),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: true,
      message: 'Data realtime device berhasil diambil',
      total: 1,
      filters: {
        device_id: 'DEV-1',
        start_date: '2026-01-01',
        end_date: '2026-01-02',
      },
      data: [{ device_id_unik: 'DEV-1', timestamp_data: '2026-01-01 10:00:00' }],
    });
  });
});
