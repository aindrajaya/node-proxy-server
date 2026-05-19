import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockEnrichRowsWithRegionNames } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockEnrichRowsWithRegionNames: vi.fn(),
}));

vi.mock('../src/db/mysql', () => ({
  mysqlPool: {
    execute: mockExecute,
  },
}));

vi.mock('../src/services/regionService', () => ({
  enrichRowsWithRegionNames: mockEnrichRowsWithRegionNames,
}));

describe('public map service scoped devices', async () => {
  const { listPublicMapDevices } = await import('../src/services/publicMapService');

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([[]]);
    mockEnrichRowsWithRegionNames.mockResolvedValue([]);
  });

  it('returns all scoped by admin query only', async () => {
    await listPublicMapDevices(
      { email: 'admin@example.com', role: 'admin', provinsi: '14' },
      { role: 'admin' },
    );

    const [sql, params] = mockExecute.mock.calls[0];
    expect(String(sql)).toContain('WHERE md.provinsi_id = ?');
    expect(params).toEqual(['14']);
  });

  it('forces perusahaan scope from DB even when query tampers id_perusahaan', async () => {
    await listPublicMapDevices(
      {
        email: 'corp@example.com',
        role: 'perusahaan',
        id_perusahaan: '9999',
        provinsi: '14',
      },
      { role: 'perusahaan', perusahaanId: 10 },
    );

    const [sql, params] = mockExecute.mock.calls[0];
    expect(String(sql)).toContain('md.id_perusahaan = ?');
    expect(params).toEqual(['14', '10']);
  });

  it('applies pemda provinsi scope from DB', async () => {
    await listPublicMapDevices(
      {
        email: 'pemda@example.com',
        role: 'pemda',
        provinsi: '14',
      },
      { role: 'pemda', pemdaScopeLevel: 'provinsi', provinsiId: '31', kabupatenId: null },
    );

    const [sql, params] = mockExecute.mock.calls[0];
    expect(String(sql)).toContain('md.provinsi_id = ?');
    expect(params).toEqual(['14', '31']);
  });

  it('applies pemda kabupaten scope from DB', async () => {
    await listPublicMapDevices(
      {
        email: 'pemda-kab@example.com',
        role: 'pemda',
        kabupaten: '1407',
      },
      { role: 'pemda', pemdaScopeLevel: 'kabupaten', provinsiId: '14', kabupatenId: '1410' },
    );

    const [sql, params] = mockExecute.mock.calls[0];
    expect(String(sql)).toContain('md.kabupaten_id = ?');
    expect(params).toEqual(['1407', '1410']);
  });
});
