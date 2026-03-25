import { mysqlPool } from '../db/mysql';
import bcrypt from 'bcryptjs';
import { IDbUser } from '../types';
import { RowDataPacket } from 'mysql2';

export async function getUserByIdentifier(identifier: string): Promise<IDbUser | null> {
  const [rows] = await mysqlPool.execute<(IDbUser & RowDataPacket)[]>(
    `SELECT u.id, u.username, u.email, u.password,
            u.first_name, u.last_name, u.active,
            u.id_perusahaan, u.provinsi_id, u.kabupaten_id,
            ug.group_id, mp.nama_perusahaan
     FROM users u
     LEFT JOIN users_groups ug ON ug.user_id = u.id
     LEFT JOIN master_perusahaan mp ON mp.id = u.id_perusahaan
     WHERE (u.email = ? OR u.username = ?)
     LIMIT 1`,
    [identifier, identifier]
  );
  return rows[0] ?? null;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash); // salt rounds: 12 (set at user creation time)
}
