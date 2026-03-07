const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateReservationFields(body, isNew = true) {
  const errors = [];
  const { name, size_of_party, start_date, end_date, notes } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Name is required');
  }
  if (size_of_party === undefined || !Number.isInteger(size_of_party) || size_of_party < 1) {
    errors.push('Size of party must be an integer >= 1');
  }
  if (!start_date || !DATE_REGEX.test(start_date) || isNaN(Date.parse(start_date))) {
    errors.push('Valid start date (YYYY-MM-DD) is required');
  }
  if (!end_date || !DATE_REGEX.test(end_date) || isNaN(Date.parse(end_date))) {
    errors.push('Valid end date (YYYY-MM-DD) is required');
  }
  if (start_date && end_date && end_date < start_date) {
    errors.push('End date must be on or after start date');
  }
  if (isNew && start_date && DATE_REGEX.test(start_date)) {
    const today = new Date().toISOString().slice(0, 10);
    if (start_date < today) {
      errors.push('Start date must be today or later');
    }
  }

  return errors;
}

function logAudit(reservationId, userId, userEmail, action, changesJson) {
  db.prepare(
    'INSERT INTO audit_log (reservation_id, user_id, user_email, action, changes_json) VALUES (?, ?, ?, ?, ?)'
  ).run(reservationId, userId, userEmail, action, JSON.stringify(changesJson));
}

// GET /api/reservations
router.get('/', requireAuth, (req, res) => {
  try {
    const reservations = db.prepare(
      'SELECT r.*, u.email as user_email FROM reservations r JOIN users u ON r.user_id = u.id ORDER BY r.start_date DESC'
    ).all();
    res.json({ reservations });
  } catch (err) {
    logError('get-reservations', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reservations/calendar
router.get('/calendar', requireAuth, (req, res) => {
  try {
    const month = parseInt(req.query.month);
    const year = parseInt(req.query.year);

    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid month and year are required' });
    }

    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const reservations = db.prepare(
      `SELECT id, name, start_date, end_date, status, size_of_party
       FROM reservations
       WHERE start_date <= ? AND end_date >= ?
       AND status NOT IN ('Cancelled', 'Rejected')
       ORDER BY start_date`
    ).all(lastDay, firstDay);

    res.json({ reservations, month, year });
  } catch (err) {
    logError('calendar', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reservations/:id/audit
router.get('/:id/audit', requireAuth, (req, res) => {
  try {
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (reservation.user_id !== req.user.id && req.user.is_admin !== 1) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const audit = db.prepare(
      'SELECT id, action, changes_json, user_email, created_at FROM audit_log WHERE reservation_id = ? ORDER BY created_at ASC'
    ).all(req.params.id);

    res.json({ audit });
  } catch (err) {
    logError('audit', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reservations
router.post('/', requireAuth, (req, res) => {
  try {
    const { name, size_of_party, start_date, end_date, notes } = req.body;
    const errors = validateReservationFields(req.body, true);

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    const result = db.prepare(
      `INSERT INTO reservations (user_id, name, size_of_party, start_date, end_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, name.trim(), size_of_party, start_date, end_date, (notes || '').trim());

    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(result.lastInsertRowid);

    logAudit(reservation.id, req.user.id, req.user.email, 'created', {
      name: name.trim(),
      size_of_party,
      start_date,
      end_date,
      notes: (notes || '').trim(),
      status: 'Pending'
    });

    res.json({ reservation });
  } catch (err) {
    logError('create-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/reservations/:id
router.put('/:id', requireAuth, (req, res) => {
  try {
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own reservations' });
    }
    if (['Cancelled', 'Rejected', 'Completed'].includes(reservation.status)) {
      return res.status(400).json({ error: `Cannot edit a ${reservation.status.toLowerCase()} reservation` });
    }

    const { name, size_of_party, start_date, end_date, notes } = req.body;
    const errors = validateReservationFields(req.body, false);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    // Build changes
    const changes = {};
    if (name.trim() !== reservation.name) changes.name = { old: reservation.name, new: name.trim() };
    if (size_of_party !== reservation.size_of_party) changes.size_of_party = { old: reservation.size_of_party, new: size_of_party };
    if (start_date !== reservation.start_date) changes.start_date = { old: reservation.start_date, new: start_date };
    if (end_date !== reservation.end_date) changes.end_date = { old: reservation.end_date, new: end_date };
    const newNotes = (notes || '').trim();
    if (newNotes !== reservation.notes) changes.notes = { old: reservation.notes, new: newNotes };

    // Status reset if was Accepted
    let newStatus = reservation.status;
    if (reservation.status === 'Accepted' && Object.keys(changes).length > 0) {
      newStatus = 'Pending';
      changes.status = { old: 'Accepted', new: 'Pending' };
    }

    db.prepare(
      `UPDATE reservations SET name = ?, size_of_party = ?, start_date = ?, end_date = ?, notes = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(name.trim(), size_of_party, start_date, end_date, newNotes, newStatus, req.params.id);

    if (Object.keys(changes).length > 0) {
      logAudit(reservation.id, req.user.id, req.user.email, 'updated', changes);
    }

    const updated = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    res.json({ reservation: updated });
  } catch (err) {
    logError('update-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/reservations/:id
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own reservations' });
    }
    if (['Cancelled', 'Rejected', 'Completed'].includes(reservation.status)) {
      return res.status(400).json({ error: `Cannot cancel a ${reservation.status.toLowerCase()} reservation` });
    }

    db.prepare(
      "UPDATE reservations SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);

    logAudit(reservation.id, req.user.id, req.user.email, 'cancelled', {
      status: { old: reservation.status, new: 'Cancelled' }
    });

    const updated = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    res.json({ reservation: updated });
  } catch (err) {
    logError('cancel-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
