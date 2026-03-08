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
  PendingCancel: '#f97316',
};

export default function CancelReservationTab() {
  const { user, logout } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [error, setError] = useState('');

  const fetchReservations = async () => {
    try {
      const data = await api.get('/api/reservations');
      setReservations(data.reservations.filter((r) => r.user_id === user.id));
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    }
  };

  useEffect(() => { fetchReservations(); }, []);

  const handleCancel = async (id) => {
    if (!window.confirm('Are you sure you want to request cancellation?')) return;
    setError('');
    try {
      await api.delete(`/api/reservations/${id}`);
      await fetchReservations();
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    }
  };

  const canCancel = (status) => !['Cancelled', 'Rejected', 'Completed', 'PendingCancel'].includes(status);

  return (
    <div className={styles.container}>
      <div className={styles.listSection}>
        <h2>Cancel Reservation</h2>
        {error && <p className={styles.error}>{error}</p>}
        {reservations.length === 0 ? (
          <p className={styles.empty}>No reservations.</p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
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
                    <td data-label="Party">{r.size_of_party}</td>
                    <td data-label="Start">{r.start_date}</td>
                    <td data-label="End">{r.end_date}</td>
                    <td data-label="Status">
                      <span
                        className={styles.badge}
                        style={{ background: STATUS_COLORS[r.status] || '#9ca3af' }}
                      >
                        {r.status === 'PendingCancel' ? 'Pending Cancel' : r.status}
                      </span>
                    </td>
                    <td data-label="Notes" className={styles.notesCell}>{r.notes}</td>
                    <td className={styles.actions}>
                      {canCancel(r.status) ? (
                        <button
                          onClick={() => handleCancel(r.id)}
                          className={styles.actionBtnDanger}
                        >
                          Cancel
                        </button>
                      ) : (
                        <span style={{ color: '#5a6a8a', fontSize: 12 }}>—</span>
                      )}
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
