import { useEffect, useState } from 'react';

/** Returns { h, m, s, label } for the next enabled schedule */
export function useNextFeed(schedules) {
  const [next, setNext] = useState(null);

  useEffect(() => {
    const calc = () => {
      const enabled = schedules.filter(s => s.enabled);
      if (!enabled.length) { setNext(null); return; }

      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      // Build list of minutes-since-midnight for each schedule
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
