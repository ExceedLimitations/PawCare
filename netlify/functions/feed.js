"use strict";
const { json, preflight, getMockFeedings } = require("./_data");

/** POST /feed — Trigger a dispense (publishes MQTT via HiveMQ public broker) */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  const portion = parseInt(body.portion) || 80;
  const type = body.type || "manual";

  // Publish via HiveMQ REST API (public broker — no auth needed for demo)
  // The ESP8266/ESP32 firmware subscribes to this topic.
  const MQTT_TOPIC_CMD =
    process.env.MQTT_TOPIC_CMD || "pawfeed/karyl/command";
  const MQTT_BROKER_REST =
    process.env.MQTT_BROKER_REST || "https://broker.hivemq.com:8884/mqtt";

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

  const record = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    portion_g: portion,
    type,
  };

  return json(200, { success: true, ...record });
};
