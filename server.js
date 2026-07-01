"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mqtt = require("mqtt");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

let firestoreDb = null;
try {
  admin.initializeApp();
  firestoreDb = admin.firestore();
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
  console.error("[Firebase] Could not initialize Firebase Admin. Please set GOOGLE_APPLICATION_CREDENTIALS.", err.message);
  process.exit(1);
}

/* ─────────────────────────── Config ─────────────────────────── */
const PORT = process.env.PORT || 3000;
const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://broker.hivemq.com:1883";
const TOPIC_STATUS = process.env.MQTT_TOPIC_STATUS || "pawfeed/device01/status";
const TOPIC_SENSOR = process.env.MQTT_TOPIC_SENSOR || "pawfeed/device01/sensor";
const TOPIC_CMD    = process.env.MQTT_TOPIC_CMD    || "pawfeed/device01/command";
const TOPIC_ALERTS = process.env.MQTT_TOPIC_ALERTS || "pawfeed/device01/alerts";
const TOPIC_FEED_LOG = process.env.MQTT_TOPIC_FEED_LOG || "pawfeed/device01/feed_log";

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

/* ── Auth config — crash immediately if secrets are missing ── */
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
  const portion = parseInt(req.body.portion) || 100;
  const type = req.body.type || "manual";
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
    return res.json({ success: true, ...record });
  } catch (err) {
    console.error("[Firebase] Error saving feed:", err.message);
    return res.status(500).json({ error: "Database error" });
  }
});

const getLocalCutoffISO = (daysBack = 0) => {
  const now = new Date();
  const localTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  localTime.setUTCDate(localTime.getUTCDate() - daysBack);
  localTime.setUTCHours(0, 0, 0, 0);
  const utcCutoff = new Date(localTime.getTime() - (8 * 60 * 60 * 1000));
  return utcCutoff.toISOString();
};

const getLocalISO = (isoString) => {
  return new Date(isoString).toLocaleString("sv-SE", { timeZone: "Asia/Manila" }).replace(' ', 'T');
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
    res.status(500).json({ error: "Database error" });
    return null;
  }
}

app.get("/feedings/weekly", authenticate, async (_req, res) => {
  const keyFn = (f) => getLocalISO(f.timestamp).slice(0, 10);
  const sortFn = (a, b) => a.key.localeCompare(b.key);
  const data = await aggregateFeedings(res, 6, keyFn, sortFn);
  if (data) {
    const renamed = data.map(d => ({ day: d.key, count: d.count, total_g: d.total_g }));
    return res.json(renamed);
  }
});

app.get("/feedings/monthly", authenticate, async (_req, res) => {
  const keyFn = (f) => getLocalISO(f.timestamp).slice(0, 10);
  const sortFn = (a, b) => a.key.localeCompare(b.key);
  const data = await aggregateFeedings(res, 29, keyFn, sortFn);
  if (data) {
    const renamed = data.map(d => ({ day: d.key, count: d.count, total_g: d.total_g }));
    return res.json(renamed);
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
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);

  try {
    const snap = await firestoreDb.collection("sensor_logs").where("timestamp", ">=", cutoff.toISOString()).get();
    const byDay = {};
    snap.forEach(doc => {
      const s = doc.data();
      const day = s.timestamp.slice(0, 10);
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
  const { label, time, portion_g = 100, days = "daily" } = req.body;
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
  const enabled = !!req.body.enabled;
  try {
    await firestoreDb.collection("schedules").doc(req.params.id).update({ enabled });
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

/* ─────────────────────────── Socket.io ──────────────────────── */
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", async (socket) => {
  console.log(`[Socket.io] Client connected — ${socket.id}`);

  socket.on("feed", async (data) => {
    const portion = parseInt(data?.portion) || 100;
    const type = data?.type || "manual";
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
  socket.on("disconnect", () =>
    console.log(`[Socket.io] Disconnected — ${socket.id}`),
  );
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
  mqttClient.subscribe([TOPIC_STATUS, TOPIC_SENSOR, TOPIC_ALERTS, TOPIC_FEED_LOG], { qos: 1 });
  io.emit("mqtt_status", { connected: true });
});
mqttClient.on("reconnect", () => io.emit("mqtt_status", { connected: false }));
mqttClient.on("error", (err) => {
  if (err.code !== "ECONNREFUSED") console.error("[MQTT] Error:", err.message);
});

let lastSensorEntry = null;
let lastSensorArchiveTime = 0;

mqttClient.on("message", async (topic, payload) => {
  console.log(`[MQTT] ← ${topic}: ${payload.toString()}`);
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return console.warn("[MQTT] Bad JSON on", topic);
  }

  if (topic === TOPIC_ALERTS) {
    console.log(`[MQTT] Alert from device: ${data.alert_message}`);
    io.emit("alert", { level: "error", message: data.alert_message || "Device alert" });
    return;
  }

  if (topic === TOPIC_FEED_LOG) {
    const record = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      portion_g: data.portion_g || 100,
      type: data.type || "physical",
    };
    try {
      await firestoreDb.collection("feedings").doc(record.id).set(record);
      io.emit("feeding_done", record);
      console.log(`[Feed] ${record.portion_g}g (${record.type})`);
    } catch (err) {
      console.error("[Firebase] Error saving physical feed:", err.message);
    }
    return;
  }

  if (topic === TOPIC_STATUS || topic === TOPIC_SENSOR) {
    if (data.online === false) {
      io.emit("status", { online: false });
      return;
    }
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      food_level: data.food_level ?? 0,
      jammed: !!data.jammed,
      last_dispensed_g: data.last_dispensed_g ?? null,
      dispense_success: data.dispense_success ?? null,
      bowl_weight: data.bowl_weight ?? null,
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
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const hhmm = formatter.format(now);
  
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
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

    firedThisMinute.add(s.id);

    mqttClient.publish(
      TOPIC_CMD,
      JSON.stringify({ action: "feed", portion_g: s.portion_g }),
      { qos: 1 },
    );
    const record = {
      id: crypto.randomUUID(),
      timestamp: now.toISOString(),
      portion_g: s.portion_g,
      type: "scheduled",
      label: s.label,
    };
    try {
      await firestoreDb.collection("feedings").doc(record.id).set(record);
      io.emit("feeding_done", record);
      console.log(`[Schedule] "${s.label}" fired at ${hhmm} (Asia/Manila) — ${s.portion_g}g`);
    } catch (err) {
      console.error("[Firebase] Error saving scheduled feed:", err.message);
    }
  }
}, 30_000); // Check every 30 s so we never miss a 1-minute window

/* ─────────────────────────── Start ──────────────────────────── */
server.listen(PORT, () => {
  console.log(`\n[Server] PawFeed server running → http://localhost:${PORT}`);
  console.log(`    MQTT broker : ${MQTT_BROKER}`);
  console.log(`    Database    : Firebase Firestore (Strictly)\n`);
});
