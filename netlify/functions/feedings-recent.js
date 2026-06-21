"use strict";
const { json, preflight } = require("./_helpers");
const { getFirestore } = require("./_firebase");

/** GET /feedings/recent */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const firestore = getFirestore();
  if (!firestore) {
    return json(500, { error: "Database unavailable" });
  }

  try {
    const snap = await firestore.collection("feedings").orderBy("timestamp", "desc").limit(50).get();
    const rows = [];
    snap.forEach(doc => rows.push(doc.data()));
    return json(200, rows);
  } catch (err) {
    console.warn("[Firebase] Error fetching recent feedings:", err.message);
    return json(500, { error: "Database error" });
  }
};
