import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './UsersTab.module.css';

function formatDate(dateStr) {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export default function UsersTab() {
  const { user: currentUser, logout } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get('/api/auth/users');
        setUsers(data.users);
      } catch (err) {
        if (err.status === 401) return logout();
        setError(err.message);
      }
    })();
  }, []);

  return (
    <div className={styles.container}>
      <h2>Members</h2>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.grid}>
        {users.map((u) => (
          <div key={u.id} className={styles.card}>
            {u.avatar ? (
              <img src={u.avatar} alt="" className={styles.avatar} />
            ) : (
              <div className={styles.avatarPlaceholder}>{u.name[0]}</div>
            )}
            <div className={styles.info}>
              <div className={styles.name}>{u.name}</div>
              <div className={styles.stat}>Last login: {formatDate(u.last_login)}</div>
              <div className={styles.stat}>
                {u.reservation_count} reservation{u.reservation_count !== 1 ? 's' : ''}
              </div>
              {currentUser.is_admin && (
                <button
                  className={styles.removeBtn}
                  onClick={async () => {
                    if (!window.confirm(`Remove ${u.name}? This will delete all their data.`)) return;
                    try {
                      await api.delete(`/api/auth/users/${u.id}`);
                      setUsers((prev) => prev.filter((x) => x.id !== u.id));
                    } catch (err) {
                      setError(err.message);
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
