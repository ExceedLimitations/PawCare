"use strict";
const { json, preflight, getMockFeedings } = require("./_data");

/** GET /feedings/weekly */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);

  const result = {};
  getMockFeedings()
    .filter((f) => new Date(f.timestamp) >= cutoff)
    .forEach((f) => {
      const day = f.timestamp.slice(0, 10);
      if (!result[day]) result[day] = { day, count: 0, total_g: 0 };
      result[day].count++;
      result[day].total_g += f.portion_g;
    });

  return json(
    200,
    Object.values(result).sort((a, b) => a.day.localeCompare(b.day))
  );
};
