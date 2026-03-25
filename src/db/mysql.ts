import mysql from 'mysql2/promise';
import { config } from '../config';

export const mysqlPool = mysql.createPool({
  host: config.DB_HOST,
  port: Math.floor(config.DB_PORT),
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  connectionLimit: config.DB_CONNECTION_LIMIT,
  timezone: '+07:00' // WIB +07:00 as per PRD
});
