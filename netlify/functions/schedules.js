"use strict";
const { json, preflight } = require("./_helpers");
const { getFirestore } = require("./_firebase");

/** REST /schedules */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const firestore = getFirestore();
  if (!firestore) return json(500, { error: "Database unavailable" });

  const pathParts = event.path.split("/").filter(Boolean);
  const id = pathParts[pathParts.length - 1] === "schedules" ? null : pathParts[pathParts.length - 1];

  if (event.httpMethod === "GET") {
    try {
      const snap = await firestore.collection("schedules").get();
      const rows = [];
      snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
      return json(200, rows);
    } catch (err) {
      console.warn("[Firebase] Error fetching schedules:", err.message);
      return json(500, { error: "Database error" });
    }
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) {}

    if (!body.label || !body.time) return json(400, { error: "label and time required" });

    const entry = {
      label: body.label,
      time: body.time,
      portion_g: body.portion_g || 80,
      days: body.days || "daily",
      enabled: true,
    };

    try {
      const docRef = await firestore.collection("schedules").add(entry);
      return json(200, { id: docRef.id, ...entry });
    } catch (err) {
      console.warn("[Firebase] Error adding schedule:", err.message);
      return json(500, { error: "Database error" });
    }
  }

  if (event.httpMethod === "PATCH" && id) {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) {}
    try {
      await firestore.collection("schedules").doc(id).update({ enabled: !!body.enabled });
      return json(200, { success: true });
    } catch (err) {
      console.warn("[Firebase] Error updating schedule:", err.message);
      return json(500, { error: "Database error" });
    }
  }

  if (event.httpMethod === "DELETE" && id) {
    try {
      await firestore.collection("schedules").doc(id).delete();
      return json(200, { success: true });
    } catch (err) {
      console.warn("[Firebase] Error deleting schedule:", err.message);
      return json(500, { error: "Database error" });
    }
  }

  return json(405, { error: "Method not allowed" });
};
