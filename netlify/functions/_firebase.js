"use strict";

let _firestore = null;

/**
 * Initializes and returns the Firebase Firestore instance.
 * Reuses the instance across warm Lambda invocations.
 */
function getFirestore() {
  if (_firestore) return _firestore;
  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    _firestore = admin.firestore();
    return _firestore;
  } catch (err) {
    console.warn("[Firebase] Could not initialize:", err.message);
    return null;
  }
}

module.exports = { getFirestore };
