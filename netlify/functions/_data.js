/**
 * _data.js — Shared seed/default data for PawFeed Netlify Functions.
 *
 * NOTE: Netlify Functions are stateless — each invocation is a fresh
 * Lambda. Writes here do NOT persist between calls. This file provides
 * realistic default data so the dashboard always has something to show.
 *
 * For real persistence, connect to an external database such as
 * FaunaDB, Supabase, or PlanetScale and replace these helpers.
 */

"use strict";

/** CORS headers applied to every function response */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

/** Build a JSON response */
function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

/** Return an OPTIONS preflight response */
function preflight() {
  return { statusCode: 204, headers: CORS, body: "" };
}

// ── Default seed data ─────────────────────────────────────────────

const DEFAULT_SCHEDULES = [
  { id: 1, label: "Morning",    time: "07:00", portion_g: 80, days: "daily",    enabled: true  },
  { id: 2, label: "Afternoon",  time: "12:30", portion_g: 80, days: "daily",    enabled: true  },
  { id: 3, label: "Evening",    time: "18:00", portion_g: 80, days: "daily",    enabled: true  },
  { id: 4, label: "Late snack", time: "22:00", portion_g: 40, days: "weekends", enabled: false },
];

/** Generate mock feeding history for the past 7 days */
function getMockFeedings() {
  const feedings = [];
  let id = 1;
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const count = 3 + (Math.random() > 0.5 ? 1 : 0);
    for (let j = 0; j < count; j++) {
      const types = ["scheduled", "scheduled", "scheduled", "manual"];
      d.setHours(7 + j * 4, 0, 0, 0);
      feedings.push({
        id: id++,
        timestamp: d.toISOString(),
        portion_g: 80,
        type: types[j] || "manual",
      });
    }
  }
  return feedings;
}

/** Generate mock sensor log for the past 7 days */
function getMockSensorLogs() {
  const logs = [];
  let id = 1;
  const now = new Date();
  let level = 95;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(12, 0, 0, 0);
    level = Math.max(10, level - Math.floor(Math.random() * 8 + 5));
    logs.push({
      id: id++,
      timestamp: d.toISOString(),
      food_level: level,
      jammed: false,
      last_dispensed_g: 80,
      dispense_success: true,
    });
  }
  return logs;
}

module.exports = { CORS, json, preflight, DEFAULT_SCHEDULES, getMockFeedings, getMockSensorLogs };
