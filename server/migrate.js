require('dotenv').config();
const path = require('path');

async function migrate() {
  const { runner } = await import('node-pg-migrate');
  await runner({
    databaseUrl: process.env.DATABASE_URL,
    dir: path.join(__dirname, 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: console.log,
    ...(process.env.NODE_ENV === 'production' ? { decamelize: true, ssl: { rejectUnauthorized: false } } : {}),
  });
}

migrate()
  .then(() => { console.log('Migrations complete'); process.exit(0); })
  .catch((err) => { console.error('Migration failed:', err); process.exit(1); });
