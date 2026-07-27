"use strict";

let _firestore = null;

/**
 * Initializes and returns the Firebase Firestore instance.
 * Reuses the instance across warm Lambda invocations.
 */
function getFirestore() {
  if (_firestore) return _firestore;
  try {
    const { initializeApp, getApps, cert } = require("firebase-admin/app");
    const { getFirestore: getFirestoreDb } = require("firebase-admin/firestore");
    
    if (!getApps().length) {
      let appOptions = {};
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
          appOptions.credential = cert(serviceAccount);
        } catch (e) {}
      }
      initializeApp(appOptions);
    }
    _firestore = getFirestoreDb();
    return _firestore;
  } catch (err) {
    console.warn("[Firebase] Could not initialize:", err.message);
    return null;
  }
}

module.exports = { getFirestore };
