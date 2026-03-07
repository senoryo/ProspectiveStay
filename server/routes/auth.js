const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/request-login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Get or create user
    let { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (rows.length === 0) {
      await pool.query('INSERT INTO users (email) VALUES ($1)', [normalizedEmail]);
      ({ rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]));
    }
    const user = rows[0];

    // Rate limit: max 3 requests per email per 5 minutes
    const { rows: recentTokens } = await pool.query(
      "SELECT COUNT(*) as count FROM login_tokens WHERE user_id = $1 AND created_at > NOW() - INTERVAL '5 minutes'",
      [user.id]
    );

    if (parseInt(recentTokens[0].count) >= 3) {
      return res.status(429).json({ error: 'Too many login requests. Please try again in a few minutes.' });
    }

    // Invalidate all previous unused tokens for this user
    await pool.query('UPDATE login_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]);

    // Generate token and code
    const token = crypto.randomUUID();
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await pool.query(
      'INSERT INTO login_tokens (user_id, token, code, expires_at) VALUES ($1, $2, $3, $4)',
      [user.id, token, code, expiresAt]
    );

    console.log(`[MAGIC LINK] http://localhost:5173/?token=${token}`);
    console.log(`[LOGIN CODE] ${code} for ${normalizedEmail}`);

    res.json({ success: true, message: 'Login link sent to your email' });
  } catch (err) {
    logError('request-login', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { token, email, code } = req.body;

    let loginToken;

    if (token) {
      const { rows } = await pool.query(
        "SELECT lt.*, u.email as user_email FROM login_tokens lt JOIN users u ON lt.user_id = u.id WHERE lt.token = $1 AND lt.expires_at > NOW() AND lt.used = FALSE",
        [token]
      );
      loginToken = rows[0];
    } else if (email && code) {
      const normalizedEmail = email.trim().toLowerCase();
      const { rows: userRows } = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (userRows.length === 0) {
        return res.status(400).json({ error: 'Invalid code' });
      }
      const { rows } = await pool.query(
        "SELECT lt.*, u.email as user_email FROM login_tokens lt JOIN users u ON lt.user_id = u.id WHERE lt.user_id = $1 AND lt.code = $2 AND lt.expires_at > NOW() AND lt.used = FALSE",
        [userRows[0].id, code]
      );
      loginToken = rows[0];
    } else {
      return res.status(400).json({ error: 'Token or email+code required' });
    }

    if (!loginToken) {
      // Increment failed_attempts on the relevant active token
      if (token) {
        const { rows } = await pool.query('SELECT * FROM login_tokens WHERE token = $1', [token]);
        if (rows.length > 0 && rows[0].failed_attempts < 5) {
          await pool.query('UPDATE login_tokens SET failed_attempts = failed_attempts + 1 WHERE id = $1', [rows[0].id]);
          if (rows[0].failed_attempts + 1 >= 5) {
            await pool.query('UPDATE login_tokens SET used = TRUE WHERE id = $1', [rows[0].id]);
          }
        }
      } else if (email && code) {
        const normalizedEmail = email.trim().toLowerCase();
        const { rows: userRows } = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
        if (userRows.length > 0) {
          const { rows } = await pool.query(
            "SELECT * FROM login_tokens WHERE user_id = $1 AND used = FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
            [userRows[0].id]
          );
          if (rows.length > 0) {
            await pool.query('UPDATE login_tokens SET failed_attempts = failed_attempts + 1 WHERE id = $1', [rows[0].id]);
            if (rows[0].failed_attempts + 1 >= 5) {
              await pool.query('UPDATE login_tokens SET used = TRUE WHERE id = $1', [rows[0].id]);
              return res.status(429).json({ error: 'Too many failed attempts. Please request a new login link.' });
            }
          }
        }
      }
      return res.status(400).json({ error: 'Invalid or expired login token' });
    }

    // Check brute-force protection
    if (loginToken.failed_attempts >= 5) {
      await pool.query('UPDATE login_tokens SET used = TRUE WHERE id = $1', [loginToken.id]);
      return res.status(429).json({ error: 'Too many failed attempts. Please request a new login link.' });
    }

    // Mark token as used
    await pool.query('UPDATE login_tokens SET used = TRUE WHERE id = $1', [loginToken.id]);

    // Create session
    const sessionToken = crypto.randomUUID();
    const sessionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [loginToken.user_id, sessionToken, sessionExpiry]
    );

    // Set cookie
    res.cookie('session_token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production'
    });

    const { rows: userRows } = await pool.query(
      'SELECT id, email, name, is_admin FROM users WHERE id = $1',
      [loginToken.user_id]
    );

    res.json({
      success: true,
      user: userRows[0]
    });
  } catch (err) {
    logError('verify', err);
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

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Name must be a non-empty string (max 100 characters)' });
    }

    await pool.query("UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2", [name.trim(), req.user.id]);

    const { rows } = await pool.query('SELECT id, email, name, is_admin FROM users WHERE id = $1', [req.user.id]);
    res.json({ user: rows[0] });
  } catch (err) {
    logError('profile', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
