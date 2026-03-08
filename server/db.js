const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function cleanupExpiredSessions() {
  await pool.query("DELETE FROM sessions WHERE expires_at < NOW()");
}

module.exports = { pool, cleanupExpiredSessions };
