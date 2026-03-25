import { config } from '../config';

export function resolveRoleFromGroup(groupId: number): 'admin' | 'perusahaan' | 'pemda' {
  if (groupId === config.ROLE_ADMIN_GROUP_ID) return 'admin';
  if (groupId === config.ROLE_PERUSAHAAN_GROUP_ID) return 'perusahaan';
  if (config.ROLE_PEMDA_GROUP_IDS.includes(groupId)) return 'pemda';
  throw new Error(`Unknown group_id: ${groupId}`);
}
