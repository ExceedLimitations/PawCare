"use strict";
const { json, preflight, requireAuth } = require("./_helpers");
const { getFirestore } = require("./_firebase");

/**
 * PATCH  /schedules/:id  → update schedule fields
 * DELETE /schedules/:id  → remove schedule
 */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const auth = requireAuth(event);
  if (auth.error) return auth.error;

  // Netlify passes the :id segment as a query param via redirect rules
  const id = event.queryStringParameters?.id ||
    event.path.split("/").filter(Boolean).pop();

  if (!id || id === "schedules") return json(400, { error: "Missing id" });

  const firestore = getFirestore();
  if (!firestore) return json(500, { error: "Database unavailable" });

  if (event.httpMethod === "PATCH") {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) {}
    const update = {};
    if (body.enabled   !== undefined) update.enabled   = !!body.enabled;
    if (body.days      !== undefined) update.days      = String(body.days);
    if (body.time      !== undefined) update.time      = String(body.time);
    if (body.portion_g !== undefined) update.portion_g = Math.min(500, Math.max(1, Number(body.portion_g)));
    if (body.label     !== undefined) update.label     = String(body.label);
    if (Object.keys(update).length === 0) return json(400, { error: "No valid fields to update" });
    try {
      await firestore.collection("schedules").doc(id).update(update);
      return json(200, { success: true });
    } catch (err) {
      console.warn("[Firebase] Error updating schedule:", err.message);
      return json(500, { error: "Database error" });
    }
  }

  if (event.httpMethod === "DELETE") {
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
