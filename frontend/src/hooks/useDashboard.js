import { useEffect, useState } from 'react';

/** Returns { h, m, label, time } for the next enabled schedule that will actually fire. */
export function useNextFeed(schedules) {
  const [next, setNext] = useState(null);

  useEffect(() => {
    const calc = () => {
      // FIX #6: Filter by `days` field to match the server schedule runner's logic.
      // A weekday-only schedule must not show as "next" on a weekend and vice-versa.
      const nowManila = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
      const weekday = nowManila.getDay(); // 0=Sun, 6=Sat
      const isWeekend = weekday === 0 || weekday === 6;

      const enabled = schedules.filter(s => {
        if (!s.enabled) return false;
        if (s.days === 'weekdays' && isWeekend) return false;
        if (s.days === 'weekends' && !isWeekend) return false;
        return true;
      });
      if (!enabled.length) { setNext(null); return; }

      const now = new Date();
      // Calculate current time in Manila timezone, matching the server's schedule runner.
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const [hhStr, mmStr] = formatter.format(now).split(':');
      const nowMin = parseInt(hhStr, 10) * 60 + parseInt(mmStr, 10);

      // Build list of minutes-since-midnight for each applicable schedule
      const candidates = enabled.map(s => {
        const [hh, mm] = s.time.split(':').map(Number);
        const mins = hh * 60 + mm;
        const diff = mins > nowMin ? mins - nowMin : 1440 - nowMin + mins;
        return { label: s.label, time: s.time, diff };
      });

      candidates.sort((a, b) => a.diff - b.diff);
      const top = candidates[0];
      const h = Math.floor(top.diff / 60);
      const m = top.diff % 60;
      setNext({ h, m, label: top.label, time: top.time });
    };

    calc();
    const id = setInterval(calc, 30000);
    return () => clearInterval(id);
  }, [schedules]);

  return next;
}

/** Returns formatted uptime string, incrementing every second */
export function useUptime() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
