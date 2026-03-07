import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './LoginTab.module.css';

export default function LoginTab() {
  const { user, setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [name, setName] = useState('');

  const handleRequestLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/request-login', { email });
      setCodeSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post('/api/auth/verify', { email, code });
      if (data.user.name === '') {
        setShowNamePrompt(true);
        setUser(data.user);
      } else {
        setUser(data.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.put('/api/auth/profile', { name });
      setUser(data.user);
      setShowNamePrompt(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (showNamePrompt) {
    return (
      <div className={styles.container}>
        <h2>Welcome! What's your name?</h2>
        <form onSubmit={handleSaveName}>
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
            {loading ? 'Saving...' : 'Save'}
          </button>
        </form>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  if (!codeSent) {
    return (
      <div className={styles.container}>
        <h2>Login</h2>
        <p>Enter your email to receive a login code.</p>
        <form onSubmit={handleRequestLogin}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className={styles.input}
          />
          <button type="submit" disabled={loading} className={styles.button}>
            {loading ? 'Sending...' : 'Send Login Link'}
          </button>
        </form>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h2>Enter Verification Code</h2>
      <p>Check the server console for your 6-digit code.</p>
      <form onSubmit={handleVerify}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          maxLength={6}
          required
          className={styles.input}
        />
        <button type="submit" disabled={loading} className={styles.button}>
          {loading ? 'Verifying...' : 'Verify'}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      <button
        onClick={() => { setCodeSent(false); setError(''); setCode(''); }}
        className={styles.linkButton}
      >
        Back to email entry
      </button>
    </div>
  );
}
