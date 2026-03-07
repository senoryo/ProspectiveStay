const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = ['Pending', 'Accepted', 'Cancelled', 'Rejected', 'Completed'];

function logAudit(reservationId, userId, userEmail, action, changesJson) {
  db.prepare(
    'INSERT INTO audit_log (reservation_id, user_id, user_email, action, changes_json) VALUES (?, ?, ?, ?, ?)'
  ).run(reservationId, userId, userEmail, action, JSON.stringify(changesJson));
}

// GET /api/admin/reservations
router.get('/reservations', requireAdmin, (req, res) => {
  try {
    const { status } = req.query;
    let reservations;

    if (status && VALID_STATUSES.includes(status)) {
      reservations = db.prepare(
        `SELECT r.*, u.email as user_email
         FROM reservations r JOIN users u ON r.user_id = u.id
         WHERE r.status = ?
         ORDER BY r.created_at DESC`
      ).all(status);
    } else {
      reservations = db.prepare(
        `SELECT r.*, u.email as user_email
         FROM reservations r JOIN users u ON r.user_id = u.id
         ORDER BY r.created_at DESC`
      ).all();
    }

    res.json({ reservations });
  } catch (err) {
    logError('admin-get-reservations', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/reservations/:id
router.put('/reservations/:id', requireAdmin, (req, res) => {
  try {
    const reservation = db.prepare(
      `SELECT r.*, u.email as user_email
       FROM reservations r JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`
    ).get(req.params.id);

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

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
    const finalStartDate = start_date !== undefined ? start_date : reservation.start_date;
    const finalEndDate = end_date !== undefined ? end_date : reservation.end_date;
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
    if (finalStartDate !== reservation.start_date) changes.start_date = { old: reservation.start_date, new: finalStartDate };
    if (finalEndDate !== reservation.end_date) changes.end_date = { old: reservation.end_date, new: finalEndDate };
    if (finalNotes !== reservation.notes) changes.notes = { old: reservation.notes, new: finalNotes };
    if (finalStatus !== reservation.status) changes.status = { old: reservation.status, new: finalStatus };

    db.prepare(
      `UPDATE reservations SET name = ?, size_of_party = ?, start_date = ?, end_date = ?, notes = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(finalName, finalSizeOfParty, finalStartDate, finalEndDate, finalNotes, finalStatus, req.params.id);

    if (Object.keys(changes).length > 0) {
      logAudit(reservation.id, req.user.id, req.user.email, 'admin_updated', changes);
    }

    // Notification
    if (status && status !== reservation.status) {
      console.log(`[NOTIFICATION] Reservation #${reservation.id} by ${reservation.user_email} has been ${status} by admin`);
    }

    const updated = db.prepare(
      `SELECT r.*, u.email as user_email
       FROM reservations r JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`
    ).get(req.params.id);

    // Overlap warning when accepting
    let warning;
    if (status === 'Accepted') {
      const overlapping = db.prepare(
        `SELECT COUNT(*) as count FROM reservations
         WHERE id != ? AND status = 'Accepted'
         AND start_date <= ? AND end_date >= ?`
      ).get(req.params.id, updated.end_date, updated.start_date);

      if (overlapping.count > 0) {
        warning = `Overlaps with ${overlapping.count} other accepted reservation${overlapping.count > 1 ? 's' : ''}`;
      }
    }

    const response = { reservation: updated };
    if (warning) response.warning = warning;
    res.json(response);
  } catch (err) {
    logError('admin-update-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
