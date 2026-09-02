"use strict";
const { getFirestore } = require("./_firebase");
const { json, preflight, requireAuth } = require("./_helpers");

/** POST /feed — Trigger a dispense (publishes MQTT via HiveMQ public broker) */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAuth(event);
  if (auth.error) return auth.error;

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  const portion = Math.min(500, Math.max(1, parseInt(body.portion) || 80));
  const type = body.type || "manual";

  const MQTT_TOPIC_CMD = process.env.MQTT_TOPIC_CMD || "pawfeed/device01/command";

  // Best-effort MQTT publish via HTTPS — silently ignore failures
  try {
    await fetch("https://broker.hivemq.com/api/v1/mqtt/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: MQTT_TOPIC_CMD,
        payload: Buffer.from(
          JSON.stringify({ action: "feed", portion_g: portion })
        ).toString("base64"),
        qos: 1,
        retain: false,
      }),
    });
  } catch (_) {
    // Silently swallow — the device may still receive the command via its
    // own direct broker connection when online.
  }

  const id = Date.now().toString();
  const record = {
    id,
    timestamp: new Date().toISOString(),
    portion_g: portion,
    type,
  };

  const firestore = getFirestore();
  if (firestore) {
    try {
      await firestore.collection("feedings").doc(id).set(record);
    } catch (err) {
      console.warn("[Firebase] Error saving feed from Netlify:", err.message);
    }
  }

  return json(200, { success: true, ...record });
};
