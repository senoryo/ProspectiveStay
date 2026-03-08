const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Name is required (max 100 characters)' });
    }

    const trimmedName = name.trim();

    // Get or create user by name
    let { rows } = await pool.query('SELECT * FROM users WHERE name = $1', [trimmedName]);
    if (rows.length === 0) {
      await pool.query('INSERT INTO users (name) VALUES ($1)', [trimmedName]);
      ({ rows } = await pool.query('SELECT * FROM users WHERE name = $1', [trimmedName]));
    }
    const user = rows[0];

    // Delete existing sessions for this user
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);

    // Create session
    const sessionToken = crypto.randomUUID();
    const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, sessionToken, sessionExpiry]
    );

    res.cookie('session_token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production'
    });

    res.json({
      success: true,
      user: { id: user.id, name: user.name, avatar: user.avatar, is_admin: user.is_admin }
    });
  } catch (err) {
    logError('login', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = req.cookies.session_token;
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.clearCookie('session_token', { path: '/' });
    res.json({ success: true });
  } catch (err) {
    logError('logout', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/avatar', requireAuth, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar || typeof avatar !== 'string') {
      return res.status(400).json({ error: 'Avatar is required' });
    }
    if (!avatar.startsWith('https://')) {
      return res.status(400).json({ error: 'Avatar URL must start with https://' });
    }
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, req.user.id]);
    res.json({ success: true, user: { ...req.user, avatar } });
  } catch (err) {
    logError('update-avatar', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.get('/users', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.avatar, u.is_admin, u.created_at,
             (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_login,
             (SELECT COUNT(*) FROM reservations r WHERE r.user_id = u.id)::int AS reservation_count
      FROM users u
      WHERE u.is_admin = false
      ORDER BY u.name ASC
    `);
    res.json({ users: rows });
  } catch (err) {
    logError('get-users', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/avatars', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT name, photo_url FROM custom_avatars ORDER BY name ASC');
    res.json({ avatars: rows });
  } catch (err) {
    logError('get-custom-avatars', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/avatars', requireAuth, async (req, res) => {
  try {
    const { name, photo_url } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!photo_url || typeof photo_url !== 'string' || !photo_url.startsWith('https://')) {
      return res.status(400).json({ error: 'Valid photo URL is required' });
    }
    await pool.query(
      'INSERT INTO custom_avatars (name, photo_url) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
      [name.trim(), photo_url]
    );
    res.json({ success: true });
  } catch (err) {
    logError('add-custom-avatar', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
