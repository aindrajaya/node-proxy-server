import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetUserByEmail, mockResolveRoleFromGroup } = vi.hoisted(() => ({
  mockGetUserByEmail: vi.fn(),
  mockResolveRoleFromGroup: vi.fn(),
}));

vi.mock('../src/services/userService', () => ({
  getUserByEmail: mockGetUserByEmail,
}));

vi.mock('../src/services/roleService', () => ({
  resolveRoleFromGroup: mockResolveRoleFromGroup,
}));

describe('public map identity service', async () => {
  const { PublicMapAccessError, resolvePublicMapScope } = await import(
    '../src/services/publicMapIdentityService'
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves admin scope when email and role match DB role', async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: 1,
      username: 'admin',
      email: 'admin@example.com',
      password: 'hash',
      first_name: 'Admin',
      last_name: null,
      active: 1,
      id_perusahaan: null,
      provinsi_id: null,
      kabupaten_id: null,
      group_id: 1,
      nama_perusahaan: null,
    });
    mockResolveRoleFromGroup.mockReturnValue('admin');

    await expect(
      resolvePublicMapScope({ email: 'admin@example.com', role: 'admin' }),
    ).resolves.toEqual({ role: 'admin' });
  });

  it('returns perusahaan scope from DB company id', async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: 10,
      username: 'corp',
      email: 'corp@example.com',
      password: 'hash',
      first_name: null,
      last_name: null,
      active: 1,
      id_perusahaan: 33,
      provinsi_id: null,
      kabupaten_id: null,
      group_id: 2,
      nama_perusahaan: 'PT Corp',
    });
    mockResolveRoleFromGroup.mockReturnValue('perusahaan');

    await expect(
      resolvePublicMapScope({ email: 'corp@example.com', role: 'perusahaan' }),
    ).resolves.toEqual({
      role: 'perusahaan',
      perusahaanId: 33,
    });
  });

  it('returns pemda provinsi scope when kabupaten is not assigned', async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: 20,
      username: 'pemda-prov',
      email: 'pemda-prov@example.com',
      password: 'hash',
      first_name: null,
      last_name: null,
      active: 1,
      id_perusahaan: null,
      provinsi_id: '31',
      kabupaten_id: null,
      group_id: 3,
      nama_perusahaan: null,
    });
    mockResolveRoleFromGroup.mockReturnValue('pemda');

    await expect(
      resolvePublicMapScope({ email: 'pemda-prov@example.com', role: 'pemda' }),
    ).resolves.toEqual({
      role: 'pemda',
      pemdaScopeLevel: 'provinsi',
      provinsiId: '31',
      kabupatenId: null,
    });
  });

  it('returns pemda kabupaten scope when kabupaten is assigned', async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: 21,
      username: 'pemda-kab',
      email: 'pemda-kab@example.com',
      password: 'hash',
      first_name: null,
      last_name: null,
      active: 1,
      id_perusahaan: null,
      provinsi_id: '31',
      kabupaten_id: '3171',
      group_id: 4,
      nama_perusahaan: null,
    });
    mockResolveRoleFromGroup.mockReturnValue('pemda');

    await expect(
      resolvePublicMapScope({ email: 'pemda-kab@example.com', role: 'pemda' }),
    ).resolves.toEqual({
      role: 'pemda',
      pemdaScopeLevel: 'kabupaten',
      provinsiId: '31',
      kabupatenId: '3171',
    });
  });

  it('throws 400 when email or role is missing', async () => {
    await expect(resolvePublicMapScope({ role: 'admin' })).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'email and role are required',
      }),
    );
  });

  it('throws 403 when email is not found', async () => {
    mockGetUserByEmail.mockResolvedValue(null);

    await expect(
      resolvePublicMapScope({ email: 'missing@example.com', role: 'admin' }),
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 403,
        message: 'Access denied',
      }),
    );
  });

  it('throws 403 when role does not match DB role', async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: 1,
      username: 'admin',
      email: 'admin@example.com',
      password: 'hash',
      first_name: null,
      last_name: null,
      active: 1,
      id_perusahaan: null,
      provinsi_id: null,
      kabupaten_id: null,
      group_id: 1,
      nama_perusahaan: null,
    });
    mockResolveRoleFromGroup.mockReturnValue('admin');

    await expect(
      resolvePublicMapScope({ email: 'admin@example.com', role: 'perusahaan' }),
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 403,
        message: 'Access denied',
      }),
    );
  });

  it('throws 403 when perusahaan user has no company scope', async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: 10,
      username: 'corp',
      email: 'corp@example.com',
      password: 'hash',
      first_name: null,
      last_name: null,
      active: 1,
      id_perusahaan: null,
      provinsi_id: null,
      kabupaten_id: null,
      group_id: 2,
      nama_perusahaan: null,
    });
    mockResolveRoleFromGroup.mockReturnValue('perusahaan');

    await expect(
      resolvePublicMapScope({ email: 'corp@example.com', role: 'perusahaan' }),
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 403,
        message: 'Access denied',
      }),
    );
  });

  it('throws 403 when pemda user has no region scope', async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: 20,
      username: 'pemda',
      email: 'pemda@example.com',
      password: 'hash',
      first_name: null,
      last_name: null,
      active: 1,
      id_perusahaan: null,
      provinsi_id: null,
      kabupaten_id: null,
      group_id: 3,
      nama_perusahaan: null,
    });
    mockResolveRoleFromGroup.mockReturnValue('pemda');

    await expect(
      resolvePublicMapScope({ email: 'pemda@example.com', role: 'pemda' }),
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 403,
        message: 'Access denied',
      }),
    );
  });
});
