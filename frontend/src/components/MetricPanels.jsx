/* eslint-disable no-unused-vars */
import React from 'react';
import { Wifi, WifiOff, Cpu, Clock, AlertTriangle, CheckCircle, Zap } from 'lucide-react';
import { useUptime } from '../hooks/useDashboard';

/** Animated jam detection badge */
export function JamBadge({ jammed }) {
  return (
    <div className={`jam-badge ${jammed ? 'jam-err' : 'jam-ok'}`}>
      <span className="jam-dot" />
      {jammed
        ? 'MECHANICAL JAM DETECTED — Inspect feeder immediately'
        : 'IR Beam Clear — No blockage detected'}
    </div>
  );
}

/** ESP32 + Firebase connectivity panel */
export function HardwareStatus({ connected, status }) {
  const uptime = useUptime();
  const bowlWeight = status.bowl_weight ?? status.last_dispensed_g ?? 0;
  const dispenseOk = status.dispense_success;

  return (
    <div className="hw-strip">
      <div className="hw-row">
        <div className="hw-row-left">
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>ESP32 Connection</span>
        </div>
        <span className={`hw-val ${connected ? 'online' : 'offline'}`}>
          {connected ? '● Online' : '○ Offline'}
        </span>
      </div>
      <div className="hw-row">
        <div className="hw-row-left"><Cpu size={14} /><span>Firebase Sync</span></div>
        <span className={`hw-val ${connected ? 'online' : 'offline'}`}>
          {connected ? 'Synced' : 'Disconnected'}
        </span>
      </div>
      <div className="hw-row">
        <div className="hw-row-left"><Clock size={14} /><span>Session Uptime</span></div>
        <span className="hw-val"><span className="uptime-display">{uptime}</span></span>
      </div>
      <div className="hw-row">
        <div className="hw-row-left">
          {dispenseOk ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          <span>Last Dispense</span>
        </div>
        <span className={`hw-val ${dispenseOk ? 'online' : dispenseOk === false ? 'offline' : ''}`}>
          {dispenseOk === true ? 'Verified' : dispenseOk === false ? 'Incomplete' : 'Awaiting...'}
        </span>
      </div>
      <div className="hw-row">
        <div className="hw-row-left"><Zap size={14} /><span>Bowl Weight (HX711)</span></div>
        <span className="hw-val" style={{ color: 'var(--sky)' }}>
          {Math.max(0, bowlWeight).toFixed(1)} g
        </span>
      </div>
    </div>
  );
}

/** Retro terminal log */
export function TerminalLog({ logs }) {
  const logTypeClass = { ok: 't-ok', warn: 't-warn', err: 't-err', info: 't-info' };
  const prefix = { ok: '[OK]', warn: '[WARN]', err: '[ERR]', info: '[INFO]' };

  return (
    <div className="terminal-window">
      <div className="terminal-titlebar">
        <span className="t-dot t-dot-red" />
        <span className="t-dot t-dot-yellow" />
        <span className="t-dot t-dot-green" />
        <span className="t-window-title">pawfeed@esp32:~</span>
      </div>
      <div className="terminal">
        {logs.map((l, i) => (
          <div key={i} className="terminal-line" style={{ animationDelay: `${i * 0.02}s` }}>
            <span className="t-time">{l.time}</span>
            <span className={logTypeClass[l.type] || 't-info'}>
              {prefix[l.type] || '[LOG]'} {l.msg}
            </span>
          </div>
        ))}
        <div className="terminal-line">
          <span className="t-time">&gt;</span>
          <span className="t-info">_<span className="terminal-cursor" /></span>
        </div>
      </div>
    </div>
  );
}

/** Next scheduled feeding countdown */
export function NextFeedCard({ next }) {
  if (!next) return (
    <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-tertiary)', fontSize: '.82rem' }}>
      No active schedules
    </div>
  );

  const pad = n => String(n).padStart(2, '0');
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <div className="countdown-display">{pad(next.h)}h {pad(next.m)}m</div>
      <div className="countdown-label">until next feeding</div>
      <div style={{ marginTop: 10, fontSize: '.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
        {next.label} — {next.time}
      </div>
    </div>
  );
}

/** Current bowl weight big display */
export function BowlWeightDisplay({ weight }) {
  const w = Math.max(0, weight || 0);
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <div className="bowl-weight-val">{w.toFixed(1)}<span style={{ fontSize: '1rem', fontWeight: 600, opacity: .7 }}>g</span></div>
      <div style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text-tertiary)', fontWeight: 700, marginTop: 4 }}>Current Bowl Weight</div>
      <div style={{ marginTop: 8 }}>
        <div style={{ height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (w / 200) * 100)}%`, background: 'linear-gradient(90deg,var(--sky),var(--brand))', borderRadius: 99, transition: 'width .8s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.6rem', color: 'var(--text-tertiary)', marginTop: 4, fontWeight: 600 }}>
          <span>0g</span><span>200g max</span>
        </div>
      </div>
    </div>
  );
}
