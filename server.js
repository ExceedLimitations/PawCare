"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const mqtt = require("mqtt");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

let firestoreDb = null;
try {
  let appOptions = {};
  
  // Allow passing the service account JSON string directly via an environment variable, 
  // which is useful on PaaS like Render where uploading files can be tricky.
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      appOptions.credential = cert(serviceAccount);
    } catch (parseErr) {
      console.error("[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable:", parseErr.message);
    }
  }

  initializeApp(appOptions);
  firestoreDb = getFirestore();
  console.log("[Firebase] SDK initialized — testing live Firestore connection...");
  // Async connectivity probe — runs after server starts
  (async () => {
    try {
      await firestoreDb.collection("_ping").doc("test").set({ ts: Date.now() });
      await firestoreDb.collection("_ping").doc("test").delete();
      console.log("[Firebase] ✅ Firestore is LIVE — using Firebase as database.");
    } catch (err) {
      console.error("[Firebase] ❌ Firestore connection FAILED:", err.message);
      console.error("[Firebase] → Fix: Go to https://console.firebase.google.com/project/pawcare-12402/firestore and create the database.");
      process.exit(1); // Crash the server if Firebase isn't connected
    }
  })();
} catch (err) {
  console.error("[Firebase] Could not initialize Firebase Admin. Check your GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT env var.", err.message);
  process.exit(1);
}

/* ──────────────────────────── Config ─────────────────────────── */
const PORT     = process.env.PORT || 3000;
const LOCAL_TZ = process.env.TZ   || "Asia/Manila"; // All local-time calculations use this
const MQTT_BROKER    = process.env.MQTT_BROKER          || "mqtt://broker.hivemq.com:1883";
const TOPIC_STATUS   = process.env.MQTT_TOPIC_STATUS    || "pawfeed/device01/status";
const TOPIC_SENSOR   = process.env.MQTT_TOPIC_SENSOR    || "pawfeed/device01/sensor";
const TOPIC_CMD      = process.env.MQTT_TOPIC_CMD       || "pawfeed/device01/command";
const TOPIC_ALERTS   = process.env.MQTT_TOPIC_ALERTS    || "pawfeed/device01/alerts";
const TOPIC_FEED_LOG = process.env.MQTT_TOPIC_FEED_LOG  || "pawfeed/device01/feed_log";
const TOPIC_OTA_STATUS = process.env.MQTT_TOPIC_OTA_STATUS || "pawfeed/device01/ota_status";

/* ─────────────────────────── Express ────────────────────────── */
const app = express();
const server = http.createServer(app);

app.use("/profile", express.json({ limit: "10mb" }));
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "frontend/dist"))); // serves React production build

const rateLimit = require("express-rate-limit");
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { success: false, error: "Too many login attempts, please try again after a minute" } });
const feedLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { success: false, error: "Too many feed requests" } });

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ── OTA Firmware endpoints (public — ESP32 cannot send auth headers) ── */
// Place firmware.bin and version.json in the /firmware directory at the
// project root.  Bump the version string in version.json to trigger an
// OTA update on all connected devices within their next check interval.
const FIRMWARE_DIR = path.join(__dirname, "firmware");

// GET /firmware/version.json
// Returns: { "version": "1.0.1", "url": "https://pawcare-rcd9.onrender.com/firmware/firmware.bin" }
app.get("/firmware/version.json", (_req, res) => {
  const versionFile = path.join(FIRMWARE_DIR, "version.json");
  if (!fs.existsSync(versionFile)) {
    return res.status(404).json({ error: "No firmware manifest found" });
  }
  res.setHeader("Content-Type", "application/json");
  res.sendFile(versionFile);
});

// GET /firmware/firmware.bin
// Streams the compiled firmware binary to the ESP32 during OTA flash.
app.get("/firmware/firmware.bin", (_req, res) => {
  const binFile = path.join(FIRMWARE_DIR, "firmware.bin");
  if (!fs.existsSync(binFile)) {
    return res.status(404).send("No firmware binary found");
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=firmware.bin");
  res.sendFile(binFile);
});

// POST /firmware/update  (authenticated)
// Sends an MQTT command to the device to check for and apply a new firmware update.
app.post("/firmware/update", authenticate, (_req, res) => {
  mqttClient.publish(
    TOPIC_CMD,
    JSON.stringify({ action: "ota_update" }),
    { qos: 1 },
    (err) => {
      if (err) {
        console.error("[OTA] Failed to publish ota_update command:", err.message);
        return res.status(500).json({ success: false, error: "Failed to send command" });
      }
      console.log("[OTA] Update command sent to device.");
      res.json({ success: true, message: "OTA update command sent to device" });
    }
  );
});


const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const JWT_SECRET = process.env.JWT_SECRET;

if (!ADMIN_USER || !ADMIN_PASS || !JWT_SECRET) {
  console.error(
    "[Auth] FATAL: ADMIN_USER, ADMIN_PASS, and JWT_SECRET must be set in .env. " +
    "Refusing to start with insecure defaults."
  );
  process.exit(1);
}

/* ── JWT middleware ───────────────────────────────────────── */
function authenticate(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ── Login (public) ───────────────────────────────────────── */
app.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: "8h" });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: "Invalid credentials" });
  }
});

/* ── REST: Profile ─────────────────────────────────────────── */
app.get("/profile", authenticate, async (_req, res) => {
  try {
    const doc = await firestoreDb.collection("config").doc("profile").get();
    if (doc.exists) return res.json(doc.data());
    return res.json({ name: "Bantay", breed: "Golden Retriever" });
  } catch (err) {
    console.error("[Firebase] Error fetching profile:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/profile", authenticate, async (req, res) => {
  const { name, breed, avatar, birthday, age } = req.body;
  const profile = {
    name:     (name  || "").trim() || "Unnamed Pet",
    breed:    (breed || "").trim() || "",
    avatar:   avatar   || null,
    birthday: birthday || null,
    age:      age != null && age !== '' ? Number(age) : null,
  };
  try {
    await firestoreDb.collection("config").doc("profile").set(profile);
    return res.json(profile);
  } catch (err) {
    console.error("[Firebase] Error saving profile:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

/* ── REST: Feeding ─────────────────────────────────────────── */
app.post("/feed", authenticate, feedLimiter, async (req, res) => {
  // Clamp portion to [1, 500] g as defence-in-depth behind the frontend validation (Fix #8).
  const portion = Math.min(500, Math.max(1, parseInt(req.body.portion) || 45));
  const type = req.body.type || "manual";

  // FIX #2: Build the record before publishing so we have an id to return,
  // but only write to Firestore (and emit to clients) inside the publish callback.
  // This ensures phantom feed records are never created if the MQTT broker is down.
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    portion_g: portion,
    type,
  };

  if (!mqttClient.connected) {
    return res.status(503).json({ success: false, error: "MQTT broker not connected" });
  }

  mqttClient.publish(
    TOPIC_CMD,
    JSON.stringify({ action: "feed", portion_g: portion }),
    { qos: 1 },
    async (err) => {
      if (err) {
        console.error("[Feed] MQTT publish failed:", err.message);
        return res.status(502).json({ success: false, error: "MQTT publish failed" });
      }
      try {
        await firestoreDb.collection("feedings").doc(record.id).set(record);
        io.emit("feeding_done", record);
        console.log(`[Feed] ${portion}g (${type}) — logged to Firestore`);
      } catch (dbErr) {
        console.error("[Firebase] Error saving feed:", dbErr.message);
      }
      return res.json({ success: true, ...record });
    }
  );
});

const getLocalCutoffISO = (daysBack = 0) => {
  // Compute UTC offset for LOCAL_TZ dynamically so this works for any timezone,
  // not just Asia/Manila. toLocaleString is used because Date.getTimezoneOffset()
  // always returns the server *system* offset, not the configured LOCAL_TZ offset.
  const now = new Date();
  const offsetMs = new Date(now.toLocaleString("en-US", { timeZone: LOCAL_TZ })).getTime()
                 - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const localTime = new Date(now.getTime() + offsetMs);
  localTime.setUTCDate(localTime.getUTCDate() - daysBack);
  localTime.setUTCHours(0, 0, 0, 0);
  return new Date(localTime.getTime() - offsetMs).toISOString();
};

const getLocalISO = (isoString) => {
  return new Date(isoString).toLocaleString("sv-SE", { timeZone: LOCAL_TZ }).replace(' ', 'T');
};

app.get("/feedings/today", authenticate, async (_req, res) => {
  const todayCutoff = getLocalCutoffISO(0);
  try {
    const snap = await firestoreDb.collection("feedings").where("timestamp", ">=", todayCutoff).get();
    let count = 0;
    let total_g = 0;
    snap.forEach(doc => { count++; total_g += doc.data().portion_g; });
    return res.json({ count, total_g });
  } catch (err) {
    console.error("[Firebase] Error fetching today feedings:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

async function aggregateFeedings(res, daysBack, keyFn, sortFn) {
  const cutoffIso = getLocalCutoffISO(daysBack);

  try {
    const snap = await firestoreDb.collection("feedings").where("timestamp", ">=", cutoffIso).get();
    const result = {};
    snap.forEach(doc => {
      const f = doc.data();
      const key = keyFn(f);
      if (!result[key]) result[key] = { key, count: 0, total_g: 0 };
      result[key].count++;
      result[key].total_g += f.portion_g;
    });
    return Object.values(result).sort(sortFn);
  } catch (err) {
    console.error("[Firebase] Error fetching aggregated feedings:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Database error" });
    return null;
  }
}

/**
 * Pad a sorted array of { day, count, total_g } with zero entries for any
 * missing dates between daysBack days ago and today (inclusive), using LOCAL_TZ
 * so the date labels match what the user sees in the dashboard.
 */
function padDays(data, daysBack) {
  const MANILA_OFFSET_MS = new Date(
    new Date().toLocaleString('en-US', { timeZone: LOCAL_TZ })
  ).getTime() - new Date(new Date().toLocaleString('en-US', { timeZone: 'UTC' })).getTime();

  const todayLocal = new Date(Date.now() + MANILA_OFFSET_MS);
  const result = [];

  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(todayLocal);
    // Use UTC getters/setters, not local ones — todayLocal already has LOCAL_TZ's
    // offset baked into its epoch value. Reading it back with local Date methods
    // would additionally apply the process's own TZ offset (when process.env.TZ
    // is set, e.g. to match LOCAL_TZ), double-shifting the date. getLocalCutoffISO
    // above uses the same UTC-getter approach for this reason.
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const found = data.find(r => r.day === iso);
    result.push(found || { day: iso, count: 0, total_g: 0 });
  }
  return result;
}

app.get("/feedings/weekly", authenticate, async (_req, res) => {
  const keyFn = (f) => getLocalISO(f.timestamp).slice(0, 10);
  const sortFn = (a, b) => a.key.localeCompare(b.key);
  const data = await aggregateFeedings(res, 6, keyFn, sortFn);
  if (data) {
    const renamed = data.map(d => ({ day: d.key, count: d.count, total_g: d.total_g }));
    // Pad so every day in the last 7 days appears, even days with no feedings.
    return res.json(padDays(renamed, 6));
  }
});

app.get("/feedings/monthly", authenticate, async (_req, res) => {
  const keyFn = (f) => getLocalISO(f.timestamp).slice(0, 10);
  const sortFn = (a, b) => a.key.localeCompare(b.key);
  const data = await aggregateFeedings(res, 29, keyFn, sortFn);
  if (data) {
    const renamed = data.map(d => ({ day: d.key, count: d.count, total_g: d.total_g }));
    // Pad so every day in the last 30 days appears, even days with no feedings.
    return res.json(padDays(renamed, 29));
  }
});

app.get("/feedings/daily", authenticate, async (_req, res) => {
  const keyFn = (f) => getLocalISO(f.timestamp).slice(11, 13);
  const sortFn = (a, b) => a.key.localeCompare(b.key);
  const data = await aggregateFeedings(res, 0, keyFn, sortFn);
  if (data) {
    const renamed = data.map(d => ({ hour: d.key, count: d.count, total_g: d.total_g }));
    return res.json(renamed);
  }
});


app.get("/feedings/recent", authenticate, async (_req, res) => {
  try {
    const snap = await firestoreDb.collection("feedings").orderBy("timestamp", "desc").limit(50).get();
    const rows = [];
    snap.forEach(doc => rows.push(doc.data()));
    return res.json(rows);
  } catch (err) {
    console.error("[Firebase] Error fetching recent feedings:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

/* ── REST: Sensor ──────────────────────────────────────────── */
app.get("/status", authenticate, async (_req, res) => {
  try {
    const doc = await firestoreDb.collection("sensor_logs").doc("latest").get();
    if (doc.exists) {
      return res.json(doc.data());
    }
    const snap = await firestoreDb.collection("sensor_logs").orderBy("timestamp", "desc").limit(1).get();
    if (!snap.empty) {
      return res.json(snap.docs[0].data());
    }
    return res.json({ food_level: 0, jammed: false, last_dispensed_g: 0, dispense_success: null, bowl_weight: 0 });
  } catch (err) {
    console.error("[Firebase] Error fetching status:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/sensor/history", authenticate, async (_req, res) => {
  // Use getLocalCutoffISO so "midnight" is midnight in LOCAL_TZ, not the server system TZ.
  const cutoffIso = getLocalCutoffISO(6);

  try {
    const snap = await firestoreDb.collection("sensor_logs").where("timestamp", ">=", cutoffIso).get();
    const byDay = {};
    snap.forEach(doc => {
      const s = doc.data();
      const day = getLocalISO(s.timestamp).slice(0, 10); // group by local date, not UTC date
      if (!byDay[day]) byDay[day] = { day, food_sum: 0, count: 0 };
      byDay[day].food_sum += s.food_level;
      byDay[day].count++;
    });
    const rows = Object.values(byDay)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((r) => ({
        day: r.day,
        avg_food: Math.round(r.food_sum / r.count),
      }));
    return res.json(rows);
  } catch (err) {
    console.error("[Firebase] Error fetching sensor history:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

/* ── REST: Schedules ───────────────────────────────────────── */
let schedulesCache = null;

async function getSchedules() {
  if (schedulesCache) return schedulesCache;
  const snap = await firestoreDb.collection("schedules").get();
  const rows = [];
  snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
  schedulesCache = rows;
  return rows;
}

function invalidateSchedules() {
  schedulesCache = null;
}

app.get("/schedules", authenticate, async (_req, res) => {
  try {
    const rows = await getSchedules();
    return res.json(rows);
  } catch (err) {
    console.error("[Firebase] Error fetching schedules:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/schedules", authenticate, async (req, res) => {
  const { label, time, days = "daily" } = req.body;
  // Clamp portion_g to [1, 500] g — defence-in-depth (Fix #8).
  const portion_g = Math.min(500, Math.max(1, parseInt(req.body.portion_g) || 45));
  if (!label || !time)
    return res.status(400).json({ error: "label and time required" });
  const entry = { label, time, portion_g, days, enabled: true };
  try {
    const docRef = await firestoreDb.collection("schedules").add(entry);
    invalidateSchedules();
    return res.json({ id: docRef.id, ...entry });
  } catch (err) {
    console.error("[Firebase] Error adding schedule:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.patch("/schedules/:id", authenticate, async (req, res) => {
  const { enabled, days, time, portion_g, label } = req.body;
  const update = {};
  if (enabled   !== undefined) update.enabled   = !!enabled;
  if (days      !== undefined) update.days      = String(days);
  if (time      !== undefined) update.time      = String(time);
  if (portion_g !== undefined) update.portion_g = Number(portion_g);
  if (label     !== undefined) update.label     = String(label);
  if (Object.keys(update).length === 0)
    return res.status(400).json({ error: "No valid fields to update" });
  try {
    await firestoreDb.collection("schedules").doc(req.params.id).update(update);
    invalidateSchedules();
    return res.json({ success: true });
  } catch (err) {
    console.error("[Firebase] Error updating schedule:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.delete("/schedules/:id", authenticate, async (req, res) => {
  try {
    await firestoreDb.collection("schedules").doc(req.params.id).delete();
    invalidateSchedules();
    return res.json({ success: true });
  } catch (err) {
    console.error("[Firebase] Error deleting schedule:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

/* ── REST: Notifications ────────────────────────────────────── */

// GET /notifications — fetch all saved notifications (newest first)
app.get("/notifications", authenticate, async (_req, res) => {
  try {
    const snap = await firestoreDb.collection("notifications").orderBy("timestamp", "desc").limit(100).get();
    const rows = [];
    snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
    return res.json(rows);
  } catch (err) {
    console.error("[Firebase] Error fetching notifications:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

// POST /notifications — save a new notification
app.post("/notifications", authenticate, async (req, res) => {
  const { id, type, title, message, time } = req.body;
  if (!title || !message) return res.status(400).json({ error: "title and message required" });
  const record = {
    id:        id || crypto.randomUUID(),
    type:      type || "info",
    title:     title.trim(),
    message:   message.trim(),
    time:      time || new Date().toLocaleTimeString([], { hour12: false }),
    timestamp: new Date().toISOString(),
  };
  try {
    await firestoreDb.collection("notifications").doc(record.id).set(record);
    return res.json(record);
  } catch (err) {
    console.error("[Firebase] Error saving notification:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

// DELETE /notifications — clear ALL notifications
app.delete("/notifications", authenticate, async (_req, res) => {
  try {
    const snap = await firestoreDb.collection("notifications").get();
    const batch = firestoreDb.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`[Notifications] Cleared ${snap.size} notifications.`);
    return res.json({ success: true, deleted: snap.size });
  } catch (err) {
    console.error("[Firebase] Error clearing notifications:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

// DELETE /notifications/:id — dismiss a single notification
app.delete("/notifications/:id", authenticate, async (req, res) => {
  try {
    await firestoreDb.collection("notifications").doc(req.params.id).delete();
    return res.json({ success: true });
  } catch (err) {
    console.error("[Firebase] Error deleting notification:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

/* ─────────────────────────── Socket.io ──────────────────────── */
const io = new Server(server, { cors: { origin: "*" } });

// Authenticate Socket.io connections with the same JWT used by the REST API.
// This prevents any third-party page from opening a socket and triggering dispenses.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

// Per-socket feed rate limit — mirrors the REST feedLimiter (30 req / 60 s).
// Prevents authenticated sockets from bypassing the HTTP-layer rate limiter.
const socketFeedCounts = new Map(); // socket.id → { count, resetAt }

io.on("connection", async (socket) => {
  console.log(`[Socket.io] Client connected — ${socket.id}`);
  socketFeedCounts.set(socket.id, { count: 0, resetAt: Date.now() + 60000 });

  socket.on("feed", async (data) => {
    // Rate limit: max 30 feed events per 60 s per socket
    const now = Date.now();
    const limit = socketFeedCounts.get(socket.id) || { count: 0, resetAt: now + 60000 };
    if (now > limit.resetAt) { limit.count = 0; limit.resetAt = now + 60000; }
    limit.count++;
    socketFeedCounts.set(socket.id, limit);
    if (limit.count > 30) {
      socket.emit("error", { message: "Too many feed requests. Try again in a minute." });
      return;
    }

    const portion = Math.min(500, Math.max(1, parseInt(data?.portion) || 45));
    const type = data?.type || "manual";

    if (!mqttClient.connected) {
      socket.emit("error", { message: "MQTT broker not connected. Cannot dispense." });
      return;
    }

    mqttClient.publish(
      TOPIC_CMD,
      JSON.stringify({ action: "feed", portion_g: portion }),
      { qos: 1 },
    );
    const record = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      portion_g: portion,
      type,
    };
    try {
      await firestoreDb.collection("feedings").doc(record.id).set(record);
      io.emit("feeding_done", record);
      console.log(`[Feed] ${portion}g (${type})`);
    } catch (err) {
      console.error("[Firebase] Error saving socket feed:", err.message);
    }
  });
  socket.on("tare", () => {
    mqttClient.publish(
      TOPIC_CMD,
      JSON.stringify({ action: "tare" }),
      { qos: 1 },
    );
    io.emit("tare_ack", { timestamp: new Date().toISOString() });
    console.log("[Tare] Scale tare command sent to device via MQTT.");
  });

  socket.on("disconnect", () => {
    socketFeedCounts.delete(socket.id); // clean up rate-limit entry
    console.log(`[Socket.io] Disconnected — ${socket.id}`);
  });
});

/* ─────────────────────────── MQTT ───────────────────────────── */
const mqttClient = mqtt.connect(MQTT_BROKER, {
  reconnectPeriod: 5000,
  connectTimeout: 10000,
  clientId: `pawfeed-server-${Date.now()}`,
});

mqttClient.on("connect", () => {
  console.log(`[MQTT] Connected → ${MQTT_BROKER}`);
  console.log(`[MQTT] Topics: status=${TOPIC_STATUS} | sensor=${TOPIC_SENSOR} | cmd=${TOPIC_CMD} | alerts=${TOPIC_ALERTS}`);
  mqttClient.subscribe([TOPIC_STATUS, TOPIC_SENSOR, TOPIC_ALERTS, TOPIC_FEED_LOG, TOPIC_OTA_STATUS], { qos: 1 });
  io.emit("mqtt_status", { connected: true });
});
mqttClient.on("reconnect", () => io.emit("mqtt_status", { connected: false }));
mqttClient.on("error", (err) => {
  if (err.code !== "ECONNREFUSED") console.error("[MQTT] Error:", err.message);
});

let lastSensorEntry = null;
let lastSensorArchiveTime = 0;
let lastSeenDevice = 0;

// Heartbeat: every 10 s, broadcast device online/offline state to all dashboard clients.
// This ensures clients that just connected (or reconnected) get the current state
// without waiting for the next MQTT message from the device.
setInterval(() => {
  const isDeviceOnline = lastSeenDevice > 0 && (Date.now() - lastSeenDevice < 25000);
  if (!isDeviceOnline && lastSeenDevice > 0) {
    // Device was seen before but has gone quiet — notify clients it's offline
    io.emit("status", { online: false });
    lastSeenDevice = 0; // prevent repeated offline emits
  }
}, 10000);

mqttClient.on("message", async (topic, payload) => {
  console.log(`[MQTT] ← ${topic}: ${payload.toString()}`);
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return console.warn("[MQTT] Bad JSON on", topic);
  }

  if (topic === TOPIC_OTA_STATUS) {
    console.log(`[OTA] Device status: ${JSON.stringify(data)}`);
    io.emit("ota_status", data);
    return;
  }

  if (topic === TOPIC_ALERTS) {
    console.log(`[MQTT] Alert from device: ${data.alert_message}`);
    io.emit("alert", { level: "error", message: data.alert_message || "Device alert" });
    return;
  }

  if (topic === TOPIC_FEED_LOG) {
    // Only record physical button-press feeds here. Dashboard/MQTT-triggered feeds are
    // already logged by the REST /feed or socket feed handler at command time,
    // so processing them here too would create duplicate Firestore records.
    if (data.type !== "physical") return;
    const record = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      portion_g: data.portion_g || 100,
      type: "physical",
    };
    try {
      await firestoreDb.collection("feedings").doc(record.id).set(record);
      io.emit("feeding_done", record);
      console.log(`[Feed] ${record.portion_g}g (physical button)`);
    } catch (err) {
      console.error("[Firebase] Error saving physical feed:", err.message);
    }
    return;
  }

  if (topic === TOPIC_STATUS || topic === TOPIC_SENSOR) {
    if (data.online === false) {
      lastSeenDevice = 0;
      io.emit("status", { online: false });
      return;
    }
    lastSeenDevice = Date.now();
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      food_level: data.food_level ?? 0,
      jammed: !!data.jammed,
      last_dispensed_g: data.last_dispensed_g ?? null,
      dispense_success: data.dispense_success ?? null,
      bowl_weight: data.bowl_weight ?? null,
      ...(data.fw_version ? { fw_version: data.fw_version } : {}),
    };
    
    try {
      // Always update 'latest' document
      await firestoreDb.collection("sensor_logs").doc("latest").set(entry);
      
      // Archive to historical collection only if state changed significantly or 15 mins passed
      const now = Date.now();
      const needsArchive = !lastSensorEntry || 
                           entry.jammed !== lastSensorEntry.jammed ||
                           Math.abs(entry.food_level - lastSensorEntry.food_level) > 5 ||
                           now - lastSensorArchiveTime > 15 * 60 * 1000;
                           
      if (needsArchive) {
        await firestoreDb.collection("sensor_logs").doc(entry.id).set(entry);
        lastSensorArchiveTime = now;
        lastSensorEntry = entry;
      }
    } catch (err) {
      console.error("[Firebase] Error saving sensor log:", err.message);
    }

    io.emit("status", entry);
  }
});

/* ─────────────────────────── Schedule runner ────────────────── */
const firedThisMinute = new Set();
let lastFiredMinute = "";

setInterval(async () => {
  const now = new Date();
  
  // Compute current time using Intl.DateTimeFormat
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LOCAL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  // FIX #3: Intl.DateTimeFormat can return "24:00" for midnight on some platforms.
  // Normalise to "00:00" so schedules set at midnight always fire.
  const hhmm = formatter.format(now).replace(/^24:/, "00:");
  
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LOCAL_TZ,
    weekday: 'short'
  });
  const weekdayStr = dayFormatter.format(now);
  const isWeekend = weekdayStr === 'Sat' || weekdayStr === 'Sun';

  if (hhmm !== lastFiredMinute) {
    firedThisMinute.clear();
    lastFiredMinute = hhmm;
  }

  let schedules = [];
  try {
    const rows = await getSchedules();
    for (const doc of rows) {
      if (doc.enabled && doc.time === hhmm && !firedThisMinute.has(doc.id)) {
        schedules.push(doc);
      }
    }
  } catch (err) {
    console.error("[Firebase] Error running schedules:", err.message);
  }

  for (const s of schedules) {
    if (s.days === "weekdays" && isWeekend) continue;
    if (s.days === "weekends" && !isWeekend) continue;

    // Use the same 25 s freshness window as the heartbeat emitter so a feed
    // is never skipped due to normal MQTT relay latency.
    const isDeviceOnline = lastSeenDevice > 0 && (Date.now() - lastSeenDevice < 25000);
    if (!isDeviceOnline) {
      console.log(`[Schedule] "${s.label}" skipped at ${hhmm} — device is offline.`);
      continue;
    }

    // Only mark as fired after we confirm the device is online.
    // Moving this below the online-check means the schedule can still fire
    // in the same minute window if the device reconnects before the next tick.
    firedThisMinute.add(s.id);

    const record = {
      id: crypto.randomUUID(),
      timestamp: now.toISOString(),
      portion_g: s.portion_g,
      type: "scheduled",
      label: s.label,
    };

    // Only write to Firestore and notify clients after the MQTT command is
    // confirmed delivered. If the broker is down, we skip the record entirely
    // rather than creating a ghost feeding with no actual food dispensed.
    mqttClient.publish(
      TOPIC_CMD,
      JSON.stringify({ action: "feed", portion_g: s.portion_g }),
      { qos: 1 },
      async (err) => {
        if (err) {
          console.error(`[Schedule] "${s.label}" MQTT publish failed:`, err.message);
          // Un-mark so it can retry on the next 30 s tick within the same minute.
          firedThisMinute.delete(s.id);
          return;
        }
        try {
          await firestoreDb.collection("feedings").doc(record.id).set(record);
          io.emit("feeding_done", record);
          console.log(`[Schedule] "${s.label}" fired at ${hhmm} (${LOCAL_TZ}) — ${s.portion_g}g`);
        } catch (dbErr) {
          console.error("[Firebase] Error saving scheduled feed:", dbErr.message);
        }
      }
    );
  }
}, 30_000); // Check every 30 s so we never miss a 1-minute window

/* ─────────────────────────── Start ──────────────────────────── */
server.listen(PORT, () => {
  console.log(`\n[Server] PawFeed server running → http://localhost:${PORT}`);
  console.log(`    MQTT broker : ${MQTT_BROKER}`);
  console.log(`    Database    : Firebase Firestore (Strictly)\n`);
});
