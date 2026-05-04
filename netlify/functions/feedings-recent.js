"use strict";
const { json, preflight, getMockFeedings } = require("./_data");

/** GET /feedings/recent */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const recent = [...getMockFeedings()].reverse().slice(0, 50);
  return json(200, recent);
};
