"use strict";
const { json, preflight, getMockSensorLogs } = require("./_data");

/** GET /sensor/history — Returns daily avg food level for the past 7 days */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);

  const byDay = {};
  getMockSensorLogs()
    .filter((s) => new Date(s.timestamp) >= cutoff)
    .forEach((s) => {
      const day = s.timestamp.slice(0, 10);
      if (!byDay[day]) byDay[day] = { day, food_sum: 0, count: 0 };
      byDay[day].food_sum += s.food_level;
      byDay[day].count++;
    });

  const rows = Object.values(byDay)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => ({ day: r.day, avg_food: Math.round(r.food_sum / r.count) }));

  return json(200, rows);
};
