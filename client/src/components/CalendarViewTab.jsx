import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import styles from './CalendarViewTab.module.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarViewTab() {
  const { logout } = useAuth();
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(now.getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/reservations/calendar?month=${currentMonth}&year=${currentYear}`)
      .then((data) => setReservations(data.reservations))
      .catch((err) => { if (err.status === 401) logout(); })
      .finally(() => setLoading(false));
  }, [currentMonth, currentYear]);

  const goBack = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goForward = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const firstDayOfWeek = new Date(currentYear, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

  const getReservationsForDay = (day) => {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return reservations.filter((r) => r.start_date <= dateStr && r.end_date >= dateStr);
  };

  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push({ day: null, key: `empty-${i}` });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, key: `day-${d}` });
  }
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let i = 0; i < remaining; i++) {
      cells.push({ day: null, key: `trail-${i}` });
    }
  }

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button onClick={goBack} className={styles.navBtn}>&lt;</button>
        <h2>{MONTH_NAMES[currentMonth - 1]} {currentYear}</h2>
        <button onClick={goForward} className={styles.navBtn}>&gt;</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className={styles.calendar}>
          <thead>
            <tr>
              {DAY_NAMES.map((d) => <th key={d}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell) => {
                  if (!cell.day) {
                    return <td key={cell.key} className={styles.emptyCell}></td>;
                  }
                  const dayRes = getReservationsForDay(cell.day);
                  const hasConflict = dayRes.length > 1;

                  return (
                    <td key={cell.key} className={`${styles.dayCell} ${dayRes.length > 0 ? styles.hasReservation : ''}`}>
                      <span className={styles.dayNumber}>{cell.day}</span>
                      {dayRes.length > 0 && (
                        <div className={styles.resList}>
                          {dayRes.map((r) => (
                            <span key={r.id} className={styles.resName}>
                              {r.name}{r.size_of_party > 1 ? ` (+${r.size_of_party - 1})` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {hasConflict && (
                        <span className={styles.conflictIcon} title="Conflicting Reservations">
                          !
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
