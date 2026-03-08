const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function formatReservation(r) {
  return {
    ...r,
    start_date: r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : r.start_date,
    end_date: r.end_date instanceof Date ? r.end_date.toISOString().slice(0, 10) : r.end_date,
  };
}

function validateReservationFields(body, isNew = true) {
  const errors = [];
  const { size_of_party, start_date, end_date, notes } = body;

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

async function logAudit(reservationId, userId, userName, action, changesJson) {
  await pool.query(
    'INSERT INTO audit_log (reservation_id, user_id, user_name, action, changes_json) VALUES ($1, $2, $3, $4, $5)',
    [reservationId, userId, userName, action, JSON.stringify(changesJson)]
  );
}

// GET /api/reservations
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT r.*, u.name as user_name, u.avatar as user_avatar FROM reservations r JOIN users u ON r.user_id = u.id ORDER BY r.start_date DESC'
    );
    res.json({ reservations: rows.map(formatReservation) });
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

    res.json({ reservations: rows.map(formatReservation), month, year });
  } catch (err) {
    logError('calendar', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reservations/:id/audit
router.get('/:id/audit', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid reservation ID' });

    const { rows: reservations } = await pool.query('SELECT * FROM reservations WHERE id = $1', [id]);
    if (reservations.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (reservations[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { rows: audit } = await pool.query(
      'SELECT id, action, changes_json, user_name, created_at FROM audit_log WHERE reservation_id = $1 ORDER BY created_at ASC',
      [id]
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
    const { size_of_party, start_date, end_date, notes } = req.body;
    const errors = validateReservationFields(req.body, true);

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    const { rows } = await pool.query(
      `INSERT INTO reservations (user_id, name, size_of_party, start_date, end_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, req.user.name, size_of_party, start_date, end_date, (notes || '').trim()]
    );

    const reservation = rows[0];

    await logAudit(reservation.id, req.user.id, req.user.name, 'created', {
      name: req.user.name,
      size_of_party,
      start_date,
      end_date,
      notes: (notes || '').trim(),
      status: 'Pending'
    });

    res.json({ reservation: formatReservation(reservation) });
  } catch (err) {
    logError('create-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/reservations/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid reservation ID' });

    const { rows: reservations } = await pool.query('SELECT * FROM reservations WHERE id = $1', [id]);
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

    const { size_of_party, start_date, end_date, notes } = req.body;
    const errors = validateReservationFields(req.body, false);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('. ') });
    }

    // Build changes
    const changes = {};
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
      `UPDATE reservations SET size_of_party = $1, start_date = $2, end_date = $3, notes = $4, status = $5, updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [size_of_party, start_date, end_date, newNotes, newStatus, id]
    );

    if (Object.keys(changes).length > 0) {
      await logAudit(reservation.id, req.user.id, req.user.name, 'updated', changes);
    }

    res.json({ reservation: formatReservation(updated[0]) });
  } catch (err) {
    logError('update-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/reservations/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid reservation ID' });

    const { rows: reservations } = await pool.query('SELECT * FROM reservations WHERE id = $1', [id]);
    if (reservations.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const reservation = reservations[0];
    if (reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own reservations' });
    }
    if (['Cancelled', 'Rejected', 'Completed', 'PendingCancel'].includes(reservation.status)) {
      return res.status(400).json({ error: `Cannot cancel a ${reservation.status} reservation` });
    }

    // If reservation was created in current session, cancel directly
    const { rows: sessions } = await pool.query(
      'SELECT created_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    );
    const sessionStart = sessions.length > 0 ? sessions[0].created_at : null;
    const directCancel = sessionStart && new Date(reservation.created_at) >= new Date(sessionStart);

    const newStatus = directCancel ? 'Cancelled' : 'PendingCancel';
    const { rows: updated } = await pool.query(
      'UPDATE reservations SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newStatus, id]
    );

    await logAudit(reservation.id, req.user.id, req.user.name, directCancel ? 'cancelled' : 'requested_cancel', {
      status: { old: reservation.status, new: newStatus }
    });

    res.json({ reservation: formatReservation(updated[0]) });
  } catch (err) {
    logError('cancel-reservation', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
