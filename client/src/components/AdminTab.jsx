import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './AdminTab.module.css';

const STATUS_COLORS = {
  Pending: '#eab308',
  Accepted: '#22c55e',
  Cancelled: '#9ca3af',
  Rejected: '#ef4444',
  Completed: '#3b82f6',
  PendingCancel: '#f97316',
};

const VALID_STATUSES = ['Pending', 'Accepted', 'Cancelled', 'Rejected', 'Completed', 'PendingCancel'];

export default function AdminTab() {
  const { logout } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchReservations = async () => {
    try {
      const url = filter ? `/api/admin/reservations?status=${filter}` : '/api/admin/reservations';
      const data = await api.get(url);
      setReservations(data.reservations);
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReservations(); }, [filter]);

  const handleAction = async (id, status) => {
    const confirmMsg = status === 'Rejected'
      ? 'Are you sure you want to reject this reservation?'
      : `Are you sure you want to ${status.toLowerCase()} this reservation?`;
    if (!window.confirm(confirmMsg)) return;

    setError('');
    setWarning('');
    try {
      const data = await api.put(`/api/admin/reservations/${id}`, { status });
      if (data.warning) setWarning(data.warning);
      await fetchReservations();
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    }
  };

  const startEdit = (r) => {
    setEditingId(r.id);
    setEditForm({
      name: r.name,
      size_of_party: r.size_of_party,
      start_date: r.start_date,
      end_date: r.end_date,
      notes: r.notes || '',
      status: r.status,
    });
    setError('');
    setWarning('');
  };

  const saveEdit = async () => {
    setError('');
    setWarning('');
    try {
      const body = { ...editForm, size_of_party: parseInt(editForm.size_of_party) };
      const data = await api.put(`/api/admin/reservations/${editingId}`, body);
      if (data.warning) setWarning(data.warning);
      setEditingId(null);
      await fetchReservations();
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Permanently delete this reservation and all its audit history?')) return;
    setError('');
    try {
      await api.delete(`/api/admin/reservations/${id}`);
      setReservations((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      if (err.status === 401) return logout();
      setError(err.message);
    }
  };

  return (
    <div className={styles.container}>
      <h2>Admin - All Reservations</h2>

      <div className={styles.filterBar}>
        <label>Filter by status: </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={styles.select}>
          <option value="">All</option>
          {VALID_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {warning && <p className={styles.warning}>{warning}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : reservations.length === 0 ? (
        <p className={styles.empty}>No reservations found.</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
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
                editingId === r.id ? (
                  <tr key={r.id} className={styles.editRow}>
                    <td data-label="User">{r.user_name}</td>
                    <td data-label="Name">
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className={styles.editInput}
                      />
                    </td>
                    <td data-label="Party">
                      <input
                        type="number"
                        min="1"
                        value={editForm.size_of_party}
                        onChange={(e) => setEditForm({ ...editForm, size_of_party: e.target.value })}
                        className={styles.editInput}
                        style={{ width: 60 }}
                      />
                    </td>
                    <td data-label="Start">
                      <input
                        type="date"
                        value={editForm.start_date}
                        onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                        className={styles.editInput}
                      />
                    </td>
                    <td data-label="End">
                      <input
                        type="date"
                        value={editForm.end_date}
                        onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                        className={styles.editInput}
                      />
                    </td>
                    <td data-label="Status">
                      <select
                        value={editForm.status}
                        onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                        className={styles.editInput}
                      >
                        {VALID_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td data-label="Notes">
                      <input
                        type="text"
                        value={editForm.notes}
                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        className={styles.editInput}
                      />
                    </td>
                    <td className={styles.actions}>
                      <button onClick={saveEdit} className={styles.saveBtn}>Save</button>
                      <button onClick={() => setEditingId(null)} className={styles.cancelBtn}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td data-label="User">{r.user_name}</td>
                    <td data-label="Name">{r.name}</td>
                    <td data-label="Party">{r.size_of_party}</td>
                    <td data-label="Start">{r.start_date}</td>
                    <td data-label="End">{r.end_date}</td>
                    <td data-label="Status">
                      <span className={styles.badge} style={{ background: STATUS_COLORS[r.status] || '#9ca3af' }}>
                        {r.status === 'PendingCancel' ? 'Pending Cancel' : r.status}
                      </span>
                    </td>
                    <td data-label="Notes" className={styles.notesCell}>{r.notes}</td>
                    <td className={styles.actions}>
                      {r.status === 'Pending' && (
                        <>
                          <button onClick={() => handleAction(r.id, 'Accepted')} className={styles.acceptBtn}>Accept</button>
                          <button onClick={() => handleAction(r.id, 'Rejected')} className={styles.rejectBtn}>Reject</button>
                        </>
                      )}
                      {r.status === 'PendingCancel' && (
                        <>
                          <button onClick={() => handleAction(r.id, 'Cancelled')} className={styles.acceptBtn}>Approve Cancel</button>
                          <button onClick={() => handleAction(r.id, 'Accepted')} className={styles.rejectBtn}>Deny Cancel</button>
                        </>
                      )}
                      <button onClick={() => startEdit(r)} className={styles.editBtn}>Edit</button>
                      <button onClick={() => handleDelete(r.id)} className={styles.deleteBtn}>Delete</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
