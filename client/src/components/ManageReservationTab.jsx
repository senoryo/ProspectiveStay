import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import DateRangePicker from './DateRangePicker';
import styles from './ManageReservationTab.module.css';

const emptyForm = { size_of_party: 1, start_date: '', end_date: '', notes: '' };

export default function ManageReservationTab() {
  const { logout } = useAuth();
  const [form, setForm] = useState({ ...emptyForm });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.start_date || !form.end_date) {
      setError('Please select both check-in and check-out dates');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const body = {
        ...form,
        size_of_party: parseInt(form.size_of_party) || 1,
      };
      await api.post('/api/reservations', body);
      setForm({ ...emptyForm });
      setSuccess('Reservation created successfully!');
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.formSection}>
        <h2>Create Reservation</h2>
        <form onSubmit={handleSubmit}>
          <label className={styles.label}>
            Size of Party
            <input
              type="number"
              min="1"
              value={form.size_of_party}
              onChange={(e) => setForm({ ...form, size_of_party: e.target.value })}
              required
              className={styles.input}
              style={{ maxWidth: 80 }}
            />
          </label>
          <DateRangePicker
            startDate={form.start_date}
            endDate={form.end_date}
            onChange={(start, end) => setForm((prev) => ({ ...prev, start_date: start, end_date: end }))}
          />
          <label className={styles.label}>
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={styles.textarea}
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          {success && <p className={styles.success}>{success}</p>}
          <div className={styles.formButtons}>
            <button type="submit" disabled={loading} className={styles.button}>
              {loading ? 'Saving...' : 'Create Reservation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
