"use strict";
const { json, preflight } = require("./_helpers");
const { getFirestore } = require("./_firebase");

/** GET /status — Most recent sensor log */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const firestore = getFirestore();
  if (!firestore) return json(500, { error: "Database unavailable" });

  try {
    const snap = await firestore.collection("sensor_logs").orderBy("timestamp", "desc").limit(1).get();
    if (!snap.empty) {
      return json(200, snap.docs[0].data());
    }
    return json(200, { food_level: 0, jammed: false, last_dispensed_g: 0, dispense_success: null });
  } catch (err) {
    console.warn("[Firebase] Error fetching status:", err.message);
    return json(500, { error: "Database error" });
  }
};
