"use strict";
const { json, preflight } = require("./_helpers");
const { getFirestore } = require("./_firebase");

const DEFAULT_PROFILE = { name: "Bantay", breed: "Golden Retriever" };

/**
 * GET  /profile  → return saved profile (Firestore)
 * POST /profile  → save { name, breed, avatar } to Firestore
 */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();

  const firestore = getFirestore();
  if (!firestore) return json(500, { error: "Database unavailable" });

  if (event.httpMethod === "GET") {
    try {
      const doc = await firestore.collection("config").doc("profile").get();
      if (doc.exists) return json(200, doc.data());
      return json(200, DEFAULT_PROFILE);
    } catch (err) {
      console.warn("[Firebase] Error fetching profile:", err.message);
      return json(500, { error: "Database error" });
    }
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) {}
    const profile = {
      name: (body.name || "").trim() || "Bantay",
      breed: (body.breed || "").trim() || "Golden Retriever",
      avatar: body.avatar || null,
    };
    try {
      await firestore.collection("config").doc("profile").set(profile);
      return json(200, profile);
    } catch (err) {
      console.warn("[Firebase] Error saving profile:", err.message);
      return json(500, { error: "Database error" });
    }
  }

  return json(405, { error: "Method not allowed" });
};
