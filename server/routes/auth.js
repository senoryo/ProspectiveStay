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
      user: { id: user.id, name: user.name, is_admin: user.is_admin }
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

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
