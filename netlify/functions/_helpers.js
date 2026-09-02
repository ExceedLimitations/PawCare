"use strict";

const jwt = require("jsonwebtoken");

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const preflight = () => ({
  statusCode: 204,
  headers: {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  },
});

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
  body: JSON.stringify(body),
});

/**
 * Verifies the same Bearer JWT that server.js's `authenticate` middleware requires.
 * Returns { user } on success or { error: <response> } to return directly from the handler.
 */
const requireAuth = (event) => {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    return { error: json(500, { error: "Server misconfigured: JWT_SECRET not set" }) };
  }
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return { error: json(401, { error: "Authentication required" }) };
  try {
    return { user: jwt.verify(token, JWT_SECRET) };
  } catch {
    return { error: json(401, { error: "Invalid or expired token" }) };
  }
};

module.exports = { preflight, json, requireAuth };
