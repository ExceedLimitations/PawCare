"use strict";
const { json, preflight, getMockFeedings } = require("./_data");

/** GET /feedings/today */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const today = new Date().toISOString().slice(0, 10);
  const feedings = getMockFeedings().filter((f) =>
    f.timestamp.startsWith(today)
  );

  return json(200, {
    count: feedings.length,
    total_g: feedings.reduce((s, f) => s + f.portion_g, 0),
  });
};
