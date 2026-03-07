const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();

router.use(requireAuth);

// Get all messages with user info, ordered by created_at
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.parent_id, m.content, m.created_at,
             u.id AS user_id, u.name AS user_name, u.avatar AS user_avatar
      FROM messages m
      JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at ASC
    `);
    res.json({ messages: rows });
  } catch (err) {
    logError('get-messages', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Post a new message (top-level or reply)
router.post('/', async (req, res) => {
  try {
    const { content, parent_id } = req.body;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }
    if (content.trim().length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    // Validate parent exists if replying
    if (parent_id != null) {
      const { rows: parent } = await pool.query('SELECT id FROM messages WHERE id = $1', [parent_id]);
      if (parent.length === 0) {
        return res.status(400).json({ error: 'Parent message not found' });
      }
    }

    const { rows } = await pool.query(
      'INSERT INTO messages (user_id, parent_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, parent_id || null, content.trim()]
    );

    const msg = rows[0];
    res.json({
      message: {
        id: msg.id,
        parent_id: msg.parent_id,
        content: msg.content,
        created_at: msg.created_at,
        user_id: req.user.id,
        user_name: req.user.name,
        user_avatar: req.user.avatar,
      }
    });
  } catch (err) {
    logError('post-message', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete own message (or admin can delete any)
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (rows[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Delete replies first, then the message
    await pool.query('DELETE FROM messages WHERE parent_id = $1', [req.params.id]);
    await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    logError('delete-message', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
