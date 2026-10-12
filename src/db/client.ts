import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Logger } from 'pino';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(
  connectionString: string,
  logger: Logger
): {
  pool: Pool;
  db: Database;
} {
  const pool = new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true
  });
  pool.on('error', (error) => {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    logger.error({ errorCode: code }, 'Unexpected idle Postgres client error');
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  logger: Logger,
  label: string
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 3 || !isTransientConnectionError(error)) throw error;
      const delayMs = 250 * 2 ** (attempt - 1);
      logger.warn(
        { attempt, delayMs, label, errorCode: errorCode(error) },
        'Retrying Neon connection'
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isTransientConnectionError(error: unknown): boolean {
  const code = errorCode(error);
  return [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    '57P01',
    '57P03',
    '08000',
    '08003',
    '08006',
    '08001'
  ].includes(code);
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : '';
}
