import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '../db/mysql';

type QueryValue = string | number | boolean | null | undefined;

type RegionLevel = 'provinsi' | 'kabupaten' | 'kecamatan' | 'kelurahan';

type RegionRow = RowDataPacket & {
  id: string;
  nama: string;
  latitude: number;
  longitude: number;
};

type RegionLookup = {
  provinsi_id?: string | null;
  kabupaten_id?: string | null;
  kecamatan_id?: string | null;
  kelurahan_id?: string | null;
};

export type RegionNames = {
  provinsi_nama: string | null;
  kabupaten_nama: string | null;
  kecamatan_nama: string | null;
  kelurahan_nama: string | null;
};

const REGION_TABLES: Record<RegionLevel, string> = {
  provinsi: 't_provinsi',
  kabupaten: 't_kota',
  kecamatan: 't_kecamatan',
  kelurahan: 't_kelurahan',
};

function toStringOrNull(value: QueryValue): string | null {
  if (value == null || value === '') {
    return null;
  }

  return String(value);
}

function normalizeId(value: string | null | undefined): string | null {
  const raw = toStringOrNull(value);
  return raw ? raw.trim() : null;
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeId(value)).filter((value): value is string => !!value))];
}

function getHierarchyClause(level: RegionLevel, query: Record<string, QueryValue>) {
  const clauses: string[] = [];
  const params: string[] = [];

  const provinsiId = normalizeId(toStringOrNull(query.provinsi_id ?? query.province_id));
  const kabupatenId = normalizeId(toStringOrNull(query.kabupaten_id ?? query.city_id));
  const kecamatanId = normalizeId(toStringOrNull(query.kecamatan_id ?? query.district_id));

  if (level === 'kabupaten' && provinsiId) {
    clauses.push('id LIKE ?');
    params.push(`${provinsiId}%`);
  }

  if (level === 'kecamatan') {
    if (kabupatenId) {
      clauses.push('id LIKE ?');
      params.push(`${kabupatenId}%`);
    } else if (provinsiId) {
      clauses.push('id LIKE ?');
      params.push(`${provinsiId}%`);
    }
  }

  if (level === 'kelurahan') {
    if (kecamatanId) {
      clauses.push('id LIKE ?');
      params.push(`${kecamatanId}%`);
    } else if (kabupatenId) {
      clauses.push('id LIKE ?');
      params.push(`${kabupatenId}%`);
    } else if (provinsiId) {
      clauses.push('id LIKE ?');
      params.push(`${provinsiId}%`);
    }
  }

  return { clauses, params };
}

export async function listRegions(level: RegionLevel, query: Record<string, QueryValue>) {
  const tableName = REGION_TABLES[level];
  const { clauses, params } = getHierarchyClause(level, query);
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const [rows] = await mysqlPool.execute<RegionRow[]>(
    `
      SELECT id, nama, latitude, longitude
      FROM ${tableName}
      ${whereSql}
      ORDER BY nama ASC
    `,
    params,
  );

  return {
    status: true,
    message: `Data ${level} berhasil diambil`,
    total: rows.length,
    data: rows.map((row) => ({
      id: String(row.id),
      nama: row.nama,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    })),
  };
}

export async function resolveRegionNames(input: RegionLookup): Promise<RegionNames> {
  const [provinsiMap, kabupatenMap, kecamatanMap, kelurahanMap] = await Promise.all([
    getRegionNameMap('provinsi', uniqueIds([input.provinsi_id])),
    getRegionNameMap('kabupaten', uniqueIds([input.kabupaten_id])),
    getRegionNameMap('kecamatan', uniqueIds([input.kecamatan_id])),
    getRegionNameMap('kelurahan', uniqueIds([input.kelurahan_id])),
  ]);

  return {
    provinsi_nama: input.provinsi_id ? provinsiMap.get(String(input.provinsi_id)) ?? null : null,
    kabupaten_nama: input.kabupaten_id ? kabupatenMap.get(String(input.kabupaten_id)) ?? null : null,
    kecamatan_nama: input.kecamatan_id ? kecamatanMap.get(String(input.kecamatan_id)) ?? null : null,
    kelurahan_nama: input.kelurahan_id ? kelurahanMap.get(String(input.kelurahan_id)) ?? null : null,
  };
}

export async function enrichRowsWithRegionNames<T extends RegionLookup>(rows: T[]): Promise<Array<T & RegionNames>> {
  const [provinsiMap, kabupatenMap, kecamatanMap, kelurahanMap] = await Promise.all([
    getRegionNameMap('provinsi', uniqueIds(rows.map((row) => row.provinsi_id))),
    getRegionNameMap('kabupaten', uniqueIds(rows.map((row) => row.kabupaten_id))),
    getRegionNameMap('kecamatan', uniqueIds(rows.map((row) => row.kecamatan_id))),
    getRegionNameMap('kelurahan', uniqueIds(rows.map((row) => row.kelurahan_id))),
  ]);

  return rows.map((row) => ({
    ...row,
    provinsi_nama: row.provinsi_id ? provinsiMap.get(String(row.provinsi_id)) ?? null : null,
    kabupaten_nama: row.kabupaten_id ? kabupatenMap.get(String(row.kabupaten_id)) ?? null : null,
    kecamatan_nama: row.kecamatan_id ? kecamatanMap.get(String(row.kecamatan_id)) ?? null : null,
    kelurahan_nama: row.kelurahan_id ? kelurahanMap.get(String(row.kelurahan_id)) ?? null : null,
  }));
}

export async function resolveRegionLookup(query: Record<string, QueryValue>) {
  const regionNames = await resolveRegionNames({
    provinsi_id: normalizeId(toStringOrNull(query.provinsi_id)),
    kabupaten_id: normalizeId(toStringOrNull(query.kabupaten_id)),
    kecamatan_id: normalizeId(toStringOrNull(query.kecamatan_id)),
    kelurahan_id: normalizeId(toStringOrNull(query.kelurahan_id)),
  });

  return {
    status: true,
    message: 'Nama wilayah berhasil di-resolve',
    data: regionNames,
  };
}

async function getRegionNameMap(level: RegionLevel, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }

  const tableName = REGION_TABLES[level];
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await mysqlPool.execute<RegionRow[]>(
    `
      SELECT id, nama
      FROM ${tableName}
      WHERE id IN (${placeholders})
    `,
    ids,
  );

  return new Map(rows.map((row) => [String(row.id), row.nama]));
}
