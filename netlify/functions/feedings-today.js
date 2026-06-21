"use strict";
const { json, preflight } = require("./_helpers");
const { getFirestore } = require("./_firebase");

/** GET /feedings/today */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const firestore = getFirestore();
  if (!firestore) return json(500, { error: "Database unavailable" });

  const today = new Date().toISOString().slice(0, 10);

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
