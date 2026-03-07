import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './ViewReservationsTab.module.css';

const STATUS_COLORS = {
  Pending: '#eab308',
  Accepted: '#22c55e',
  Completed: '#3b82f6',
};

export default function ViewReservationsTab() {
  const { logout } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);

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

  const toggleAudit = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setAuditLoading(true);
    try {
      const data = await api.get(`/api/reservations/${id}/audit`);
      setAuditLog(data.audit);
      setExpandedId(id);
    } catch (err) {
      if (err.status === 401) logout();
    } finally {
      setAuditLoading(false);
    }
  };

  const formatChanges = (changesStr) => {
    try {
      const changes = JSON.parse(changesStr);
      return Object.entries(changes).map(([key, val]) => {
        if (val && typeof val === 'object' && 'old' in val && 'new' in val) {
          return `${key}: "${val.old}" -> "${val.new}"`;
        }
        return `${key}: ${JSON.stringify(val)}`;
      }).join(', ');
    } catch {
      return changesStr;
    }
  };

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
                  {r.status}
                </span>
              </div>
              <div className={styles.cardBody}>
                <p>Reserved by: {r.user_name}</p>
                <p>Party Size: {r.size_of_party}</p>
                <p>Dates: {r.start_date} to {r.end_date}</p>
                {r.notes && <p>Notes: {r.notes}</p>}
              </div>
              <button onClick={() => toggleAudit(r.id)} className={styles.auditBtn}>
                {expandedId === r.id ? 'Hide Audit Trail' : 'View Audit Trail'}
              </button>
              {expandedId === r.id && (
                <div className={styles.auditSection}>
                  {auditLoading ? (
                    <p>Loading audit trail...</p>
                  ) : auditLog.length === 0 ? (
                    <p>No audit entries.</p>
                  ) : (
                    <table className={styles.auditTable}>
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>By</th>
                          <th>Changes</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLog.map((a) => (
                          <tr key={a.id}>
                            <td>{a.action}</td>
                            <td>{a.user_name}</td>
                            <td className={styles.changesCell}>{formatChanges(a.changes_json)}</td>
                            <td>{a.created_at}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
