"use strict";
const { json, preflight } = require("./_helpers");
const { getFirestore } = require("./_firebase");

/** GET /feedings/today */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const firestore = getFirestore();
  if (!firestore) return json(500, { error: "Database unavailable" });

  // Compute UTC midnight for the configured timezone so "today" is correct
  // regardless of where the Netlify Lambda happens to run.
  const LOCAL_TZ = process.env.TZ || "Asia/Manila";
  const now = new Date();
  const offsetMs = new Date(now.toLocaleString("en-US", { timeZone: LOCAL_TZ })).getTime()
                 - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const localNow = new Date(now.getTime() + offsetMs);
  localNow.setUTCHours(0, 0, 0, 0);
  const today = new Date(localNow.getTime() - offsetMs).toISOString();

  try {
    const snap = await firestore.collection("feedings").where("timestamp", ">=", today).get();
    let count = 0;
    let total_g = 0;
    snap.forEach(doc => { count++; total_g += doc.data().portion_g; });
    return json(200, { count, total_g });
  } catch (err) {
    console.warn("[Firebase] Error fetching today feedings:", err.message);
    return json(500, { error: "Database error" });
  }
};
