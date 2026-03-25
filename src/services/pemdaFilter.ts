import { IProxyUser } from '../types';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function getItems(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data;
  }

  return null;
}

export function matchesPemdaScope(item: unknown, user: IProxyUser): boolean {
  if (!isRecord(item) || user.role !== 'pemda') {
    return false;
  }

  if (user.pemdaScopeLevel === 'kabupaten' && user.kabupatenId && item.kabupaten_id != null) {
    return String(item.kabupaten_id) === String(user.kabupatenId);
  }

  if (user.pemdaScopeLevel === 'provinsi' && user.provinsiId && item.provinsi_id != null) {
    return String(item.provinsi_id) === String(user.provinsiId);
  }

  return false;
}

export function filterPemdaPayload(payload: unknown, user: IProxyUser): unknown {
  if (user.role !== 'pemda') {
    return payload;
  }

  const items = getItems(payload);
  if (!items) {
    return payload;
  }

  const filteredItems = items.filter((item) => matchesPemdaScope(item, user));

  if (Array.isArray(payload)) {
    return filteredItems;
  }

  if (isRecord(payload)) {
    return {
      ...payload,
      data: filteredItems,
    };
  }

  return payload;
}
