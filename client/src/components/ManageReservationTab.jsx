import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './ManageReservationTab.module.css';

const STATUS_COLORS = {
  Pending: '#eab308',
  Accepted: '#22c55e',
  Cancelled: '#9ca3af',
  Rejected: '#ef4444',
  Completed: '#3b82f6',
};

const emptyForm = { name: '', size_of_party: 1, start_date: '', end_date: '', notes: '' };

export default function ManageReservationTab() {
  const { logout } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchReservations = async () => {
    try {
      const data = await api.get('/api/reservations');
      setReservations(data.reservations);
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    }
  };

  useEffect(() => { fetchReservations(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = {
        ...form,
        size_of_party: parseInt(form.size_of_party),
      };
      if (editingId) {
        await api.put(`/api/reservations/${editingId}`, body);
      } else {
        await api.post('/api/reservations', body);
      }
      setForm({ ...emptyForm });
      setEditingId(null);
      await fetchReservations();
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (r) => {
    setForm({
      name: r.name,
      size_of_party: r.size_of_party,
      start_date: r.start_date,
      end_date: r.end_date,
      notes: r.notes || '',
    });
    setEditingId(r.id);
    setError('');
  };

  const handleCancel = async (id) => {
    if (!window.confirm('Are you sure you want to cancel this reservation?')) return;
    try {
      await api.delete(`/api/reservations/${id}`);
      await fetchReservations();
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    }
  };

  const disabledStatuses = ['Cancelled', 'Rejected', 'Completed'];

  return (
    <div className={styles.container}>
      <div className={styles.formSection}>
        <h2>{editingId ? 'Edit Reservation' : 'Create Reservation'}</h2>
        <form onSubmit={handleSubmit}>
          <label className={styles.label}>
            Name
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className={styles.input}
            />
          </label>
          <label className={styles.label}>
            Size of Party
            <input
              type="number"
              min="1"
              value={form.size_of_party}
              onChange={(e) => setForm({ ...form, size_of_party: e.target.value })}
              required
              className={styles.input}
            />
          </label>
          <div className={styles.dateRow}>
            <label className={styles.label}>
              Start Date
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                required
                className={styles.input}
              />
            </label>
            <label className={styles.label}>
              End Date
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                required
                className={styles.input}
              />
            </label>
          </div>
          <label className={styles.label}>
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={styles.textarea}
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.formButtons}>
            <button type="submit" disabled={loading} className={styles.button}>
              {loading ? 'Saving...' : editingId ? 'Save Changes' : 'Create Reservation'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => { setEditingId(null); setForm({ ...emptyForm }); setError(''); }}
                className={styles.cancelButton}
              >
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      </div>

      <div className={styles.listSection}>
        <h2>My Reservations</h2>
        {reservations.length === 0 ? (
          <p className={styles.empty}>No reservations yet.</p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Party</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.size_of_party}</td>
                    <td>{r.start_date}</td>
                    <td>{r.end_date}</td>
                    <td>
                      <span
                        className={styles.badge}
                        style={{ background: STATUS_COLORS[r.status] || '#9ca3af' }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className={styles.notesCell}>{r.notes}</td>
                    <td className={styles.actions}>
                      <button
                        onClick={() => handleEdit(r)}
                        disabled={disabledStatuses.includes(r.status)}
                        className={styles.actionBtn}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleCancel(r.id)}
                        disabled={disabledStatuses.includes(r.status)}
                        className={styles.actionBtnDanger}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
