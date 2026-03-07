const { db, initDb } = require('./db');

initDb();

db.prepare(`
  INSERT OR IGNORE INTO users (email, name, is_admin)
  VALUES ('admin@ppw.com', 'Admin', 1)
`).run();

console.log('Seed complete. Admin user: admin@ppw.com');
