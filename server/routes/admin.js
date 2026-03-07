const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = ['Pending', 'Accepted', 'Cancelled', 'Rejected', 'Completed'];

async function logAudit(reservationId, userId, userEmail, action, changesJson) {
  await pool.query(
    'INSERT INTO audit_log (reservation_id, user_id, user_email, action, changes_json) VALUES ($1, $2, $3, $4, $5)',
    [reservationId, userId, userEmail, action, JSON.stringify(changesJson)]
  );
}

// GET /api/admin/reservations
router.get('/reservations', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let rows;

    if (status && VALID_STATUSES.includes(status)) {
      ({ rows } = await pool.query(
        `SELECT r.*, u.email as user_email
         FROM reservations r JOIN users u ON r.user_id = u.id
         WHERE r.status = $1
         ORDER BY r.created_at DESC`,
        [status]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT r.*, u.email as user_email
         FROM reservations r JOIN users u ON r.user_id = u.id
         ORDER BY r.created_at DESC`
      ));
    }

    res.json({ reservations: rows });
  } catch (err) {
    logError('admin-get-reservations', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/reservations/:id
router.put('/reservations/:id', requireAdmin, async (req, res) => {
  try {
    const { rows: reservations } = await pool.query(
      `SELECT r.*, u.email as user_email
       FROM reservations r JOIN users u ON r.user_id = u.id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (reservations.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const reservation = reservations[0];

    const { status, name, size_of_party, start_date, end_date, notes } = req.body;

    // Validate fields if provided
    const errors = [];
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      errors.push('Invalid status');
    }
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      errors.push('Name must be a non-empty string');
    }
    if (size_of_party !== undefined && (!Number.isInteger(size_of_party) || size_of_party < 1)) {
      errors.push('Size of party must be an integer >= 1');
    }
    if (start_date !== undefined && (!DATE_REGEX.test(start_date) || isNaN(Date.parse(start_date)))) {
      errors.push('Valid start date (YYYY-MM-DD) is required');
    }
    if (end_date !== undefined && (!DATE_REGEX.test(end_date) || isNaN(Date.parse(end_date)))) {
      errors.push('Valid end date (YYYY-MM-DD) is required');
    }
    const oldStartDate = reservation.start_date instanceof Date ? reservation.start_date.toISOString().slice(0, 10) : reservation.start_date;
    const oldEndDate = reservation.end_date instanceof Date ? reservation.end_date.toISOString().slice(0, 10) : reservation.end_date;
    const finalStartDate = start_date !== undefined ? start_date : oldStartDate;
    const finalEndDate = end_date !== undefined ? end_date : oldEndDate;
    if (finalEndDate < finalStartDate) {
      errors.push('End date must be on or after start date');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    // Build changes
    const changes = {};
    const finalName = name !== undefined ? name.trim() : reservation.name;
    const finalSizeOfParty = size_of_party !== undefined ? size_of_party : reservation.size_of_party;
    const finalNotes = notes !== undefined ? notes.trim() : reservation.notes;
    const finalStatus = status !== undefined ? status : reservation.status;

    if (finalName !== reservation.name) changes.name = { old: reservation.name, new: finalName };
    if (finalSizeOfParty !== reservation.size_of_party) changes.size_of_party = { old: reservation.size_of_party, new: finalSizeOfParty };
    if (finalStartDate !== oldStartDate) changes.start_date = { old: oldStartDate, new: finalStartDate };
    if (finalEndDate !== oldEndDate) changes.end_date = { old: oldEndDate, new: finalEndDate };
    if (finalNotes !== reservation.notes) changes.notes = { old: reservation.notes, new: finalNotes };
    if (finalStatus !== reservation.status) changes.status = { old: reservation.status, new: finalStatus };

    const { rows: updated } = await pool.query(
      `UPDATE reservations SET name = $1, size_of_party = $2, start_date = $3, end_date = $4, notes = $5, status = $6, updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [finalName, finalSizeOfParty, finalStartDate, finalEndDate, finalNotes, finalStatus, req.params.id]
    );

    if (Object.keys(changes).length > 0) {
      await logAudit(reservation.id, req.user.id, req.user.email, 'admin_updated', changes);
    }

    // Notification
    if (status && status !== reservation.status) {
      console.log(`[NOTIFICATION] Reservation #${reservation.id} by ${reservation.user_email} has been ${status} by admin`);
    }

    // Get updated with user email
    const { rows: result } = await pool.query(
      `SELECT r.*, u.email as user_email
       FROM reservations r JOIN users u ON r.user_id = u.id
       WHERE r.id = $1`,
      [req.params.id]
    );

    // Overlap warning when accepting
    let warning;
    if (status === 'Accepted') {
      const { rows: overlapping } = await pool.query(
        `SELECT COUNT(*) as count FROM reservations
         WHERE id != $1 AND status = 'Accepted'
         AND start_date <= $2 AND end_date >= $3`,
        [req.params.id, result[0].end_date, result[0].start_date]
      );

      if (parseInt(overlapping[0].count) > 0) {
        const cnt = parseInt(overlapping[0].count);
        warning = `Overlaps with ${cnt} other accepted reservation${cnt > 1 ? 's' : ''}`;
      }
    }

    const response = { reservation: result[0] };
    if (warning) response.warning = warning;
    res.json(response);
  } catch (err) {
    logError('admin-update-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
