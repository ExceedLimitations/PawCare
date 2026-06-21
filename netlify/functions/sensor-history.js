"use strict";
const { json, preflight } = require("./_helpers");
const { getFirestore } = require("./_firebase");

/** GET /sensor/history */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const firestore = getFirestore();
  if (!firestore) return json(500, { error: "Database unavailable" });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);

  try {
    const snap = await firestore.collection("sensor_logs").where("timestamp", ">=", cutoff.toISOString()).get();
    const byDay = {};
    snap.forEach(doc => {
      const s = doc.data();
      const day = s.timestamp.slice(0, 10);
      if (!byDay[day]) byDay[day] = { day, food_sum: 0, count: 0 };
      byDay[day].food_sum += s.food_level;
      byDay[day].count++;
    });
    const rows = Object.values(byDay)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((r) => ({ day: r.day, avg_food: Math.round(r.food_sum / r.count) }));
    return json(200, rows);
  } catch (err) {
    console.warn("[Firebase] Error fetching sensor history:", err.message);
    return json(500, { error: "Database error" });
  }
};
