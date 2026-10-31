import pg from 'pg';
// NUMERIC must stay a string (never a JS float) when it travels to the client.
pg.types.setTypeParser(1700, v => v);
pg.types.setTypeParser(20, v => (Number.isSafeInteger(Number(v)) ? Number(v) : v));
pg.types.setTypeParser(1082, v => v); // DATE as 'YYYY-MM-DD'
pg.types.setTypeParser(1114, v => v); // TIMESTAMP (Saudi wall-clock time, no zone) stays a plain string 'YYYY-MM-DD HH:MM:SS'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://erpx_app:erpx_app_dev@localhost:5434/erpx',
  max: Number(process.env.PG_POOL_MAX || 10),
  statement_timeout: 30000
});

export const q = (text, params) => pool.query(text, params);

/** Run fn inside ONE transaction; every audit row / entry gets the acting user. */
export async function tx(user, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('erpx.user', $1, true)", [user]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
  finally { c.release(); }
}
