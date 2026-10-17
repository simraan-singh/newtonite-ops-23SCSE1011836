import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export type Db = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult<any>> };

// Runs fn inside one transaction: either everything is saved, or nothing is
export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
