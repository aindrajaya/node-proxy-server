import { RowDataPacket } from 'mysql2';
import { mysqlPool } from '../db/mysql';
import { enrichRowsWithRegionNames } from './regionService';

type QueryValue = string | number | boolean | null | undefined;

type RawQuery = Record<string, QueryValue>;

type DateRangeRow = RowDataPacket & {
  min_date: string | null;
  max_date: string | null;
};

type SummaryRow = RowDataPacket & {
  total_devices: number;
  active_devices: number;
  critical_devices: number;
  last_updated_at: string | null;
};

type PublicDeviceRow = RowDataPacket & {
  device_id_unik: string;
  kode_titik: string | null;
  latitude: number;
  longitude: number;
  status: 'aktif' | 'nonaktif' | 'perbaikan';
  tipe_alat: string | null;
  provinsi_id: string | null;
  kabupaten_id: string | null;
  kecamatan_id: string | null;
  kelurahan_id: string | null;
  desa: string | null;
  id_perusahaan: number | null;
  jenis_perusahaan: string | null;
  perusahaan_nama: string | null;
  latest_timestamp_data: string | null;
  latest_tmat_value: number | null;
  latest_hujan_value: number | null;
  latest_kelembapan_tanah: number | null;
  latest_suhu_value: number | null;
};

type DailyLatestRow = RowDataPacket & {
  bucket_date: string;
  device_id_unik: string;
  tmat_value: number | null;
};

type FilterOptionRow = RowDataPacket & {
  id: string | null;
  nama: string | null;
};

type VillageRow = RowDataPacket & {
  desa: string | null;
};

type CompanyTypeRow = RowDataPacket & {
  jenis_perusahaan: string | null;
};

type PublicFilterState = {
  clauses: string[];
  params: string[];
  appliedFilters: Record<string, string>;
};

type PublicDateRange = {
  min_date: string | null;
  max_date: string | null;
};

type TmatLevel = 'safe' | 'low' | 'medium' | 'high' | 'veryhigh' | 'extreme' | 'offline';

type DailyBucket = {
  date: string;
  safe: number;
  low: number;
  medium: number;
  high: number;
  veryhigh: number;
  extreme: number;
  offline: number;
};

type WeeklyBucket = {
  week: string;
  safe: number;
  low: number;
  medium: number;
  high: number;
  veryhigh: number;
  extreme: number;
  offline: number;
};

const DEFAULT_ANALYTICS_WINDOW_DAYS = 30;

// Inferred thresholds for public aggregation. Keep centralized so calibration is easy.
const TMAT_THRESHOLDS = {
  safeMax: 40,
  lowMax: 60,
  mediumMax: 80,
  highMax: 100,
  veryHighMax: 120,
} as const;

function toStringOrNull(value: QueryValue): string | null {
  if (value == null || value === '') {
    return null;
  }

  return String(value).trim();
}

function formatDateOnly(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateString: string, days: number): string {
  const base = new Date(`${dateString}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return formatDateOnly(base);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function startOfIsoWeek(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return formatDateOnly(date);
}

function buildPublicFilterState(query: RawQuery, mdAlias: string, mpAlias: string): PublicFilterState {
  const clauses: string[] = [];
  const params: string[] = [];
  const appliedFilters: Record<string, string> = {};

  const provinsiId = toStringOrNull(query.provinsi ?? query.provinsi_id);
  if (provinsiId) {
    clauses.push(`${mdAlias}.provinsi_id = ?`);
    params.push(provinsiId);
    appliedFilters.provinsi = provinsiId;
  }

  const kabupatenId = toStringOrNull(query.kabupaten ?? query.kabupaten_id);
  if (kabupatenId) {
    clauses.push(`${mdAlias}.kabupaten_id = ?`);
    params.push(kabupatenId);
    appliedFilters.kabupaten = kabupatenId;
  }

  const kecamatanId = toStringOrNull(query.kecamatan ?? query.kecamatan_id);
  if (kecamatanId) {
    clauses.push(`${mdAlias}.kecamatan_id = ?`);
    params.push(kecamatanId);
    appliedFilters.kecamatan = kecamatanId;
  }

  const desa = toStringOrNull(query.desa);
  if (desa) {
    clauses.push(`${mdAlias}.desa = ?`);
    params.push(desa);
    appliedFilters.desa = desa;
  }

  const jenisPerusahaan = toStringOrNull(query.jenis_perusahaan);
  if (jenisPerusahaan) {
    clauses.push(`${mpAlias}.jenis_perusahaan = ?`);
    params.push(jenisPerusahaan);
    appliedFilters.jenis_perusahaan = jenisPerusahaan;
  }

  return { clauses, params, appliedFilters };
}

function classifyTmatLevel(tmatValue: number | null): TmatLevel {
  if (tmatValue == null || Number.isNaN(Number(tmatValue))) {
    return 'offline';
  }

  if (tmatValue <= TMAT_THRESHOLDS.safeMax) return 'safe';
  if (tmatValue <= TMAT_THRESHOLDS.lowMax) return 'low';
  if (tmatValue <= TMAT_THRESHOLDS.mediumMax) return 'medium';
  if (tmatValue <= TMAT_THRESHOLDS.highMax) return 'high';
  if (tmatValue <= TMAT_THRESHOLDS.veryHighMax) return 'veryhigh';
  return 'extreme';
}

function createDailyBucket(date: string): DailyBucket {
  return {
    date,
    safe: 0,
    low: 0,
    medium: 0,
    high: 0,
    veryhigh: 0,
    extreme: 0,
    offline: 0,
  };
}

function createWeeklyBucket(week: string): WeeklyBucket {
  return {
    week,
    safe: 0,
    low: 0,
    medium: 0,
    high: 0,
    veryhigh: 0,
    extreme: 0,
    offline: 0,
  };
}

async function getAvailableDateRange(): Promise<PublicDateRange> {
  const [rows] = await mysqlPool.execute<DateRangeRow[]>(
    `
      SELECT
        DATE(MIN(timestamp_data)) AS min_date,
        DATE(MAX(timestamp_data)) AS max_date
      FROM data_realtime
    `,
  );

  return {
    min_date: rows[0]?.min_date ? formatDateOnly(rows[0].min_date) : null,
    max_date: rows[0]?.max_date ? formatDateOnly(rows[0].max_date) : null,
  };
}

async function resolveEffectiveDateRange(query: RawQuery): Promise<{
  availableDateRange: PublicDateRange;
  startDate: string | null;
  endDate: string | null;
}> {
  const availableDateRange = await getAvailableDateRange();
  const requestedStartDate = toStringOrNull(query.start_date);
  const requestedEndDate = toStringOrNull(query.end_date);
  const maxDate = availableDateRange.max_date;

  if (!maxDate) {
    return { availableDateRange, startDate: null, endDate: null };
  }

  const endDate = requestedEndDate ?? maxDate;
  const startDate = requestedStartDate ?? addDays(endDate, -(DEFAULT_ANALYTICS_WINDOW_DAYS - 1));

  return { availableDateRange, startDate, endDate };
}

function buildDeviceWhereSql(filters: PublicFilterState): string {
  return filters.clauses.length > 0 ? `WHERE ${filters.clauses.join(' AND ')}` : '';
}

export async function getPublicMapSummary() {
  const availableDateRange = await getAvailableDateRange();
  const latestDataDate = availableDateRange.max_date;
  const defaultEndDate = latestDataDate;
  const defaultStartDate = latestDataDate
    ? addDays(latestDataDate, -(DEFAULT_ANALYTICS_WINDOW_DAYS - 1))
    : null;

  const [rows] = await mysqlPool.execute<SummaryRow[]>(
    `
      SELECT
        COUNT(*) AS total_devices,
        SUM(CASE WHEN md.status = 'aktif' THEN 1 ELSE 0 END) AS active_devices,
        SUM(CASE WHEN latest.tmat_value > ? THEN 1 ELSE 0 END) AS critical_devices,
        MAX(latest.timestamp_data) AS last_updated_at
      FROM master_device md
      LEFT JOIN (
        SELECT dr.device_id_unik, dr.timestamp_data, dr.tmat_value
        FROM data_realtime dr
        INNER JOIN (
          SELECT device_id_unik, MAX(timestamp_data) AS latest_timestamp
          FROM data_realtime
          GROUP BY device_id_unik
        ) last_per_device
          ON last_per_device.device_id_unik = dr.device_id_unik
         AND last_per_device.latest_timestamp = dr.timestamp_data
      ) latest
        ON latest.device_id_unik = md.device_id_unik
    `,
    [TMAT_THRESHOLDS.highMax],
  );

  const summary = rows[0];

  return {
    latest_data_date: latestDataDate,
    default_start_date: defaultStartDate,
    default_end_date: defaultEndDate,
    total_devices: Number(summary?.total_devices ?? 0),
    active_devices: Number(summary?.active_devices ?? 0),
    critical_devices: Number(summary?.critical_devices ?? 0),
    last_updated_at: summary?.last_updated_at ?? null,
  };
}

export async function listPublicMapDevices(query: RawQuery) {
  const filters = buildPublicFilterState(query, 'md', 'mp');
  const whereSql = buildDeviceWhereSql(filters);

  const [rows] = await mysqlPool.execute<PublicDeviceRow[]>(
    `
      SELECT
        md.device_id_unik,
        md.kode_titik,
        md.latitude,
        md.longitude,
        md.status,
        md.tipe_alat,
        md.provinsi_id,
        md.kabupaten_id,
        md.kecamatan_id,
        md.kelurahan_id,
        md.desa,
        md.id_perusahaan,
        mp.jenis_perusahaan,
        mp.nama_perusahaan AS perusahaan_nama,
        latest.timestamp_data AS latest_timestamp_data,
        latest.tmat_value AS latest_tmat_value,
        latest.hujan_value AS latest_hujan_value,
        latest.kelembapan_tanah AS latest_kelembapan_tanah,
        latest.suhu_value AS latest_suhu_value
      FROM master_device md
      LEFT JOIN master_perusahaan mp
        ON mp.id = md.id_perusahaan
      LEFT JOIN (
        SELECT
          dr.device_id_unik,
          dr.timestamp_data,
          dr.tmat_value,
          dr.hujan_value,
          dr.kelembapan_tanah,
          dr.suhu_value
        FROM data_realtime dr
        INNER JOIN (
          SELECT device_id_unik, MAX(timestamp_data) AS latest_timestamp
          FROM data_realtime
          GROUP BY device_id_unik
        ) last_per_device
          ON last_per_device.device_id_unik = dr.device_id_unik
         AND last_per_device.latest_timestamp = dr.timestamp_data
      ) latest
        ON latest.device_id_unik = md.device_id_unik
      ${whereSql}
      ORDER BY md.id DESC
    `,
    filters.params,
  );

  const enrichedRows = await enrichRowsWithRegionNames(rows);

  return {
    status: true,
    message: 'Public map devices berhasil diambil',
    total: enrichedRows.length,
    filters: filters.appliedFilters,
    data: enrichedRows.map((row) => ({
      device_id_unik: row.device_id_unik,
      kode_titik: row.kode_titik,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      status: row.status,
      tipe_alat: row.tipe_alat,
      provinsi_id: row.provinsi_id,
      provinsi_nama: row.provinsi_nama,
      kabupaten_id: row.kabupaten_id,
      kabupaten_nama: row.kabupaten_nama,
      kecamatan_id: row.kecamatan_id,
      kecamatan_nama: row.kecamatan_nama,
      desa: row.desa,
      id_perusahaan: row.id_perusahaan,
      jenis_perusahaan: row.jenis_perusahaan,
      perusahaan_nama: row.perusahaan_nama,
      latest_realtime: {
        timestamp_data: row.latest_timestamp_data,
        tmat_value: row.latest_tmat_value,
        curah_hujan: row.latest_hujan_value,
        kelembapan: row.latest_kelembapan_tanah,
        suhu_value: row.latest_suhu_value,
      },
    })),
  };
}

async function countFilteredDevices(filters: PublicFilterState): Promise<number> {
  const whereSql = buildDeviceWhereSql(filters);
  const [rows] = await mysqlPool.execute<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total
      FROM master_device md
      LEFT JOIN master_perusahaan mp
        ON mp.id = md.id_perusahaan
      ${whereSql}
    `,
    filters.params,
  );

  return Number(rows[0]?.total ?? 0);
}

async function listDailyLatestRows(
  filters: PublicFilterState,
  startDate: string,
  endDate: string,
): Promise<DailyLatestRow[]> {
  const latestClauses = [...filters.clauses, 'DATE(dr2.timestamp_data) BETWEEN ? AND ?'];
  const latestParams = [...filters.params, startDate, endDate];

  const [rows] = await mysqlPool.execute<DailyLatestRow[]>(
    `
      SELECT
        DATE(dr.timestamp_data) AS bucket_date,
        dr.device_id_unik,
        dr.tmat_value
      FROM data_realtime dr
      INNER JOIN master_device md
        ON md.device_id_unik = dr.device_id_unik
      LEFT JOIN master_perusahaan mp
        ON mp.id = md.id_perusahaan
      INNER JOIN (
        SELECT
          dr2.device_id_unik,
          DATE(dr2.timestamp_data) AS bucket_date,
          MAX(dr2.timestamp_data) AS latest_timestamp
        FROM data_realtime dr2
        INNER JOIN master_device md
          ON md.device_id_unik = dr2.device_id_unik
        LEFT JOIN master_perusahaan mp
          ON mp.id = md.id_perusahaan
        WHERE ${latestClauses.join(' AND ')}
        GROUP BY dr2.device_id_unik, DATE(dr2.timestamp_data)
      ) latest
        ON latest.device_id_unik = dr.device_id_unik
       AND latest.bucket_date = DATE(dr.timestamp_data)
       AND latest.latest_timestamp = dr.timestamp_data
      ORDER BY bucket_date ASC, dr.device_id_unik ASC
    `,
    latestParams,
  );

  return rows;
}

function buildDailyBuckets(
  rows: DailyLatestRow[],
  totalDevices: number,
  startDate: string,
  endDate: string,
) {
  const buckets = new Map<string, DailyBucket>();

  for (const date of enumerateDates(startDate, endDate)) {
    buckets.set(date, createDailyBucket(date));
  }

  for (const row of rows) {
    const date = formatDateOnly(row.bucket_date);
    const bucket = buckets.get(date);
    if (!bucket) {
      continue;
    }

    const level = classifyTmatLevel(row.tmat_value);
    bucket[level] += 1;
  }

  for (const bucket of buckets.values()) {
    const onlineCount =
      bucket.safe +
      bucket.low +
      bucket.medium +
      bucket.high +
      bucket.veryhigh +
      bucket.extreme;
    bucket.offline = Math.max(totalDevices - onlineCount, 0);
  }

  return [...buckets.values()];
}

function buildWeeklyBuckets(dailyBuckets: DailyBucket[]) {
  const weeklyMap = new Map<string, WeeklyBucket>();

  for (const bucket of dailyBuckets) {
    const week = startOfIsoWeek(bucket.date);
    const weeklyBucket = weeklyMap.get(week) ?? createWeeklyBucket(week);

    weeklyBucket.safe += bucket.safe;
    weeklyBucket.low += bucket.low;
    weeklyBucket.medium += bucket.medium;
    weeklyBucket.high += bucket.high;
    weeklyBucket.veryhigh += bucket.veryhigh;
    weeklyBucket.extreme += bucket.extreme;
    weeklyBucket.offline += bucket.offline;

    weeklyMap.set(week, weeklyBucket);
  }

  return [...weeklyMap.values()];
}

function buildTrend(rows: DailyLatestRow[]) {
  const trendMap = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    if (row.tmat_value == null) {
      continue;
    }

    const date = formatDateOnly(row.bucket_date);
    const current = trendMap.get(date) ?? { total: 0, count: 0 };
    current.total += Number(row.tmat_value);
    current.count += 1;
    trendMap.set(date, current);
  }

  return [...trendMap.entries()].map(([time, value]) => ({
    time,
    tmat: value.count > 0 ? Number((value.total / value.count).toFixed(2)) : null,
  }));
}

export async function getPublicMapAnalytics(query: RawQuery) {
  const filters = buildPublicFilterState(query, 'md', 'mp');
  const { availableDateRange, startDate, endDate } = await resolveEffectiveDateRange(query);

  if (!startDate || !endDate) {
    return {
      status: true,
      message: 'Public map analytics berhasil diambil',
      filters: filters.appliedFilters,
      daily: [],
      weekly: [],
      trend: [],
      available_date_range: availableDateRange,
    };
  }

  const [totalDevices, rows] = await Promise.all([
    countFilteredDevices(filters),
    listDailyLatestRows(filters, startDate, endDate),
  ]);

  const daily = buildDailyBuckets(rows, totalDevices, startDate, endDate);
  const weekly = buildWeeklyBuckets(daily);
  const trend = buildTrend(rows);

  return {
    status: true,
    message: 'Public map analytics berhasil diambil',
    filters: {
      ...filters.appliedFilters,
      start_date: startDate,
      end_date: endDate,
    },
    daily,
    weekly,
    trend,
    available_date_range: availableDateRange,
  };
}

async function listRegionOptions(
  level: 'provinsi' | 'kabupaten' | 'kecamatan',
  query: RawQuery,
): Promise<Array<{ id: string; nama: string }>> {
  let joinTable = 't_provinsi';
  let codeColumn = 'md.provinsi_id';

  if (level === 'kabupaten') {
    joinTable = 't_kota';
    codeColumn = 'md.kabupaten_id';
  } else if (level === 'kecamatan') {
    joinTable = 't_kecamatan';
    codeColumn = 'md.kecamatan_id';
  }

  const filters = buildPublicFilterState(query, 'md', 'mp');
  const clauses = [...filters.clauses, `${codeColumn} IS NOT NULL`];
  const [rows] = await mysqlPool.execute<FilterOptionRow[]>(
    `
      SELECT DISTINCT ${codeColumn} AS id, reg.nama
      FROM master_device md
      LEFT JOIN master_perusahaan mp
        ON mp.id = md.id_perusahaan
      INNER JOIN ${joinTable} reg
        ON reg.id = ${codeColumn}
      WHERE ${clauses.join(' AND ')}
      ORDER BY reg.nama ASC
    `,
    filters.params,
  );

  return rows
    .filter((row): row is FilterOptionRow & { id: string; nama: string } => !!row.id && !!row.nama)
    .map((row) => ({
      id: String(row.id),
      nama: row.nama,
    }));
}

async function listVillageOptions(query: RawQuery): Promise<string[]> {
  const filters = buildPublicFilterState(query, 'md', 'mp');
  const clauses = [...filters.clauses, 'md.desa IS NOT NULL', "md.desa <> ''"];
  const [rows] = await mysqlPool.execute<VillageRow[]>(
    `
      SELECT DISTINCT md.desa
      FROM master_device md
      LEFT JOIN master_perusahaan mp
        ON mp.id = md.id_perusahaan
      WHERE ${clauses.join(' AND ')}
      ORDER BY md.desa ASC
    `,
    filters.params,
  );

  return rows.map((row) => row.desa).filter((value): value is string => !!value);
}

async function listJenisPerusahaanOptions(query: RawQuery): Promise<string[]> {
  const filters = buildPublicFilterState(query, 'md', 'mp');
  const clauses = [...filters.clauses, 'mp.jenis_perusahaan IS NOT NULL'];
  const [rows] = await mysqlPool.execute<CompanyTypeRow[]>(
    `
      SELECT DISTINCT mp.jenis_perusahaan
      FROM master_device md
      LEFT JOIN master_perusahaan mp
        ON mp.id = md.id_perusahaan
      WHERE ${clauses.join(' AND ')}
      ORDER BY mp.jenis_perusahaan ASC
    `,
    filters.params,
  );

  return rows
    .map((row) => row.jenis_perusahaan)
    .filter((value): value is string => !!value);
}

export async function getPublicMapFilters(query: RawQuery) {
  const availableDateRange = await getAvailableDateRange();
  const [provinsi, kabupaten, kecamatan, desa, jenisPerusahaan] = await Promise.all([
    listRegionOptions('provinsi', query),
    listRegionOptions('kabupaten', query),
    listRegionOptions('kecamatan', query),
    listVillageOptions(query),
    listJenisPerusahaanOptions(query),
  ]);

  return {
    status: true,
    message: 'Public map filters berhasil diambil',
    data: {
      provinsi,
      kabupaten,
      kecamatan,
      desa,
      jenis_perusahaan: jenisPerusahaan,
      available_date_range: availableDateRange,
    },
  };
}
