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
      SELECT m.id, m.parent_id, m.content, m.gif_url, m.created_at,
             u.id AS user_id, u.name AS user_name, u.avatar AS user_avatar
      FROM messages m
      JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at ASC
    `);

    // Fetch all reactions
    const { rows: reactions } = await pool.query(`
      SELECT r.message_id, r.emoji, r.user_id, u.name AS user_name
      FROM message_reactions r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at ASC
    `);

    // Group reactions by message_id
    const reactionsByMsg = {};
    for (const r of reactions) {
      if (!reactionsByMsg[r.message_id]) reactionsByMsg[r.message_id] = [];
      reactionsByMsg[r.message_id].push(r);
    }

    const messages = rows.map((m) => ({
      ...m,
      reactions: reactionsByMsg[m.id] || [],
    }));

    res.json({ messages });
  } catch (err) {
    logError('get-messages', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Post a new message (top-level or reply)
router.post('/', async (req, res) => {
  try {
    const { content, parent_id, gif_url } = req.body;
    const hasGif = gif_url && typeof gif_url === 'string' && gif_url.trim().length > 0;
    const hasContent = content && typeof content === 'string' && content.trim().length > 0;
    if (!hasContent && !hasGif) {
      return res.status(400).json({ error: 'Message content or GIF is required' });
    }
    if (hasContent && content.trim().length > 2000) {
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
      'INSERT INTO messages (user_id, parent_id, content, gif_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, parent_id || null, hasContent ? content.trim() : '', hasGif ? gif_url.trim() : '']
    );

    const msg = rows[0];
    res.json({
      message: {
        id: msg.id,
        parent_id: msg.parent_id,
        content: msg.content,
        gif_url: msg.gif_url,
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

// Toggle emoji reaction on a message
router.post('/:id/reactions', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid message ID' });

    const { emoji } = req.body;
    if (!emoji || typeof emoji !== 'string') {
      return res.status(400).json({ error: 'Emoji is required' });
    }
    if (emoji.length > 32) {
      return res.status(400).json({ error: 'Emoji too long' });
    }

    const { rows: msgs } = await pool.query('SELECT id FROM messages WHERE id = $1', [id]);
    if (msgs.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if reaction already exists - toggle it
    const { rows: existing } = await pool.query(
      'SELECT id FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [id, req.user.id, emoji]
    );

    if (existing.length > 0) {
      await pool.query('DELETE FROM message_reactions WHERE id = $1', [existing[0].id]);
      res.json({ action: 'removed' });
    } else {
      await pool.query(
        'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)',
        [id, req.user.id, emoji]
      );
      res.json({ action: 'added' });
    }
  } catch (err) {
    logError('toggle-reaction', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete own message (or admin can delete any)
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid message ID' });

    const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (rows[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM messages WHERE parent_id = $1', [id]);
      await client.query('DELETE FROM messages WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json({ success: true });
  } catch (err) {
    logError('delete-message', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
