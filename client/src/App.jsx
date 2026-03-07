import { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { api } from './api';
import LoginTab from './components/LoginTab';
import ManageReservationTab from './components/ManageReservationTab';
import ViewReservationsTab from './components/ViewReservationsTab';
import CalendarViewTab from './components/CalendarViewTab';
import AdminTab from './components/AdminTab';
import styles from './App.module.css';

const TABS = [
  { key: 'manage', label: 'Manage Reservations' },
  { key: 'view', label: 'View Reservations' },
  { key: 'calendar', label: 'Calendar' },
];

export default function App() {
  const { user, setUser, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('manage');

  // Handle magic link token from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      api.post('/api/auth/verify', { token })
        .then((data) => {
          setUser(data.user);
          window.history.replaceState({}, '', '/');
        })
        .catch(() => {
          window.history.replaceState({}, '', '/');
        });
    }
  }, []);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={styles.app}>
        <header className={styles.header}>
          <h1 className={styles.logo}>ProspectiveStay</h1>
        </header>
        <LoginTab />
      </div>
    );
  }

  const tabs = [...TABS];
  if (user.is_admin) {
    tabs.push({ key: 'admin', label: 'Admin' });
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.logo}>ProspectiveStay</h1>
        <div className={styles.userInfo}>
          <span>{user.name || user.email}</span>
          <span className={styles.email}>({user.email})</span>
          <button onClick={logout} className={styles.logoutBtn}>Logout</button>
        </div>
      </header>
      <nav className={styles.nav}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`${styles.tab} ${activeTab === tab.key ? styles.activeTab : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main className={styles.main}>
        {activeTab === 'manage' && <ManageReservationTab />}
        {activeTab === 'view' && <ViewReservationsTab />}
        {activeTab === 'calendar' && <CalendarViewTab />}
        {activeTab === 'admin' && user.is_admin && <AdminTab />}
      </main>
    </div>
  );
}
