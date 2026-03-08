import { useState, useEffect } from 'react';
import styles from './DateRangePicker.module.css';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function toDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

export default function DateRangePicker({ startDate, endDate, onChange }) {
  const parsedStart = parseDate(startDate);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const [viewYear, setViewYear] = useState(parsedStart?.year || now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsedStart?.month ?? now.getMonth());
  const [hoverDate, setHoverDate] = useState(null);
  const [selecting, setSelecting] = useState(startDate ? 'end' : 'start');

  useEffect(() => {
    if (parsedStart) {
      setViewYear(parsedStart.year);
      setViewMonth(parsedStart.month);
    }
  }, [startDate]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const handleSelect = (dateStr) => {
    if (selecting === 'start') {
      onChange(dateStr, '');
      setSelecting('end');
    } else {
      if (startDate && dateStr < startDate) {
        onChange(dateStr, '');
        setSelecting('end');
      } else {
        onChange(startDate, dateStr);
        setSelecting('start');
      }
    }
  };

  const handleHover = (dateStr) => {
    if (selecting === 'end' && startDate) {
      setHoverDate(dateStr);
    }
  };

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const minDate = selecting === 'end' ? startDate : today;
  const rangeEnd = hoverDate || endDate;

  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`b${i}`} className={styles.blank} />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = toDateStr(viewYear, viewMonth, d);
    const isStart = dateStr === startDate;
    const isEnd = dateStr === endDate;
    const isDisabled = minDate && dateStr < minDate;
    const inRange = startDate && rangeEnd && dateStr > startDate && dateStr < rangeEnd;
    const isHoverEnd = hoverDate && dateStr === hoverDate && selecting === 'end';

    let cls = styles.day;
    if (isDisabled) cls += ` ${styles.disabled}`;
    else if (isStart) cls += ` ${styles.startDay}`;
    else if (isEnd || isHoverEnd) cls += ` ${styles.endDay}`;
    else if (inRange) cls += ` ${styles.inRange}`;
    if (dateStr === today && !isStart && !isEnd) cls += ` ${styles.today}`;

    cells.push(
      <button
        type="button"
        key={d}
        className={cls}
        disabled={isDisabled}
        onClick={() => handleSelect(dateStr)}
        onMouseEnter={() => handleHover(dateStr)}
        onMouseLeave={() => setHoverDate(null)}
      >
        {d}
      </button>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button type="button" onClick={prevMonth} className={styles.navBtn}>&lsaquo;</button>
        <span className={styles.monthLabel}>{MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={nextMonth} className={styles.navBtn}>&rsaquo;</button>
      </div>
      <div className={styles.hint}>
        {selecting === 'start' ? 'Select check-in date' : 'Select check-out date'}
      </div>
      <div className={styles.dayHeaders}>
        {DAYS.map((d) => <div key={d} className={styles.dayHeader}>{d}</div>)}
      </div>
      <div className={styles.grid}>{cells}</div>
      <div className={styles.summary}>
        <span className={startDate ? styles.dateSet : styles.datePlaceholder}>
          {startDate || 'Check-in'}
        </span>
        <span className={styles.arrow}>&rarr;</span>
        <span className={endDate ? styles.dateSet : styles.datePlaceholder}>
          {endDate || 'Check-out'}
        </span>
      </div>
    </div>
  );
}
