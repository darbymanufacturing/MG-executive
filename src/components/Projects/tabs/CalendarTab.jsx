import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useProjects } from '../../../context/ProjectContext.jsx';
import { collectCalendarEvents, groupEventsByDate, buildMonthWeeks, toDateStr, EVENT_COLORS } from '../../../utils/projectAggregations.js';
import { ASSIGNEES, CALENDAR_EVENT_TYPES } from '../constants.js';
import styles from './CalendarTab.module.css';

// ── Event dot/chip ────────────────────────────────────────────────────────────
function EventDot({ event }) {
  const color = EVENT_COLORS[event.type] || '#888';
  return <span className={styles.dot} style={{ background: color }} title={`${event.label} — ${event.subLabel}`} />;
}

function EventChip({ event, onClick }) {
  const color = EVENT_COLORS[event.type] || '#888';
  return (
    <button
      className={styles.chip}
      style={{ borderLeft: `3px solid ${color}` }}
      onClick={onClick}
    >
      <span className={styles.chipLabel}>{event.label}</span>
      <span className={styles.chipSub}>{event.subLabel}</span>
    </button>
  );
}

// ── Month View ────────────────────────────────────────────────────────────────
function MonthView({ year, month, eventsByDate, onDayClick, selectedDay }) {
  const today = toDateStr(new Date());
  const weeks = useMemo(() => buildMonthWeeks(year, month), [year, month]);
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className={styles.monthGrid}>
      {/* Day-of-week headers */}
      {DAY_LABELS.map((d) => (
        <div key={d} className={styles.dayHeader}>{d}</div>
      ))}
      {/* Days */}
      {weeks.flat().map((date, i) => {
        const key = toDateStr(date);
        const events = eventsByDate[key] || [];
        const isCurrentMonth = date.getMonth() === month;
        const isToday = key === today;
        const isSelected = key === selectedDay;
        const MAX_DOTS = 3;
        return (
          <button
            key={i}
            className={[
              styles.dayCell,
              !isCurrentMonth ? styles.dayOtherMonth : '',
              isToday        ? styles.dayToday     : '',
              isSelected     ? styles.daySelected  : '',
              events.length  ? styles.dayHasEvents : '',
            ].join(' ')}
            onClick={() => onDayClick(key)}
          >
            <span className={styles.dayNum}>{date.getDate()}</span>
            {events.length > 0 && (
              <div className={styles.dotsRow}>
                {events.slice(0, MAX_DOTS).map((ev, j) => (
                  <EventDot key={j} event={ev} />
                ))}
                {events.length > MAX_DOTS && (
                  <span className={styles.moreLabel}>+{events.length - MAX_DOTS}</span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Week View ─────────────────────────────────────────────────────────────────
function WeekView({ weekStart, eventsByDate, onDayClick, selectedDay }) {
  const today = toDateStr(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className={styles.weekGrid}>
      {days.map((date, i) => {
        const key = toDateStr(date);
        const events = eventsByDate[key] || [];
        const isToday = key === today;
        const isSelected = key === selectedDay;
        return (
          <div key={i} className={`${styles.weekCol} ${isToday ? styles.weekColToday : ''} ${isSelected ? styles.weekColSelected : ''}`}>
            <button className={styles.weekDayHeader} onClick={() => onDayClick(key)}>
              <span className={styles.weekDayName}>{DAY_LABELS[i]}</span>
              <span className={`${styles.weekDayNum} ${isToday ? styles.weekDayNumToday : ''}`}>
                {date.getDate()}
              </span>
            </button>
            <div className={styles.weekEvents}>
              {events.map((ev, j) => (
                <EventChip key={j} event={ev} onClick={() => onDayClick(key)} />
              ))}
              {events.length === 0 && <span className={styles.weekEmpty}>—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Side Panel ────────────────────────────────────────────────────────────────
function DayPanel({ day, events, onClose }) {
  const navigate = useNavigate();
  if (!day) return null;
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelDate}>{day}</span>
        <button className={styles.panelClose} onClick={onClose}><X size={14} /></button>
      </div>
      {events.length === 0 ? (
        <p className={styles.panelEmpty}>No events on this day.</p>
      ) : (
        <ul className={styles.panelList}>
          {events.map((ev, i) => {
            const color = EVENT_COLORS[ev.type] || '#888';
            return (
              <li key={i} className={styles.panelItem}>
                <span className={styles.panelDot} style={{ background: color }} />
                <div className={styles.panelInfo}>
                  <span className={styles.panelLabel}>{ev.label}</span>
                  <button
                    className={styles.panelProject}
                    onClick={() => navigate(`/projects/${ev.projectId}`)}
                  >
                    {ev.subLabel} →
                  </button>
                </div>
                <span className={styles.panelType}>{CALENDAR_EVENT_TYPES.find((t) => t.value === ev.type)?.label || ev.type}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Main CalendarTab ──────────────────────────────────────────────────────────
export default function CalendarTab() {
  const { activeProjects } = useProjects();
  const today = new Date();

  const [view,         setView]         = useState('month'); // 'month' | 'week'
  const [year,         setYear]         = useState(today.getFullYear());
  const [month,        setMonth]        = useState(today.getMonth());
  const [weekStart,    setWeekStart]    = useState(() => {
    const d = new Date(today);
    const dow = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDay,  setSelectedDay]  = useState(null);
  const [ownerFilter,  setOwnerFilter]  = useState('all');
  const [typeFilter,   setTypeFilter]   = useState('all');

  const allEvents = useMemo(() => collectCalendarEvents(activeProjects), [activeProjects]);

  const filteredEvents = useMemo(() => {
    return allEvents.filter((ev) => {
      if (ownerFilter !== 'all' && ev.owner !== ownerFilter) return false;
      if (typeFilter  !== 'all' && ev.type  !== typeFilter)  return false;
      return true;
    });
  }, [allEvents, ownerFilter, typeFilter]);

  const eventsByDate = useMemo(() => groupEventsByDate(filteredEvents), [filteredEvents]);

  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  function prevPeriod() {
    if (view === 'month') {
      if (month === 0) { setYear((y) => y - 1); setMonth(11); }
      else             { setMonth((m) => m - 1); }
    } else {
      const d = new Date(weekStart);
      d.setDate(d.getDate() - 7);
      setWeekStart(d);
    }
    setSelectedDay(null);
  }

  function nextPeriod() {
    if (view === 'month') {
      if (month === 11) { setYear((y) => y + 1); setMonth(0); }
      else              { setMonth((m) => m + 1); }
    } else {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + 7);
      setWeekStart(d);
    }
    setSelectedDay(null);
  }

  function goToday() {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    const d = new Date(now);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    setWeekStart(d);
    setSelectedDay(null);
  }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function periodLabel() {
    if (view === 'month') return `${MONTH_NAMES[month]} ${year}`;
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return `${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
  }

  return (
    <div className={styles.wrap}>
      {/* ── Controls ── */}
      <div className={styles.controls}>
        <div className={styles.navGroup}>
          <button className={styles.navBtn} onClick={prevPeriod}><ChevronLeft size={15} /></button>
          <span className={styles.periodLabel}>{periodLabel()}</span>
          <button className={styles.navBtn} onClick={nextPeriod}><ChevronRight size={15} /></button>
          <button className={styles.todayBtn} onClick={goToday}>Today</button>
        </div>
        <div className={styles.rightControls}>
          <select className={styles.filterSelect} value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
            <option value="all">All owners</option>
            {ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className={styles.filterSelect} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            {CALENDAR_EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className={styles.viewToggle}>
            <button className={`${styles.viewBtn} ${view === 'month' ? styles.viewBtnActive : ''}`} onClick={() => setView('month')}>Month</button>
            <button className={`${styles.viewBtn} ${view === 'week'  ? styles.viewBtnActive : ''}`} onClick={() => setView('week')}>Week</button>
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className={styles.legend}>
        {Object.entries(EVENT_COLORS).map(([type, color]) => (
          <span key={type} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: color }} />
            <span>{CALENDAR_EVENT_TYPES.find((t) => t.value === type)?.label || type}</span>
          </span>
        ))}
      </div>

      {/* ── Calendar + Side panel ── */}
      <div className={styles.body}>
        <div className={styles.calendarWrap}>
          {view === 'month' ? (
            <MonthView
              year={year}
              month={month}
              eventsByDate={eventsByDate}
              onDayClick={setSelectedDay}
              selectedDay={selectedDay}
            />
          ) : (
            <WeekView
              weekStart={weekStart}
              eventsByDate={eventsByDate}
              onDayClick={setSelectedDay}
              selectedDay={selectedDay}
            />
          )}
        </div>
        {selectedDay && (
          <DayPanel
            day={selectedDay}
            events={selectedEvents}
            onClose={() => setSelectedDay(null)}
          />
        )}
      </div>
    </div>
  );
}
