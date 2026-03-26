import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index';

const {
  mockGetPublicMapSummary,
  mockListPublicMapDevices,
  mockGetPublicMapAnalytics,
  mockGetPublicMapFilters,
} = vi.hoisted(() => ({
  mockGetPublicMapSummary: vi.fn(),
  mockListPublicMapDevices: vi.fn(),
  mockGetPublicMapAnalytics: vi.fn(),
  mockGetPublicMapFilters: vi.fn(),
}));

vi.mock('../src/services/publicMapService', () => ({
  getPublicMapSummary: mockGetPublicMapSummary,
  listPublicMapDevices: mockListPublicMapDevices,
  getPublicMapAnalytics: mockGetPublicMapAnalytics,
  getPublicMapFilters: mockGetPublicMapFilters,
}));

describe('public map routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    vi.clearAllMocks();
  });

  it('returns public map summary payload', async () => {
    mockGetPublicMapSummary.mockResolvedValue({
      latest_data_date: '2026-03-26',
      default_start_date: '2026-02-25',
      default_end_date: '2026-03-26',
      total_devices: 100,
      active_devices: 91,
      critical_devices: 7,
      last_updated_at: '2026-03-26 09:00:00',
    });

    const response = await server.inject({
      method: 'GET',
      url: '/public/map/summary',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      latest_data_date: '2026-03-26',
      default_start_date: '2026-02-25',
      default_end_date: '2026-03-26',
      total_devices: 100,
      active_devices: 91,
      critical_devices: 7,
      last_updated_at: '2026-03-26 09:00:00',
    });
  });

  it('returns public map devices payload and forwards query filters', async () => {
    mockListPublicMapDevices.mockResolvedValue({
      status: true,
      message: 'Public map devices berhasil diambil',
      total: 1,
      filters: {
        provinsi: '14',
        jenis_perusahaan: 'PBPH',
      },
      data: [
        {
          device_id_unik: 'DEV-1',
          kode_titik: 'T-01',
          latitude: 1.02,
          longitude: 102.7,
          status: 'aktif',
          tipe_alat: 'TMAT',
          provinsi_id: '14',
          provinsi_nama: 'Riau',
          kabupaten_id: '1410',
          kabupaten_nama: 'Kepulauan Meranti',
          kecamatan_id: '1410010',
          kecamatan_nama: 'Tebing Tinggi',
          desa: 'Selatpanjang Selatan',
          id_perusahaan: 10,
          jenis_perusahaan: 'PBPH',
          perusahaan_nama: 'PT Test',
          latest_realtime: {
            timestamp_data: '2026-03-26 09:00:00',
            tmat_value: 88.5,
            curah_hujan: 0,
            kelembapan: 48.2,
            suhu_value: 29.1,
          },
        },
      ],
    });

    const response = await server.inject({
      method: 'GET',
      url: '/public/map/devices?provinsi=14&jenis_perusahaan=PBPH',
    });

    expect(response.statusCode).toBe(200);
    expect(mockListPublicMapDevices).toHaveBeenCalledWith({
      provinsi: '14',
      jenis_perusahaan: 'PBPH',
    });
    expect(response.json().total).toBe(1);
  });

  it('returns public analytics payload and forwards date range filters', async () => {
    mockGetPublicMapAnalytics.mockResolvedValue({
      status: true,
      message: 'Public map analytics berhasil diambil',
      filters: {
        start_date: '2026-03-01',
        end_date: '2026-03-26',
        provinsi: '14',
      },
      daily: [
        {
          date: '2026-03-26',
          safe: 10,
          low: 5,
          medium: 3,
          high: 1,
          veryhigh: 0,
          extreme: 0,
          offline: 2,
        },
      ],
      weekly: [
        {
          week: '2026-03-23',
          safe: 70,
          low: 20,
          medium: 10,
          high: 3,
          veryhigh: 1,
          extreme: 0,
          offline: 14,
        },
      ],
      trend: [
        {
          time: '2026-03-26',
          tmat: 52.4,
        },
      ],
      available_date_range: {
        min_date: '2025-01-01',
        max_date: '2026-03-26',
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/public/map/analytics?start_date=2026-03-01&end_date=2026-03-26&provinsi=14',
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetPublicMapAnalytics).toHaveBeenCalledWith({
      start_date: '2026-03-01',
      end_date: '2026-03-26',
      provinsi: '14',
    });
    expect(response.json().daily).toHaveLength(1);
  });

  it('returns public map filters payload', async () => {
    mockGetPublicMapFilters.mockResolvedValue({
      status: true,
      message: 'Public map filters berhasil diambil',
      data: {
        provinsi: [{ id: '14', nama: 'Riau' }],
        kabupaten: [{ id: '1410', nama: 'Kepulauan Meranti' }],
        kecamatan: [{ id: '1410010', nama: 'Tebing Tinggi' }],
        desa: ['Selatpanjang Selatan'],
        jenis_perusahaan: ['PBPH', 'Perkebunan'],
        available_date_range: {
          min_date: '2025-01-01',
          max_date: '2026-03-26',
        },
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/public/map/filters?provinsi=14',
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetPublicMapFilters).toHaveBeenCalledWith({
      provinsi: '14',
    });
    expect(response.json().data.provinsi).toEqual([{ id: '14', nama: 'Riau' }]);
  });
});
