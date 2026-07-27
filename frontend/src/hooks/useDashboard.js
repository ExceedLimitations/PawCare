import { useEffect, useState } from 'react';

/** Returns { h, m, label, time } for the next enabled schedule that will actually fire. */
export function useNextFeed(schedules) {
  const [next, setNext] = useState(null);

  useEffect(() => {
    const calc = () => {
      const nowManila = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
      const currentWeekday = nowManila.getDay(); // 0=Sun, 6=Sat
      
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const [hhStr, mmStr] = formatter.format(now).replace(/^24:/, '00:').split(':');
      const nowMin = parseInt(hhStr, 10) * 60 + parseInt(mmStr, 10);

      const activeSchedules = schedules.filter(s => s.enabled);
      if (!activeSchedules.length) { setNext(null); return; }

      let bestDiff = Infinity;
      let nextRun = null;

      activeSchedules.forEach(s => {
        const [hh, mm] = s.time.split(':').map(Number);
        const mins = hh * 60 + mm;
        
        for (let i = 0; i < 7; i++) {
          const testWeekday = (currentWeekday + i) % 7;
          const isWeekend = testWeekday === 0 || testWeekday === 6;
          
          if (s.days === 'weekdays' && isWeekend) continue;
          if (s.days === 'weekends' && !isWeekend) continue;
          
          let diff;
          if (i === 0 && mins > nowMin) {
            diff = mins - nowMin;
          } else if (i > 0) {
            diff = (i * 1440) - nowMin + mins;
          } else {
            continue;
          }
          
          if (diff < bestDiff) {
            bestDiff = diff;
            nextRun = { label: s.label, time: s.time, diff };
          }
          break;
        }
      });

      if (!nextRun) { setNext(null); return; }

      const h = Math.floor(nextRun.diff / 60);
      const m = nextRun.diff % 60;
      setNext({ h, m, label: nextRun.label, time: nextRun.time });
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
