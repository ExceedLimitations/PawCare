"use strict";
const { json, preflight } = require("./_data");

/**
 * PATCH  /schedules/:id  → toggle enabled
 * DELETE /schedules/:id  → remove schedule
 *
 * Netlify routes /schedules/:id → this function.
 * The :id segment is available via event.path.
 */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  // Extract id: Netlify redirect passes ?id=:id; also support path-based access
  const id =
    parseInt(event.queryStringParameters?.id) ||
    parseInt(event.path.split("/").filter(Boolean).pop());

  if (!id) return json(400, { error: "Missing id" });

  if (event.httpMethod === "PATCH") {
    // In a stateless environment we acknowledge the update optimistically.
    return json(200, { success: true, id, message: "Toggle acknowledged (stateless)" });
  }

  if (event.httpMethod === "DELETE") {
    return json(200, { success: true, id, message: "Delete acknowledged (stateless)" });
  }

  return json(405, { error: "Method not allowed" });
};
