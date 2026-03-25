import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '../db/mysql';
import { IProxyUser } from '../types';
import { enrichRowsWithRegionNames } from './regionService';

type QueryValue = string | number | boolean | null | undefined;

type RawQuery = Record<string, QueryValue>;

type DeviceRow = RowDataPacket & {
  id: number;
  device_id_unik: string;
  id_perusahaan: number;
  tipe_alat: string | null;
  alamat: string | null;
  provinsi_id: string | null;
  kabupaten_id: string | null;
  kecamatan_id: string | null;
  kelurahan_id: string | null;
  kode_pos: string | null;
  desa: string | null;
  latitude: number;
  longitude: number;
  kode_titik: string | null;
  kode_blok: string | null;
  status: 'aktif' | 'nonaktif' | 'perbaikan';
  last_online: string | null;
  created_at: string;
};

const ALLOWED_FILTER_KEYS = new Set([
  'device_id_unik',
  'id_perusahaan',
  'tipe_alat',
  'status',
  'provinsi_id',
  'kabupaten_id',
  'kode_titik',
  'kode_blok',
]);

function pickDeviceFilters(query: RawQuery): Record<string, string> {
  const filters: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (!ALLOWED_FILTER_KEYS.has(key) || value == null || value === '') {
      continue;
    }

    filters[key] = String(value);
  }

  return filters;
}

function shouldIncludeRegionNames(query: RawQuery): boolean {
  const value = query.include_region_names;
  if (value == null) {
    return false;
  }

  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function buildScopedWhere(user: IProxyUser, filters: Record<string, string>) {
  const clauses: string[] = [];
  const params: string[] = [];
  const effectiveFilters = { ...filters };

  if (user.role === 'perusahaan' && user.perusahaanId != null) {
    effectiveFilters.id_perusahaan = String(user.perusahaanId);
  }

  for (const [key, value] of Object.entries(effectiveFilters)) {
    clauses.push(`md.${key} = ?`);
    params.push(value);
  }

  if (user.role === 'pemda') {
    if (user.pemdaScopeLevel === 'kabupaten' && user.kabupatenId) {
      clauses.push('md.kabupaten_id = ?');
      params.push(user.kabupatenId);
    } else if (user.pemdaScopeLevel === 'provinsi' && user.provinsiId) {
      clauses.push('md.provinsi_id = ?');
      params.push(user.provinsiId);
    }
  }

  return {
    clauses,
    params,
    effectiveFilters,
  };
}

export async function listDevices(user: IProxyUser, query: RawQuery) {
  const requestedFilters = pickDeviceFilters(query);
  const { clauses, params, effectiveFilters } = buildScopedWhere(user, requestedFilters);
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const includeRegionNames = shouldIncludeRegionNames(query);

  const [rows] = await mysqlPool.execute<DeviceRow[]>(
    `
      SELECT
        md.id,
        md.device_id_unik,
        md.id_perusahaan,
        md.tipe_alat,
        md.alamat,
        md.provinsi_id,
        md.kabupaten_id,
        md.kecamatan_id,
        md.kelurahan_id,
        md.kode_pos,
        md.desa,
        md.latitude,
        md.longitude,
        md.kode_titik,
        md.kode_blok,
        md.status,
        md.last_online,
        md.created_at
      FROM master_device md
      ${whereSql}
      ORDER BY md.id DESC
    `,
    params,
  );

  const data = includeRegionNames ? await enrichRowsWithRegionNames(rows) : rows.map((row) => ({ ...row }));

  return {
    status: true,
    message: 'Daftar device berhasil diambil',
    total: rows.length,
    filters: {
      ...effectiveFilters,
      ...(includeRegionNames ? { include_region_names: 'true' } : {}),
    },
    data,
  };
}

export async function canUserAccessDeviceFromDb(
  user: IProxyUser,
  deviceId: string,
): Promise<boolean> {
  if (user.role === 'admin') {
    return true;
  }

  const clauses = ['(md.device_id_unik = ? OR CAST(md.id AS CHAR) = ?)'];
  const params: string[] = [deviceId, deviceId];

  if (user.role === 'perusahaan' && user.perusahaanId != null) {
    clauses.push('md.id_perusahaan = ?');
    params.push(String(user.perusahaanId));
  }

  if (user.role === 'pemda') {
    if (user.pemdaScopeLevel === 'kabupaten' && user.kabupatenId) {
      clauses.push('md.kabupaten_id = ?');
      params.push(user.kabupatenId);
    } else if (user.pemdaScopeLevel === 'provinsi' && user.provinsiId) {
      clauses.push('md.provinsi_id = ?');
      params.push(user.provinsiId);
    }
  }

  const [rows] = await mysqlPool.execute<RowDataPacket[]>(
    `
      SELECT md.id
      FROM master_device md
      WHERE ${clauses.join(' AND ')}
      LIMIT 1
    `,
    params,
  );

  return rows.length > 0;
}
