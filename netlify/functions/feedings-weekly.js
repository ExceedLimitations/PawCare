"use strict";
const { json, preflight } = require("./_helpers");
const { getFirestore } = require("./_firebase");

/** GET /feedings/weekly */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const firestore = getFirestore();
  if (!firestore) return json(500, { error: "Database unavailable" });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);

  try {
    const snap = await firestore.collection("feedings").where("timestamp", ">=", cutoff.toISOString()).get();
    const result = {};
    snap.forEach(doc => {
      const f = doc.data();
      const day = f.timestamp.slice(0, 10);
      if (!result[day]) result[day] = { day, count: 0, total_g: 0 };
      result[day].count++;
      result[day].total_g += f.portion_g;
    });
    return json(200, Object.values(result).sort((a, b) => a.day.localeCompare(b.day)));
  } catch (err) {
    console.warn("[Firebase] Error fetching weekly feedings:", err.message);
    return json(500, { error: "Database error" });
  }
};
