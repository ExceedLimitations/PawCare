"use strict";
const { json, preflight, DEFAULT_SCHEDULES } = require("./_data");

/**
 * GET  /schedules     → list all schedules
 * POST /schedules     → add a schedule
 */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  if (event.httpMethod === "GET") {
    return json(200, DEFAULT_SCHEDULES);
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) {}
    const { label, time, portion_g = 80, days = "daily" } = body;
    if (!label || !time) {
      return json(400, { error: "label and time required" });
    }
    const entry = {
      id: Date.now(),
      label,
      time,
      portion_g,
      days,
      enabled: true,
    };
    // NOTE: In a stateless serverless environment this entry is not actually
    // stored. The client should maintain its own schedule list in localStorage.
    return json(200, entry);
  }

  return json(405, { error: "Method not allowed" });
};
