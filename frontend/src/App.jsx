import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, Loader2, Activity, BarChart3, Clock, CalendarDays, History, Settings2, Lock, User, Bell, Cpu, Wifi, Eye, Scale } from 'lucide-react';
import { useSocket } from './hooks/useSocket';
import petAvatar from './assets/pet_avatar.png';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

// Cat Paw SVG Icon
const CatPawIcon = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill={color} xmlns="http://www.w3.org/2000/svg">
    {/* Main central pad */}
    <ellipse cx="32" cy="42" rx="13" ry="11" />
    {/* Toe pads */}
    <ellipse cx="18" cy="30" rx="6" ry="7.5" transform="rotate(-15 18 30)" />
    <ellipse cx="46" cy="30" rx="6" ry="7.5" transform="rotate(15 46 30)" />
    <ellipse cx="26" cy="22" rx="5.5" ry="7" transform="rotate(-5 26 22)" />
    <ellipse cx="38" cy="22" rx="5.5" ry="7" transform="rotate(5 38 22)" />
  </svg>
);

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// Modern Hopper Gauge
const HopperSVG = ({ percentage }) => {
  const height = 120;
  const h = Math.max(0, Math.min(100, percentage)) * (height / 100);
  const fillStatusColor = percentage <= 20 ? "var(--status-error)" : percentage <= 50 ? "var(--status-warning)" : "var(--status-ok)";
  const topY = 140 - h;
  const leftX = 35 - 0.125 * h;
  const rightX = 65 + 0.125 * h;

  return (
    <svg viewBox="0 0 100 160" className="hopper-svg" style={{width: '60px', height: '120px'}}>
      <path d="M 20 20 L 80 20 L 65 140 L 35 140 Z" fill="var(--bg-muted)" />
      <path d={`M ${leftX} ${topY} L ${rightX} ${topY} L 65 140 L 35 140 Z`} fill={fillStatusColor} style={{ transition: 'all 1s cubic-bezier(0.4, 0, 0.2, 1)' }} />
      <path d="M 20 20 L 80 20 L 65 140 L 35 140 Z" fill="none" stroke="var(--border-dark)" strokeWidth="3" strokeLinejoin="round" />
      <line x1="25" y1="60" x2="35" y2="60" stroke="var(--border-dark)" strokeWidth="2" />
      <line x1="29" y1="100" x2="39" y2="100" stroke="var(--border-dark)" strokeWidth="2" />
    </svg>
  );
};

// Modern Bowl Visualizer
const BowlSVG = ({ weight }) => {
  const percentage = Math.min(100, (weight / 150) * 100);
  const fillStatusColor = "var(--status-warning)";
  // y position goes from 45 (empty) to 15 (full)
  const yPos = 45 - (30 * (percentage / 100));

  return (
    <svg viewBox="0 -3 100 60" className="bowl-svg" style={{width: '70px', height: '42px'}}>
      <defs>
        <clipPath id="bowl-clip-inner">
          <path d="M 15 15 C 15 45, 85 45, 85 15 Z" />
        </clipPath>
      </defs>
      <path d="M 10 10 C 10 50, 90 50, 90 10 Z" fill="var(--bg-muted)" />
      
      {percentage > 0 && (
        <rect 
          x="10" 
          y={yPos} 
          width="80" 
          height="40" 
          fill={fillStatusColor} 
          clipPath="url(#bowl-clip-inner)"
          style={{ transition: 'y 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      )}
      
      <path d="M 10 10 C 10 50, 90 50, 90 10 Z" fill="none" stroke="var(--border-dark)" strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="50" cy="10" rx="40" ry="6" fill="none" stroke="var(--border-dark)" strokeWidth="3" />
    </svg>
  );
};

// Horizontal Timeline Component
const FeedingTimeline = ({ schedules, recentFeedings, currentTime, onManageSchedules }) => {
  const getTimelinePosition = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return ((h * 60 + m) / 1440) * 100;
  };

  const [hNow, mNow] = currentTime.split(':').map(Number);
  const currentMinutes = hNow * 60 + mNow;

  const futureEnabledSchedules = schedules
    .filter(s => s.enabled)
    .map(s => {
      const [h, m] = s.time.split(':').map(Number);
      const minutes = h * 60 + m;
      return { ...s, minutes };
    })
    .filter(s => s.minutes > currentMinutes);

  let nextUpcomingId = null;
  if (futureEnabledSchedules.length > 0) {
    futureEnabledSchedules.sort((a, b) => a.minutes - b.minutes);
    nextUpcomingId = futureEnabledSchedules[0].id;
  } else {
    const enabledSchedules = schedules
      .filter(s => s.enabled)
      .map(s => {
        const [h, m] = s.time.split(':').map(Number);
        const minutes = h * 60 + m;
        return { ...s, minutes };
      });
    if (enabledSchedules.length > 0) {
      enabledSchedules.sort((a, b) => a.minutes - b.minutes);
      nextUpcomingId = enabledSchedules[0].id;
    }
  }

  return (
    <div className="tactile-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">
        <Clock size={18} />
        <span className="label-caps">FEEDING SCHEDULE</span>
      </div>
      
      <div className="timeline-axis-wrapper">
        <div className="timeline-line">
          {[0, 4, 8, 12, 16, 20, 24].map(h => {
            const pct = (h / 24) * 100;
            return (
              <div key={h} style={{ position: 'absolute', left: `${pct}%`, height: '100%', top: 0 }}>
                <div className="timeline-tick" />
                <div className="timeline-tick-label">{String(h).padStart(2, '0')}:00</div>
              </div>
            );
          })}

          {schedules.map(s => {
            const pct = getTimelinePosition(s.time);
            const [sh, sm] = s.time.split(':').map(Number);
            const sMinutes = sh * 60 + sm;
            
            let state = 'upcoming';
            if (!s.enabled) {
              state = 'disabled';
            } else if (sMinutes < currentMinutes) {
              const startOfDay = new Date();
              startOfDay.setHours(0,0,0,0);
              
              const wasDispensed = recentFeedings.some(f => {
                const fedTime = new Date(f.timestamp);
                return fedTime >= startOfDay && f.type === 'scheduled' && f.label === s.label;
              });

              state = wasDispensed ? 'completed' : 'missed';
            }

            const isNext = s.id === nextUpcomingId;

            return (
              <div 
                key={s.id} 
                className="timeline-marker-wrapper"
                style={{ left: `${pct}%` }}
              >
                <div className={`timeline-marker ${state} ${isNext ? 'next-pulse' : ''}`}>
                  {state === 'completed' && <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--status-ok)' }} />}
                  {state === 'upcoming' && <div style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid var(--status-warning)' }} />}
                  {state === 'missed' && <span style={{ color: 'var(--status-error)', fontSize: '10px', fontWeight: 'bold' }}>✕</span>}
                  {state === 'disabled' && <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--text-muted)' }} />}
                </div>
                <div className="timeline-marker-label">
                  {s.label} · {s.portion_g}g · {s.time}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="schedule-actions" style={{ marginTop: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {schedules.filter(s => s.enabled).length} of {schedules.length} active
          </span>
        </div>
      </div>
    </div>
  );
};

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (data.success) {
        localStorage.setItem('pawcare_auth', data.token);
        onLogin(true);
      } else {
        setError(data.error || 'Invalid credentials');
      }
    } catch (err) {
      setError('Server connection failed');
    }
    setLoading(false);
  };

  return (
    <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-app)' }}>
      <div className="tactile-card" style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
          <div className="brand-icon" style={{ width: 56, height: 56, marginBottom: '16px' }}>
            <CatPawIcon size={32} color="white" />
          </div>
          <h1 className="font-serif" style={{ fontSize: '1.5rem', marginBottom: '8px' }}>PawCare Platform</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Sign in to access telemetry</p>
        </div>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {error && <div style={{ color: 'var(--status-error)', backgroundColor: '#FEF2F2', padding: '12px', borderRadius: '8px', fontSize: '0.85rem', textAlign: 'center', fontWeight: '500' }}>{error}</div>}
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className="label-caps">Username</label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
              <input 
                type="text" 
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                required
                style={{ width: '100%', padding: '12px 12px 12px 40px', borderRadius: '8px', border: '1px solid var(--border-dark)', backgroundColor: 'var(--bg-app)', fontSize: '0.95rem' }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className="label-caps">Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{ width: '100%', padding: '12px 12px 12px 40px', borderRadius: '8px', border: '1px solid var(--border-dark)', backgroundColor: 'var(--bg-app)', fontSize: '0.95rem' }}
              />
            </div>
          </div>
          
          <button type="submit" className="btn-primary" style={{ marginTop: '8px' }} disabled={loading}>
            {loading ? <Loader2 size={18} style={{ animation: 'spin 1.5s linear infinite' }} /> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return !!localStorage.getItem('pawcare_auth');
  });

  // Authenticated fetch — injects Bearer token and auto-logs out on 401
  const authFetch = useCallback((url, options = {}) => {
    const token = localStorage.getItem('pawcare_auth');
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...options, headers }).then(res => {
      if (res.status === 401) {
        localStorage.removeItem('pawcare_auth');
        setIsAuthenticated(false);
      }
      return res;
    });
  }, []);
  const [profile, setProfile] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editProfile, setEditProfile] = useState({ name: '', breed: '' });
  const [status, setStatus] = useState({ food_level: 0, jammed: false, last_dispensed_g: 0, bowl_weight: 0, dispense_success: null });
  const [feedingsToday, setFeedingsToday] = useState(0);
  const [lastFed, setLastFed] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [recentFeedings, setRecentFeedings] = useState([]);
  const [weeklyFeedings, setWeeklyFeedings] = useState([]);
  const [chartPeriod, setChartPeriod] = useState('week');
  const [chartFeedings, setChartFeedings] = useState([]);
  const [feeding, setFeeding] = useState(false);
  const [dispenseSuccess, setDispenseSuccess] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [weightDelta, setWeightDelta] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSchedule, setNewSchedule] = useState({ label: '', time: '08:00', portion_g: 100 });
  const [currentTime, setCurrentTime] = useState('12:00');
  const [lastSyncTime, setLastSyncTime] = useState('—');
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [manualPortion, setManualPortion] = useState(100);
  const deviceTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (deviceTimeoutRef.current) clearTimeout(deviceTimeoutRef.current);
    };
  }, []);

  const addLog = useCallback((type, msg) => {
    console.log(`[${type.toUpperCase()}] ${msg}`);
  }, []);

  const addAlert = useCallback((type, title, message) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const time = new Date().toLocaleTimeString([], { hour12: false });
    setAlerts(p => [{ id, type, title, message, time }, ...p]);
  }, []);

  const dismissAlert = (id) => {
    setAlerts(p => p.filter(a => a.id !== id));
  };

  const handleStatusUpdate = useCallback((newStatus, isLive = true) => {
    setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    setStatus(prev => {
      const oldWeight = prev.bowl_weight ?? prev.last_dispensed_g ?? 0;
      const currentWeight = newStatus.bowl_weight ?? newStatus.last_dispensed_g ?? 0;
      if (oldWeight !== 0 && currentWeight !== oldWeight) {
        setTimeout(() => setWeightDelta(currentWeight - oldWeight), 0);
      }
      return { ...prev, ...newStatus };
    });

    if (isLive) {
      setDeviceConnected(true);
      if (deviceTimeoutRef.current) clearTimeout(deviceTimeoutRef.current);
      deviceTimeoutRef.current = setTimeout(() => {
        setDeviceConnected(false);
      }, 6000);
    }
  }, []);

  const { connected, emit } = useSocket({
    onStatus: handleStatusUpdate,
    onFeedingsToday: d => setFeedingsToday(d.count || 0),
    onFeedingDone: d => {
      setFeedingsToday(p => p + 1);
      setFeeding(false);
      setDispenseSuccess(true);
      setTimeout(() => setDispenseSuccess(false), 3000);
      const t = new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      setLastFed({ time: t, amount: d.portion_g, type: d.type });
      addLog('ok', `${d.type === 'scheduled' ? 'Scheduled' : 'Manual'} dispense — ${d.portion_g}g dispensed at ${t}`);
      setRecentFeedings(p => [d, ...p].slice(0, 50));
      
      // Update weekly chart slightly by assuming today's value incremented
      const todayIso = new Date().toISOString().slice(0, 10);
      setWeeklyFeedings(prev => {
        const next = [...prev];
        const dayIdx = next.findIndex(w => w.day === todayIso);
        if (dayIdx >= 0) {
          next[dayIdx] = { ...next[dayIdx], total_g: next[dayIdx].total_g + d.portion_g };
        } else {
          next.push({ day: todayIso, total_g: d.portion_g, count: 1 });
        }
        return next;
      });
    },
    onAlert: d => {
      addLog(d.level === 'error' ? 'err' : 'warn', d.message);
      addAlert(d.level === 'error' ? 'error' : 'warning', d.level === 'error' ? 'Fault Detected' : 'System Notice', d.message);
    },
    token: localStorage.getItem('pawcare_auth'),
  });

  const prevJammed = useRef(false);
  useEffect(() => {
    if (status.jammed && !prevJammed.current) {
      addAlert('error', 'Feeder Jammed', 'IR beam blocked or motor stall detected. Inspect hopper immediately.');
      addLog('err', 'Feeder Jammed — IR beam blocked');
    }
    prevJammed.current = status.jammed;
  }, [status.jammed, addAlert, addLog]);

  const prevLowFood = useRef(false);
  useEffect(() => {
    if (status.food_level > 0 && status.food_level < 20 && !prevLowFood.current) {
      addAlert('warning', 'Low Food Level', `Food reservoir is at ${status.food_level}%. Please refill.`);
      addLog('warn', `Low food level detected: ${status.food_level}%`);
    }
    prevLowFood.current = status.food_level > 0 && status.food_level < 20;
  }, [status.food_level, addAlert, addLog]);

  useEffect(() => {
    const init = async () => {
      try {
        const [s, today, sched, recent, weekly, prof] = await Promise.allSettled([
          authFetch('/status').then(r => r.json()),
          authFetch('/feedings/today').then(r => r.json()),
          authFetch('/schedules').then(r => r.json()),
          authFetch('/feedings/recent').then(r => r.json()),
          authFetch('/feedings/weekly').then(r => r.json()),
          authFetch('/profile').then(r => r.json()),
        ]);
        if (s.status === 'fulfilled' && s.value && !s.value.error) {
          handleStatusUpdate(s.value, false);
        }
        if (today.status === 'fulfilled' && today.value && !today.value.error) setFeedingsToday(today.value.count || 0);
        if (sched.status === 'fulfilled' && Array.isArray(sched.value)) setSchedules(sched.value);
        if (recent.status === 'fulfilled' && Array.isArray(recent.value)) {
          setRecentFeedings(recent.value);
          if (recent.value.length > 0) {
            const last = recent.value[0];
            const t = new Date(last.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            setLastFed({ time: t, amount: last.portion_g, type: last.type });
          }
        }
        if (weekly.status === 'fulfilled' && Array.isArray(weekly.value)) {
          setWeeklyFeedings(weekly.value);
        }
        if (prof && prof.status === 'fulfilled' && prof.value) {
          setProfile(prof.value);
        }
      } catch (err) {
        console.warn('Backend connection failed:', err);
      }
    };
    init();

    const timer = setInterval(() => {
      const d = new Date();
      setCurrentTime(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    }, 1000);

    return () => clearInterval(timer);
  }, [handleStatusUpdate]);

  const triggerManualDispense = () => {
    if (feeding) return;
    setFeeding(true);
    setDispenseSuccess(false);
    emit('feed', { portion: manualPortion, type: 'manual' });
    addLog('info', `Manual dispense triggered — ${manualPortion}g requested to ESP32`);
    
    // Safety timeout to release button lock if ESP32 never responds
    setTimeout(() => {
      setFeeding(false);
    }, 15000);
  };

  const toggleSchedule = (id, enabled) => {
    authFetch(`/schedules/${id}`, { 
      method: 'PATCH', 
      body: JSON.stringify({ enabled }) 
    })
    .then(() => {
      setSchedules(p => p.map(s => s.id === id ? { ...s, enabled } : s));
      addLog('info', `Schedule slot ${enabled ? 'enabled' : 'disabled'}`);
    });
  };

  const deleteSchedule = (id) => {
    if (!confirm('Delete this feeding schedule?')) return;
    authFetch(`/schedules/${id}`, { method: 'DELETE' })
      .then(() => {
        setSchedules(p => p.filter(s => s.id !== id));
        addLog('warn', `Schedule slot deleted`);
      });
  };

  const handleAddScheduleClick = () => {
    setNewSchedule({ label: 'Custom Feed', time: '08:00', portion_g: 100 });
    setShowAddModal(true);
  };

  const saveNewSchedule = () => {
    authFetch('/schedules', { 
      method: 'POST', 
      body: JSON.stringify({ 
        label: newSchedule.label || 'Custom Slot', 
        time: newSchedule.time, 
        portion_g: newSchedule.portion_g, 
        days: 'daily' 
      }) 
    })
    .then(r => r.json())
    .then(s => {
      if (s.id) {
        setSchedules(p => [...p, s]);
        setShowAddModal(false);
        addLog('ok', `Added new schedule slot: ${s.label} at ${s.time}`);
      }
    });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 250;
        const MAX_HEIGHT = 250;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setEditProfile(prev => ({ ...prev, avatar: dataUrl }));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    try {
      const res = await authFetch('/profile', {
        method: 'POST',
        body: JSON.stringify(editProfile),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const p = await res.json();
      if (!p || typeof p.name === 'undefined') throw new Error('Invalid response from server');
      setProfile(p);
      setShowProfileModal(false);
      addLog('ok', `Updated pet profile — ${p.name} (${p.breed})`);
    } catch (err) {
      addLog('err', `Failed to save profile: ${err.message}`);
      addAlert('error', 'Profile Save Failed', `Could not save profile: ${err.message}`);
    }
  };

  const fetchChartData = useCallback(async (period) => {
    const endpoint = period === 'day' ? '/feedings/daily' : period === 'month' ? '/feedings/monthly' : '/feedings/weekly';
    try {
      const res = await authFetch(endpoint);
      const data = await res.json();
      if (Array.isArray(data)) setChartFeedings(data);
    } catch (err) {
      console.warn('Chart fetch failed:', err);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchChartData(chartPeriod);
  }, [chartPeriod, fetchChartData]);

  const chartData = {
    labels: chartFeedings.map(f => {
      if (f.hour !== undefined) return `${f.hour}:00`;
      if (f.day !== undefined) return f.day.slice(5); // MM-DD
      return '';
    }),
    datasets: [
      {
        label: 'Dispensed (g)',
        data: chartFeedings.map(f => f.total_g),
        backgroundColor: '#10B981',
        borderRadius: 4,
        barThickness: chartPeriod === 'month' ? 10 : 24,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0F172A',
        titleFont: { family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", size: 13 },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
        padding: 12,
        cornerRadius: 8,
        displayColors: false,
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", size: 11 }, color: '#64748B' },
        border: { display: false },
        title: {
          display: true,
          text: chartPeriod === 'day' ? 'Time of Day' : 'Date',
          color: '#94A3B8',
          font: { family: "'JetBrains Mono', monospace", size: 11, weight: '500' },
          padding: { top: 8 },
        }
      },
      y: {
        border: { display: false },
        grid: { color: '#E2E8F0', drawTicks: false },
        ticks: { font: { family: "'JetBrains Mono', monospace", size: 11 }, color: '#64748B', stepSize: 50 },
        beginAtZero: true,
        title: {
          display: true,
          text: 'Food Dispensed (g)',
          color: '#94A3B8',
          font: { family: "'JetBrains Mono', monospace", size: 11, weight: '500' },
          padding: { bottom: 8 },
        }
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('pawcare_auth');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <Login onLogin={setIsAuthenticated} />;
  }

  return (
    <div className="app-container">
      {/* Sleek Top Navbar */}
      <header className="navbar">
        {/* Left — Brand */}
        <div className="nav-brand">
          <div className="brand-icon">
            <CatPawIcon size={20} color="white" />
          </div>
          <span className="brand-text font-serif">PawCare Platform</span>
          <div style={{ marginLeft: '16px' }} className={`status-badge ${connected && deviceConnected ? 'online' : 'offline'}`}>
            <span className="status-dot"></span>
            {connected && deviceConnected ? 'System Online' : 'System Offline'}
          </div>
        </div>

        {/* Center — System Status */}
        <div className="nav-center">
        </div>

        {/* Right — Session Info */}
        <div className="nav-info">
          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Welcome, Admin</span>
          <span className="nav-divider">|</span>
          <span className="font-mono">{currentTime}</span>
          <span className="nav-divider">|</span>
          <span className="font-mono">SYNC: {lastSyncTime}</span>
          <span className="nav-divider">|</span>
          <button 
            onClick={handleLogout}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500' }}
          >
            Log Out
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="dashboard-layout">
        
        {/* Left Column — Device & Metrics */}
        <section className="left-column">
          
          <div className="tactile-card profile-card-enhanced" style={{ position: 'relative' }}>
            <div className={`profile-avatar${profile ? '' : ' skeleton'}`}>
              {profile && <img src={profile.avatar || petAvatar} alt="Pet Avatar" />}
            </div>
            <div className="profile-card-info">
              <h2 className="profile-name">{profile ? (profile.name || 'Unnamed Pet') : 'Loading...'}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                <span className="profile-subtitle">
                  {profile ? (profile.breed || 'Breed not set') : 'Fetching profile...'}
                </span>
                <span className="profile-subtitle">
                  {profile ? (profile.age != null ? (profile.age + (profile.age !== 1 ? ' years old' : ' year old')) : 'Age not set') : 'Loading...'}
                </span>
                <span className="profile-subtitle">
                  {profile ? (profile.birthday ? ('Born ' + new Date(profile.birthday).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) : 'No birthday set') : 'Loading...'}
                </span>
              </div>
            </div>
            <button 
              onClick={() => {
                setEditProfile({ name: profile?.name || '', breed: profile?.breed || '', birthday: profile?.birthday || '', age: profile?.age ?? '', avatar: profile?.avatar || null });
                setShowProfileModal(true);
              }}
              style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}
            >
              <Settings2 size={18} />
            </button>
          </div>

          <div className="visualizer-row">
            <div className="hopper-container">
              <HopperSVG percentage={status.food_level} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div className="metric-value font-mono" style={{ marginTop: 0 }}>{status.food_level}%</div>
                <div className="metric-label">RESERVOIR</div>
              </div>
            </div>

            <div className="bowl-weight-container">
              <BowlSVG weight={Math.max(0, status.bowl_weight ?? status.last_dispensed_g ?? 0)} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div className="metric-value font-mono" style={{ marginTop: 0 }}>
                  {Math.max(0, status.bowl_weight ?? status.last_dispensed_g ?? 0).toFixed(1)}
                  <span className="metric-unit">g</span>
                </div>
                <div className="metric-label">BOWL LOAD</div>
                {weightDelta !== 0 && (
                  <div className={`bowl-weight-delta font-mono ${weightDelta > 0 ? 'positive' : 'negative'}`}>
                    {weightDelta > 0 ? `+${weightDelta.toFixed(0)}g` : `${weightDelta.toFixed(0)}g`}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="tactile-card">
            <div className="card-header" style={{ marginBottom: '16px' }}>
              <Activity size={18} />
              <span className="label-caps">DEVICE TELEMETRY</span>
            </div>
            <div className="telemetry-list">
              
              <div className="telemetry-item">
                <div className="telemetry-label">
                  <div className="telemetry-icon-min"><Cpu size={16} /></div>
                  Motor
                </div>
                <div className="telemetry-status-minimal" style={{ color: !deviceConnected ? 'var(--status-error)' : status.jammed ? 'var(--status-error)' : 'var(--status-ok)' }}>
                  {!deviceConnected ? 'OFFLINE' : status.jammed ? 'JAMMED' : 'NOMINAL'}
                  <span className={`pill-dot ${!deviceConnected ? 'red' : status.jammed ? 'red' : 'green'}`} />
                </div>
              </div>

              <div className="telemetry-item">
                <div className="telemetry-label">
                  <div className="telemetry-icon-min"><Eye size={16} /></div>
                  IR Sensor
                </div>
                <div className="telemetry-status-minimal" style={{ color: !deviceConnected ? 'var(--status-error)' : status.jammed ? 'var(--status-error)' : 'var(--status-ok)' }}>
                  {!deviceConnected ? 'OFFLINE' : status.jammed ? 'BLOCKED' : 'CLEAR'}
                  <span className={`pill-dot ${!deviceConnected ? 'red' : status.jammed ? 'red' : 'green'}`} />
                </div>
              </div>

              <div className="telemetry-item">
                <div className="telemetry-label">
                  <div className="telemetry-icon-min"><Scale size={16} /></div>
                  Load Cell
                </div>
                <div className="telemetry-status-minimal" style={{ color: !deviceConnected ? 'var(--status-error)' : (status.last_dispensed_g === null) ? 'var(--status-warning)' : 'var(--status-ok)' }}>
                  {!deviceConnected ? 'OFFLINE' : (status.last_dispensed_g === null) ? 'CALIBRATING' : 'ACTIVE'}
                  <span className={`pill-dot ${!deviceConnected ? 'red' : (status.last_dispensed_g === null) ? 'amber' : 'green'}`} />
                </div>
              </div>

              <div className="telemetry-item">
                <div className="telemetry-label">
                  <div className="telemetry-icon-min"><Wifi size={16} /></div>
                  Network
                </div>
                <div className="telemetry-status-minimal" style={{ color: connected && deviceConnected ? 'var(--status-ok)' : 'var(--status-error)' }}>
                  {connected && deviceConnected ? 'CONNECTED' : 'DISCONNECTED'}
                  <span className={`pill-dot ${connected && deviceConnected ? 'green' : 'red'}`} />
                </div>
              </div>

            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <div className="tactile-card" style={{ flex: '0 0 auto', padding: '0 12px', display: 'flex', alignItems: 'center', margin: 0 }}>
              <input 
                type="number" 
                value={manualPortion}
                onChange={(e) => setManualPortion(Math.max(1, parseInt(e.target.value) || 10))}
                style={{ width: '45px', background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '1.1rem', textAlign: 'right', outline: 'none', padding: 0 }}
                className="font-mono"
              />
              <span className="font-mono" style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>g</span>
            </div>
            <button 
              className={`btn-primary ${dispenseSuccess ? 'success-state' : ''}`}
              style={{ flex: 1, margin: 0 }}
              onClick={triggerManualDispense}
              disabled={feeding || (!connected || !deviceConnected)}
            >
              {feeding ? (
              <>
                <Loader2 size={18} style={{ animation: 'spin 1.5s linear infinite' }} />
                <span>Command Sent...</span>
              </>
            ) : dispenseSuccess ? (
              <>
                <CheckCircle size={18} />
                <span>Dispense Confirmed!</span>
              </>
            ) : (
              <>
                <Activity size={18} />
                <span>Manual Dispense</span>
              </>
              )}
            </button>
          </div>
        </section>

        {/* Middle Column — Charts & Schedules */}
        <section className="main-column">
          <div className="tactile-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div className="card-header" style={{ marginBottom: 0 }}>
                <BarChart3 size={18} />
                <span className="label-caps">
                  {chartPeriod === 'day' ? 'TODAY\'S FEEDING VOLUME' : chartPeriod === 'month' ? '30-DAY FEEDING VOLUME' : '7-DAY FEEDING VOLUME'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['day', 'week', 'month'].map(p => (
                  <button
                    key={p}
                    onClick={() => setChartPeriod(p)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      borderRadius: '6px',
                      border: '1px solid',
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      transition: 'all 0.15s',
                      backgroundColor: chartPeriod === p ? 'var(--text-main)' : 'transparent',
                      color: chartPeriod === p ? 'white' : 'var(--text-muted)',
                      borderColor: chartPeriod === p ? 'var(--text-main)' : 'var(--border-dark)',
                    }}
                  >
                    {p === 'day' ? 'Day' : p === 'week' ? 'Week' : 'Month'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ height: '260px', width: '100%', position: 'relative' }}>
              {chartFeedings.length > 0 ? (
                <Bar key={chartPeriod} data={chartData} options={chartOptions} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }} className="font-mono">
                  No data for this period
                </div>
              )}
            </div>
          </div>

          <FeedingTimeline 
            schedules={schedules} 
            recentFeedings={recentFeedings}
            currentTime={currentTime}
            onManageSchedules={handleAddScheduleClick}
          />

          <div className="tactile-card" style={{ height: '300px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div className="card-header" style={{ marginBottom: 0 }}>
                <Settings2 size={18} />
                <span className="label-caps">MANAGE SCHEDULES</span>
              </div>
              <button 
                className="btn-secondary" 
                style={{ backgroundColor: 'var(--text-main)', color: 'white', borderColor: 'var(--text-main)' }}
                onClick={handleAddScheduleClick}
              >
                + Add Schedule
              </button>
            </div>
            
            <div className="management-list" style={{ overflowY: 'auto', maxHeight: '185px' }}>
              {schedules.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-light)' }} className="font-mono">
                  No schedules configured
                </div>
              ) : (
                schedules.map(s => (
                  <div key={s.id} className="management-item">
                    <span className="management-info font-mono">
                      <strong>{s.label}</strong> <span style={{color: 'var(--border-dark)'}}>|</span> {s.portion_g}g <span style={{color: 'var(--border-dark)'}}>|</span> {s.time}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                      <label className="toggle">
                        <input 
                          type="checkbox" 
                          checked={s.enabled} 
                          onChange={e => toggleSchedule(s.id, e.target.checked)} 
                        />
                        <span className="toggle-track" />
                      </label>
                      <button className="management-delete" onClick={() => deleteSchedule(s.id)}>Remove</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right Column — Stats & Telemetry & Event Log */}
        <section className="right-column">
          <div className="stat-grid">
            <div className="tactile-card stat-card-compact">
              <div className="card-header" style={{ marginBottom: 12 }}>
                <BarChart3 size={16} />
                <span className="label-caps">TODAY</span>
              </div>
              <div className="stat-card-value font-mono">{feedingsToday}</div>
              <div className="stat-card-subtext">{schedules.length} scheduled</div>
            </div>
            
            <div className="tactile-card stat-card-compact">
              <div className="card-header" style={{ marginBottom: 12 }}>
                <CalendarDays size={16} />
                <span className="label-caps">LAST FED</span>
              </div>
              <div className="stat-card-value font-mono" style={{ fontSize: '1.4rem' }}>
                {lastFed ? lastFed.time : '—'}
              </div>
              <div className="stat-card-subtext">
                {lastFed ? `${lastFed.amount}g` : 'Awaiting'}
              </div>
            </div>
          </div>

          <div className="tactile-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bell size={18} />
                <span className="label-caps">SYSTEM NOTIFICATIONS</span>
              </div>
              <button onClick={() => setAlerts([])} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}>
                Clear
              </button>
            </div>
            <div className="history-list" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {alerts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-light)' }} className="font-mono">
                  No active alerts
                </div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} style={{ display: 'flex', flexDirection: 'column', padding: '12px', borderBottom: '1px solid var(--border)', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: a.type === 'error' ? 'var(--status-error)' : 'var(--status-warning)' }}>
                        {a.title}
                      </span>
                      <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{a.time}</span>
                    </div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>{a.message}</span>
                    <button onClick={() => dismissAlert(a.id)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', padding: '4px 0', marginTop: '4px', textDecoration: 'underline' }}>
                      Dismiss
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="tactile-card" style={{ height: '300px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="card-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <History size={18} />
                <span className="label-caps">ESP32 EVENT LOG</span>
              </div>
              <button onClick={() => setRecentFeedings([])} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}>
                Clear
              </button>
            </div>
            <div className="history-list" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {recentFeedings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-light)' }} className="font-mono">
                  Awaiting ESP32 sync...
                </div>
              ) : (
                recentFeedings.map((f, i) => {
                  const localTime = new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                  return (
                    <div key={f.id || i} className="history-row-compact">
                      <span className="history-timestamp font-mono">{localTime}</span>
                      <div className="history-chip-wrapper">
                        <span className={`history-chip ${f.type || 'auto'}`}>
                          {(f.type || 'auto').toUpperCase()}
                        </span>
                      </div>
                      <span className="history-portion font-mono">{f.portion_g || f.amount || 50}g</span>
                      <div className="history-status-icon ok">
                        <CheckCircle size={16} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>



      {showProfileModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title font-serif">Edit Profile</div>
            
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ position: 'relative', width: '100px', height: '100px', borderRadius: '50%', overflow: 'hidden', border: '3px solid var(--border)', marginBottom: '12px' }}>
                <img src={editProfile.avatar || profile?.avatar || petAvatar} alt="Avatar Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <label style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: '0.7rem', textAlign: 'center', padding: '4px 0', cursor: 'pointer', fontWeight: 600 }}>
                  CHANGE
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                </label>
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Click to upload photo</span>
            </div>
            
            <div className="form-group">
              <label className="form-label">Pet Name</label>
              <input 
                type="text" 
                className="form-input" 
                value={editProfile.name} 
                onChange={e => setEditProfile({ ...editProfile, name: e.target.value })} 
                placeholder="e.g. Bantay" 
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Breed / Subtitle</label>
              <input 
                type="text" 
                className="form-input" 
                value={editProfile.breed} 
                onChange={e => setEditProfile({ ...editProfile, breed: e.target.value })} 
                placeholder="e.g. Golden Retriever" 
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Age (years)</label>
                <input
                  type="number"
                  min="0"
                  max="30"
                  className="form-input"
                  value={editProfile.age ?? ''}
                  onChange={e => setEditProfile({ ...editProfile, age: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="e.g. 2"
                />
              </div>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Birthday</label>
                <input
                  type="date"
                  className="form-input"
                  value={editProfile.birthday || ''}
                  onChange={e => {
                    const bd = e.target.value;
                    const autoAge = bd ? Math.floor((Date.now() - new Date(bd)) / (365.25 * 86400000)) : '';
                    setEditProfile({ ...editProfile, birthday: bd, age: autoAge });
                  }}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowProfileModal(false)}>Cancel</button>
              <button 
                className="btn-primary" 
                style={{ width: 'auto', padding: '10px 24px' }}
                onClick={saveProfile}
              >
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title font-serif">Add Feeding Schedule</div>
            
            <div className="form-group">
              <label className="form-label">Slot Label</label>
              <input 
                type="text" 
                className="form-input" 
                value={newSchedule.label} 
                onChange={e => setNewSchedule({ ...newSchedule, label: e.target.value })} 
                placeholder="e.g. Breakfast" 
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Time</label>
              <input 
                type="time" 
                className="form-input" 
                value={newSchedule.time} 
                onChange={e => setNewSchedule({ ...newSchedule, time: e.target.value })} 
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Portion Size (grams)</label>
              <input 
                type="number" 
                className="form-input" 
                value={newSchedule.portion_g} 
                onChange={e => setNewSchedule({ ...newSchedule, portion_g: parseInt(e.target.value) || 100 })} 
              />
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button 
                className="btn-primary" 
                style={{ width: 'auto', padding: '10px 24px' }}
                onClick={saveNewSchedule}
              >
                Save Slot
              </button>
            </div>
          </div>
        </div>
      )}
      
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
