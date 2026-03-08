require('dotenv').config();
const { pool } = require('./db');

async function seed() {
  const adminUser = process.env.ADMIN_USER;
  if (!adminUser) {
    console.error('ADMIN_USER environment variable is required');
    process.exit(1);
  }

  await pool.query(`
    INSERT INTO users (name, is_admin)
    VALUES ($1, TRUE)
    ON CONFLICT (name) DO UPDATE SET is_admin = TRUE
  `, [adminUser]);

  console.log(`Seed complete. Admin user: ${adminUser}`);
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
