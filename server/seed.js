const { pool, initDb } = require('./db');

async function seed() {
  await initDb();

  await pool.query(`
    INSERT INTO users (email, name, is_admin)
    VALUES ('admin@ppw.com', 'Admin', TRUE)
    ON CONFLICT (email) DO NOTHING
  `);

  console.log('Seed complete. Admin user: admin@ppw.com');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
