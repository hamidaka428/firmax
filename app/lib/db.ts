import { Pool, types } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

// ---------------------------------------------------------------------------
// Types: we return numbers and ISO dates instead of strings/Date objects.
//   NUMERIC (1700) -> number   (prices, quantities, amounts)
//   INT8    (20)   -> number   (COUNT(*) etc.)
//   DATE    (1082) -> 'YYYY-MM-DD' (no time zones and no Date objects, safe for client components)
// ---------------------------------------------------------------------------
types.setTypeParser(1700, (value: string) => parseFloat(value));
types.setTypeParser(20, (value: string) => parseInt(value, 10));
types.setTypeParser(1082, (value: string) => value);

// A single shared Pool that survives Hot Reload in dev mode.
const globalForPg = globalThis as unknown as { __erpPool?: Pool };

function createPool(): Pool {
    const pool = process.env.DATABASE_URL
        ? new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 4000 })
        : new Pool({
              host: process.env.PGHOST ?? '127.0.0.1',
              port: Number(process.env.PGPORT ?? 5432),
              user: process.env.PGUSER ?? 'erp_admin',
              password: process.env.PGPASSWORD ?? 'erp_dev_password',
              database: process.env.PGDATABASE ?? 'erp_database',
              connectionTimeoutMillis: 4000, // if the database isn't running — fail fast instead of waiting minutes
          });

    pool.on('error', (err) => {
        console.error('Unexpected error in the PostgreSQL pool:', err);
    });

    return pool;
}

const pool = globalForPg.__erpPool ?? createPool();
if (process.env.NODE_ENV !== 'production') {
    globalForPg.__erpPool = pool;
}

export type DbClient = PoolClient;

/** The database is unreachable (container not running, wrong port, network). */
export class DatabaseUnavailableError extends Error {
    constructor() {
        super('Cannot connect to the database. Start the Docker container erp_postgres (docker compose up -d).');
        this.name = 'DatabaseUnavailableError';
    }
}

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN']);

function isConnectionError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const e = error as { code?: string; message?: string; errors?: unknown[] };
    if (e.code && CONNECTION_CODES.has(e.code)) return true;
    if (Array.isArray(e.errors) && e.errors.some(isConnectionError)) return true; // AggregateError (IPv4 + IPv6)
    return typeof e.message === 'string' && /timeout exceeded when trying to connect|Connection terminated/i.test(e.message);
}

/** Turns network errors into one clear error (and keeps AggregateError out of the log). */
function normalizeDbError(error: unknown): unknown {
    if (isConnectionError(error)) {
        if (process.env.NODE_ENV !== 'production') console.error('[db] Cannot connect to PostgreSQL — check that the erp_postgres container is running.');
        return new DatabaseUnavailableError();
    }
    return error;
}

/** Runs a single query through the shared pool. */
export async function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
): Promise<QueryResult<T>> {
    const start = Date.now();
    let res: QueryResult<T>;
    try {
        res = await pool.query<T>(text, params);
    } catch (error) {
        throw normalizeDbError(error);
    }
    if (process.env.NODE_ENV !== 'production') {
        console.log('Executed query', {
            text: text.replace(/\s+/g, ' ').trim().slice(0, 120),
            duration: Date.now() - start,
            rows: res.rowCount,
        });
    }
    return res;
}

/** Returns the first row or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
): Promise<T | null> {
    const res = await query<T>(text, params);
    return res.rows[0] ?? null;
}

/**
 * Runs the callback inside a single PostgreSQL transaction (BEGIN ... COMMIT).
 * On error it rolls back and rethrows the exception.
 * Inside the callback use `client.query(...)`, NOT the global `query()`.
 */
export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
        client = await pool.connect();
    } catch (error) {
        throw normalizeDbError(error);
    }
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('ROLLBACK failed:', rollbackError);
        }
        throw error;
    } finally {
        client.release();
    }
}
