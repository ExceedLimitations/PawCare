"use strict";
const { json, preflight, getMockSensorLogs } = require("./_data");

/** GET /status — Returns the latest sensor reading */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const logs = getMockSensorLogs();
  const latest = logs.length
    ? logs[logs.length - 1]
    : { food_level: 72, jammed: false, last_dispensed_g: null, dispense_success: null };

  return json(200, latest);
};
