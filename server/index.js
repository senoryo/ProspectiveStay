const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initDb, cleanupExpiredTokens } = require('./db');

const app = express();
app.use(express.json());
app.use(cookieParser());

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/admin', require('./routes/admin'));

// Serve frontend in production
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

async function start() {
  await initDb();
  await cleanupExpiredTokens();
  setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
