const { pool } = require('../db');

async function requireAuth(req, res, next) {
  const token = req.cookies.session_token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { rows: sessions } = await pool.query(
    "SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()",
    [token]
  );

  if (sessions.length === 0) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { rows: users } = await pool.query(
    'SELECT id, name, avatar, is_admin FROM users WHERE id = $1',
    [sessions[0].user_id]
  );

  if (users.length === 0) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.user = users[0];
  next();
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (res.headersSent) return;
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
