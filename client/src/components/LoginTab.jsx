import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './LoginTab.module.css';

export default function LoginTab() {
  const { setUser } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post('/api/auth/login', { name });
      setUser(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h2>Welcome</h2>
      <p>Enter your name to get started.</p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={100}
          required
          className={styles.input}
        />
        <button type="submit" disabled={loading} className={styles.button}>
          {loading ? 'Entering...' : 'Enter'}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
