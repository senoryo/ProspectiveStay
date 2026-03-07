const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/request-login', (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Get or create user
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) {
      db.prepare('INSERT INTO users (email) VALUES (?)').run(normalizedEmail);
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    }

    // Rate limit: max 3 requests per email per 5 minutes
    const recentTokens = db.prepare(
      "SELECT COUNT(*) as count FROM login_tokens WHERE user_id = ? AND created_at > datetime('now', '-5 minutes')"
    ).get(user.id);

    if (recentTokens.count >= 3) {
      return res.status(429).json({ error: 'Too many login requests. Please try again in a few minutes.' });
    }

    // Invalidate all previous unused tokens for this user
    db.prepare('UPDATE login_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);

    // Generate token and code
    const token = crypto.randomUUID();
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(
      'INSERT INTO login_tokens (user_id, token, code, expires_at) VALUES (?, ?, ?, ?)'
    ).run(user.id, token, code, expiresAt);

    console.log(`[MAGIC LINK] http://localhost:5173/?token=${token}`);
    console.log(`[LOGIN CODE] ${code} for ${normalizedEmail}`);

    res.json({ success: true, message: 'Login link sent to your email' });
  } catch (err) {
    logError('request-login', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify', (req, res) => {
  try {
    const { token, email, code } = req.body;

    let loginToken;

    if (token) {
      // Magic link verification
      loginToken = db.prepare(
        "SELECT lt.*, u.email as user_email FROM login_tokens lt JOIN users u ON lt.user_id = u.id WHERE lt.token = ? AND lt.expires_at > datetime('now') AND lt.used = 0"
      ).get(token);
    } else if (email && code) {
      // Code verification
      const normalizedEmail = email.trim().toLowerCase();
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
      if (!user) {
        return res.status(400).json({ error: 'Invalid code' });
      }
      loginToken = db.prepare(
        "SELECT lt.*, u.email as user_email FROM login_tokens lt JOIN users u ON lt.user_id = u.id WHERE lt.user_id = ? AND lt.code = ? AND lt.expires_at > datetime('now') AND lt.used = 0"
      ).get(user.id, code);
    } else {
      return res.status(400).json({ error: 'Token or email+code required' });
    }

    if (!loginToken) {
      // Increment failed_attempts on the relevant active token
      if (token) {
        const existing = db.prepare('SELECT * FROM login_tokens WHERE token = ?').get(token);
        if (existing && existing.failed_attempts < 5) {
          db.prepare('UPDATE login_tokens SET failed_attempts = failed_attempts + 1 WHERE id = ?').run(existing.id);
          if (existing.failed_attempts + 1 >= 5) {
            db.prepare('UPDATE login_tokens SET used = 1 WHERE id = ?').run(existing.id);
          }
        }
      } else if (email && code) {
        const normalizedEmail = email.trim().toLowerCase();
        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
        if (user) {
          const activeToken = db.prepare(
            "SELECT * FROM login_tokens WHERE user_id = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
          ).get(user.id);
          if (activeToken) {
            db.prepare('UPDATE login_tokens SET failed_attempts = failed_attempts + 1 WHERE id = ?').run(activeToken.id);
            if (activeToken.failed_attempts + 1 >= 5) {
              db.prepare('UPDATE login_tokens SET used = 1 WHERE id = ?').run(activeToken.id);
              return res.status(429).json({ error: 'Too many failed attempts. Please request a new login link.' });
            }
          }
        }
      }
      return res.status(400).json({ error: 'Invalid or expired login token' });
    }

    // Check brute-force protection
    if (loginToken.failed_attempts >= 5) {
      db.prepare('UPDATE login_tokens SET used = 1 WHERE id = ?').run(loginToken.id);
      return res.status(429).json({ error: 'Too many failed attempts. Please request a new login link.' });
    }

    // For code verification, we already matched by code, so it's valid
    // For token verification, we matched by token, so it's valid
    // Mark token as used
    db.prepare('UPDATE login_tokens SET used = 1 WHERE id = ?').run(loginToken.id);

    // Create session
    const sessionToken = crypto.randomUUID();
    const sessionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(loginToken.user_id, sessionToken, sessionExpiry);

    // Set cookie
    res.cookie('session_token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production'
    });

    const user = db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?').get(loginToken.user_id);

    res.json({
      success: true,
      user: { ...user, is_admin: !!user.is_admin }
    });
  } catch (err) {
    logError('verify', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  try {
    const token = req.cookies.session_token;
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie('session_token', { path: '/' });
    res.json({ success: true });
  } catch (err) {
    logError('logout', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: { ...req.user, is_admin: !!req.user.is_admin }
  });
});

router.put('/profile', requireAuth, (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Name must be a non-empty string (max 100 characters)' });
    }

    db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), req.user.id);

    const user = db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: { ...user, is_admin: !!user.is_admin } });
  } catch (err) {
    logError('profile', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
