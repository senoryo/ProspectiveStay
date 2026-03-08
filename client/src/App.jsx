import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import LoginTab from './components/LoginTab';
import AvatarPicker from './components/AvatarPicker';
import ManageReservationTab from './components/ManageReservationTab';
import ViewReservationsTab from './components/ViewReservationsTab';
import CalendarViewTab from './components/CalendarViewTab';
import CancelReservationTab from './components/CancelReservationTab';
import AdminTab from './components/AdminTab';
import MessageBoardTab from './components/MessageBoardTab';
import UsersTab from './components/UsersTab';
import styles from './App.module.css';

const TABS = [
  { key: 'messages', label: 'Message Board' },
  { key: 'manage', label: 'Reserve' },
  { key: 'calendar', label: 'Calendar View' },
  { key: 'view', label: 'Reservation View' },
  { key: 'cancel', label: 'Cancel Reservation' },
  { key: 'users', label: 'Members' },
];

export default function App() {
  const { user, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('messages');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

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
        <div className={styles.heroLogin}>
          <div className={styles.heroOverlay}>
            <h1 className={styles.heroTitle}>ProspectiveStay</h1>
            <p className={styles.heroSubtitle}>Your home away from home in Brooklyn</p>
            <LoginTab />
          </div>
        </div>
      </div>
    );
  }

  // First-time user: no avatar yet
  if (!user.avatar || showAvatarPicker) {
    return (
      <div className={styles.app}>
        <div className={styles.heroLogin}>
          <div className={styles.heroOverlay}>
            <h1 className={styles.heroTitle}>ProspectiveStay</h1>
            <p className={styles.heroSubtitle}>Your home away from home in Brooklyn</p>
            <AvatarPicker onDone={() => setShowAvatarPicker(false)} />
          </div>
        </div>
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
          {user.avatar && (
            <img src={user.avatar} alt="" className={styles.userAvatar} />
          )}
          <span>{user.name}</span>
          {user.is_admin && <span className={styles.adminBadge}>ADMIN</span>}
          <button onClick={() => setShowAvatarPicker(true)} className={styles.settingsBtn} title="Change avatar">
            &#9881;
          </button>
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
        {activeTab === 'messages' && <MessageBoardTab />}
        {activeTab === 'cancel' && <CancelReservationTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'admin' && user.is_admin && <AdminTab />}
      </main>
    </div>
  );
}
