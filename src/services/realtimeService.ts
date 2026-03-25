import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '../db/mysql';
import { IProxyUser } from '../types';
import { canUserAccessDeviceFromDb } from './deviceService';
import { enrichRowsWithRegionNames } from './regionService';

type QueryValue = string | number | boolean | null | undefined;

type RawQuery = Record<string, QueryValue>;

type RealtimeRow = RowDataPacket & {
  id: number;
  device_id_unik: string;
  id_perusahaan: number | null;
  timestamp_data: string;
  tmat_value: number | null;
  suhu_value: number | null;
  ph_value: number | null;
  hujan_value: number | null;
  kelembapan_tanah: number | null;
  baterai_value: number | null;
  tss_value: number | null;
  flklhk_value: number | null;
  api_key_used: string | null;
  serial_number_value: string | null;
  id_stasiun_value: string | null;
  method: string | null;
  header_data: string | null;
  body_data: string | null;
  provinsi_id: string | null;
  kabupaten_id: string | null;
  tipe_alat: string | null;
  alamat: string | null;
  device_internal_id: number;
};

function toStringOrNull(value: QueryValue): string | null {
  if (value == null || value === '') {
    return null;
  }

  return String(value);
}

function toPositiveInt(value: QueryValue, fallback: number): number {
  const raw = toStringOrNull(value);
  if (!raw) {
    return fallback;
  }

  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function shouldIncludeRegionNames(query: RawQuery): boolean {
  const raw = toStringOrNull(query.include_region_names);
  if (!raw) {
    return false;
  }

  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
}

function buildScopeClauses(
  user: IProxyUser,
  mdAlias = 'md',
): { clauses: string[]; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];

  if (user.role === 'perusahaan' && user.perusahaanId != null) {
    clauses.push(`${mdAlias}.id_perusahaan = ?`);
    params.push(String(user.perusahaanId));
  }

  if (user.role === 'pemda') {
    if (user.pemdaScopeLevel === 'kabupaten' && user.kabupatenId) {
      clauses.push(`${mdAlias}.kabupaten_id = ?`);
      params.push(user.kabupatenId);
    } else if (user.pemdaScopeLevel === 'provinsi' && user.provinsiId) {
      clauses.push(`${mdAlias}.provinsi_id = ?`);
      params.push(user.provinsiId);
    }
  }

  return { clauses, params };
}

function buildRealtimeFilters(
  query: RawQuery,
  drAlias = 'dr',
  mdAlias = 'md',
): {
  clauses: string[];
  params: string[];
  filters: Record<string, string | number>;
} {
  const clauses: string[] = [];
  const params: string[] = [];
  const filters: Record<string, string | number> = {};

  const idPerusahaan = toStringOrNull(query.id_perusahaan);
  if (idPerusahaan) {
    clauses.push(`${mdAlias}.id_perusahaan = ?`);
    params.push(idPerusahaan);
    filters.id_perusahaan = idPerusahaan;
  }

  const deviceId = toStringOrNull(query.device_id);
  if (deviceId) {
    clauses.push(`(${drAlias}.device_id_unik = ? OR CAST(${mdAlias}.id AS CHAR) = ?)`);
    params.push(deviceId, deviceId);
    filters.device_id = deviceId;
  }

  const startDate = toStringOrNull(query.start_date);
  if (startDate) {
    clauses.push(`${drAlias}.timestamp_data >= ?`);
    params.push(`${startDate} 00:00:00`);
    filters.start_date = startDate;
  }

  const endDate = toStringOrNull(query.end_date);
  if (endDate) {
    clauses.push(`${drAlias}.timestamp_data <= ?`);
    params.push(`${endDate} 23:59:59`);
    filters.end_date = endDate;
  }

  return { clauses, params, filters };
}

export async function listRealtimeAll(user: IProxyUser, query: RawQuery) {
  const scope = buildScopeClauses(user, 'md');
  const filters = buildRealtimeFilters(query, 'dr', 'md');
  const latestScope = buildScopeClauses(user, 'md2');
  const latestFilters = buildRealtimeFilters(query, 'dr2', 'md2');
  const limit = Math.min(toPositiveInt(query.limit, 100), 500);
  const offset = toPositiveInt(query.offset, 0);
  const includeRegionNames = shouldIncludeRegionNames(query);

  const whereClauses = [...scope.clauses, ...filters.clauses];
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const params = [...scope.params, ...filters.params];
  const latestWhereClauses = [...latestScope.clauses, ...latestFilters.clauses];
  const latestWhereSql =
    latestWhereClauses.length > 0 ? `WHERE ${latestWhereClauses.join(' AND ')}` : '';
  const latestParams = [...latestScope.params, ...latestFilters.params];

  const [rows] = await mysqlPool.execute<RealtimeRow[]>(
    `
      SELECT
        dr.id,
        dr.device_id_unik,
        dr.id_perusahaan,
        dr.timestamp_data,
        dr.tmat_value,
        dr.suhu_value,
        dr.ph_value,
        dr.hujan_value,
        dr.kelembapan_tanah,
        dr.baterai_value,
        dr.tss_value,
        dr.flklhk_value,
        dr.api_key_used,
        dr.serial_number_value,
        dr.id_stasiun_value,
        dr.method,
        dr.header_data,
        dr.body_data,
        md.id AS device_internal_id,
        md.provinsi_id,
        md.kabupaten_id,
        md.tipe_alat,
        md.alamat
      FROM data_realtime dr
      INNER JOIN master_device md ON md.device_id_unik = dr.device_id_unik
      INNER JOIN (
        SELECT dr2.device_id_unik, MAX(dr2.timestamp_data) AS latest_timestamp
        FROM data_realtime dr2
        INNER JOIN master_device md2 ON md2.device_id_unik = dr2.device_id_unik
        ${latestWhereSql}
        GROUP BY device_id_unik
      ) latest
        ON latest.device_id_unik = dr.device_id_unik
       AND latest.latest_timestamp = dr.timestamp_data
      ${whereSql}
      ORDER BY dr.timestamp_data DESC, dr.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    [...latestParams, ...params],
  );

  const data = includeRegionNames ? await enrichRowsWithRegionNames(rows) : rows.map((row) => ({ ...row }));

  return {
    status: true,
    message: 'Data realtime terbaru berhasil diambil',
    total: rows.length,
    filters: {
      ...filters.filters,
      ...(offset > 0 ? { offset } : {}),
      ...(limit !== 100 ? { limit } : {}),
      ...(includeRegionNames ? { include_region_names: 'true' } : {}),
    },
    data,
  };
}

export async function listRealtimeDevice(user: IProxyUser, query: RawQuery) {
  const deviceId = toStringOrNull(query.device_id);
  if (!deviceId) {
    return { error: 'device_id is required' as const };
  }

  const allowed = await canUserAccessDeviceFromDb(user, deviceId);
  if (!allowed) {
    return { error: 'Access denied for the requested device' as const };
  }

  const filters = buildRealtimeFilters(query, 'dr', 'md');
  const limit = Math.min(toPositiveInt(query.limit, 100), 1000);
  const offset = toPositiveInt(query.offset, 0);
  const includeRegionNames = shouldIncludeRegionNames(query);

  const [rows] = await mysqlPool.execute<RealtimeRow[]>(
    `
      SELECT
        dr.id,
        dr.device_id_unik,
        dr.id_perusahaan,
        dr.timestamp_data,
        dr.tmat_value,
        dr.suhu_value,
        dr.ph_value,
        dr.hujan_value,
        dr.kelembapan_tanah,
        dr.baterai_value,
        dr.tss_value,
        dr.flklhk_value,
        dr.api_key_used,
        dr.serial_number_value,
        dr.id_stasiun_value,
        dr.method,
        dr.header_data,
        dr.body_data,
        md.id AS device_internal_id,
        md.provinsi_id,
        md.kabupaten_id,
        md.tipe_alat,
        md.alamat
      FROM data_realtime dr
      INNER JOIN master_device md ON md.device_id_unik = dr.device_id_unik
      WHERE ${filters.clauses.join(' AND ')}
      ORDER BY dr.timestamp_data DESC, dr.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    filters.params,
  );

  const data = includeRegionNames ? await enrichRowsWithRegionNames(rows) : rows.map((row) => ({ ...row }));

  return {
    status: true,
    message: 'Data realtime device berhasil diambil',
    total: rows.length,
    filters: {
      ...filters.filters,
      ...(offset > 0 ? { offset } : {}),
      ...(limit !== 100 ? { limit } : {}),
      ...(includeRegionNames ? { include_region_names: 'true' } : {}),
    },
    data,
  };
}
