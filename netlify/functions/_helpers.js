"use strict";

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

module.exports = { preflight, json };
