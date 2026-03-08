import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './ViewReservationsTab.module.css';

const STATUS_COLORS = {
  Pending: '#eab308',
  Accepted: '#22c55e',
  Completed: '#3b82f6',
  PendingCancel: '#f97316',
};

export default function ViewReservationsTab() {
  const { logout } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/reservations')
      .then((data) => {
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = data.reservations.filter(
          (r) => r.end_date >= today && !['Cancelled', 'Rejected'].includes(r.status)
        );
        setReservations(upcoming);
      })
      .catch((err) => {
        if (err.status === 401) logout();
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.container}><p>Loading...</p></div>;

  return (
    <div className={styles.container}>
      <h2>Upcoming Reservations</h2>
      {reservations.length === 0 ? (
        <p className={styles.empty}>No upcoming reservations.</p>
      ) : (
        <div className={styles.cards}>
          {reservations.map((r) => (
            <div key={r.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <h3>{r.name}</h3>
                <span
                  className={styles.badge}
                  style={{ background: STATUS_COLORS[r.status] || '#9ca3af' }}
                >
                  {r.status === 'PendingCancel' ? 'Pending Cancel' : r.status}
                </span>
              </div>
              <div className={styles.cardBody}>
                <p>Party Size: {r.size_of_party}</p>
                <p>Dates: {r.start_date} to {r.end_date}</p>
                {r.notes && <p>Notes: {r.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
