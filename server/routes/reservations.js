const express = require('express');
const { pool } = require('../db');
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

async function logAudit(reservationId, userId, userEmail, action, changesJson) {
  await pool.query(
    'INSERT INTO audit_log (reservation_id, user_id, user_email, action, changes_json) VALUES ($1, $2, $3, $4, $5)',
    [reservationId, userId, userEmail, action, JSON.stringify(changesJson)]
  );
}

// GET /api/reservations
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT r.*, u.email as user_email FROM reservations r JOIN users u ON r.user_id = u.id ORDER BY r.start_date DESC'
    );
    res.json({ reservations: rows });
  } catch (err) {
    logError('get-reservations', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reservations/calendar
router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const month = parseInt(req.query.month);
    const year = parseInt(req.query.year);

    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Valid month and year are required' });
    }

    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const { rows } = await pool.query(
      `SELECT id, name, start_date, end_date, status, size_of_party
       FROM reservations
       WHERE start_date <= $1 AND end_date >= $2
       AND status NOT IN ('Cancelled', 'Rejected')
       ORDER BY start_date`,
      [lastDay, firstDay]
    );

    res.json({ reservations: rows, month, year });
  } catch (err) {
    logError('calendar', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reservations/:id/audit
router.get('/:id/audit', requireAuth, async (req, res) => {
  try {
    const { rows: reservations } = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    if (reservations.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (reservations[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { rows: audit } = await pool.query(
      'SELECT id, action, changes_json, user_email, created_at FROM audit_log WHERE reservation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    res.json({ audit });
  } catch (err) {
    logError('audit', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reservations
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, size_of_party, start_date, end_date, notes } = req.body;
    const errors = validateReservationFields(req.body, true);

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    const { rows } = await pool.query(
      `INSERT INTO reservations (user_id, name, size_of_party, start_date, end_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, name.trim(), size_of_party, start_date, end_date, (notes || '').trim()]
    );

    const reservation = rows[0];

    await logAudit(reservation.id, req.user.id, req.user.email, 'created', {
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
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: reservations } = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    if (reservations.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const reservation = reservations[0];
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
    const oldStartDate = reservation.start_date instanceof Date ? reservation.start_date.toISOString().slice(0, 10) : reservation.start_date;
    const oldEndDate = reservation.end_date instanceof Date ? reservation.end_date.toISOString().slice(0, 10) : reservation.end_date;
    if (start_date !== oldStartDate) changes.start_date = { old: oldStartDate, new: start_date };
    if (end_date !== oldEndDate) changes.end_date = { old: oldEndDate, new: end_date };
    const newNotes = (notes || '').trim();
    if (newNotes !== reservation.notes) changes.notes = { old: reservation.notes, new: newNotes };

    // Status reset if was Accepted
    let newStatus = reservation.status;
    if (reservation.status === 'Accepted' && Object.keys(changes).length > 0) {
      newStatus = 'Pending';
      changes.status = { old: 'Accepted', new: 'Pending' };
    }

    const { rows: updated } = await pool.query(
      `UPDATE reservations SET name = $1, size_of_party = $2, start_date = $3, end_date = $4, notes = $5, status = $6, updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name.trim(), size_of_party, start_date, end_date, newNotes, newStatus, req.params.id]
    );

    if (Object.keys(changes).length > 0) {
      await logAudit(reservation.id, req.user.id, req.user.email, 'updated', changes);
    }

    res.json({ reservation: updated[0] });
  } catch (err) {
    logError('update-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/reservations/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: reservations } = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    if (reservations.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const reservation = reservations[0];
    if (reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own reservations' });
    }
    if (['Cancelled', 'Rejected', 'Completed'].includes(reservation.status)) {
      return res.status(400).json({ error: `Cannot cancel a ${reservation.status.toLowerCase()} reservation` });
    }

    const { rows: updated } = await pool.query(
      "UPDATE reservations SET status = 'Cancelled', updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );

    await logAudit(reservation.id, req.user.id, req.user.email, 'cancelled', {
      status: { old: reservation.status, new: 'Cancelled' }
    });

    res.json({ reservation: updated[0] });
  } catch (err) {
    logError('cancel-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
