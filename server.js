"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mqtt = require("mqtt");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");

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

/* ─────────────────────────── Express ────────────────────────── */
const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "frontend/dist"))); // serves React production build

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
app.post("/login", (req, res) => {
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
  const { name, breed, avatar } = req.body;
  const profile = {
    name:  (name  || "").trim() || "Bantay",
    breed: (breed || "").trim() || "Golden Retriever",
    avatar: avatar || null,
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
app.post("/feed", authenticate, async (req, res) => {
  const portion = parseInt(req.body.portion) || 100;
  const type = req.body.type || "manual";
  mqttClient.publish(
    TOPIC_CMD,
    JSON.stringify({ action: "feed", portion_g: portion }),
    { qos: 1 },
  );
  const record = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    portion_g: portion,
    type,
  };
  try {
    await firestoreDb.collection("feedings").doc(record.id.toString()).set(record);
    io.emit("feeding_done", record);
    return res.json({ success: true, ...record });
  } catch (err) {
    console.error("[Firebase] Error saving feed:", err.message);
    return res.status(500).json({ error: "Database error" });
  }
});

app.get("/feedings/today", authenticate, async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const snap = await firestoreDb.collection("feedings").where("timestamp", ">=", today).get();
    let count = 0;
    let total_g = 0;
    snap.forEach(doc => { count++; total_g += doc.data().portion_g; });
    return res.json({ count, total_g });
  } catch (err) {
    console.error("[Firebase] Error fetching today feedings:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/feedings/weekly", authenticate, async (_req, res) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);

  try {
    const snap = await firestoreDb.collection("feedings").where("timestamp", ">=", cutoff.toISOString()).get();
    const result = {};
    snap.forEach(doc => {
      const f = doc.data();
      const day = f.timestamp.slice(0, 10);
      if (!result[day]) result[day] = { day, count: 0, total_g: 0 };
      result[day].count++;
      result[day].total_g += f.portion_g;
    });
    return res.json(Object.values(result).sort((a, b) => a.day.localeCompare(b.day)));
  } catch (err) {
    console.error("[Firebase] Error fetching weekly feedings:", err.message);
    res.status(500).json({ error: "Database error" });
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
app.get("/schedules", authenticate, async (_req, res) => {
  try {
    const snap = await firestoreDb.collection("schedules").get();
    const rows = [];
    snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
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
    return res.json({ success: true });
  } catch (err) {
    console.error("[Firebase] Error updating schedule:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.delete("/schedules/:id", authenticate, async (req, res) => {
  try {
    await firestoreDb.collection("schedules").doc(req.params.id).delete();
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
  
  try {
    const snap = await firestoreDb.collection("sensor_logs").orderBy("timestamp", "desc").limit(1).get();
    if (!snap.empty) socket.emit("status", snap.docs[0].data());
    
    const today = new Date().toISOString().slice(0, 10);
    const feedingsSnap = await firestoreDb.collection("feedings").where("timestamp", ">=", today).get();
    let count = 0;
    feedingsSnap.forEach(() => count++);
    socket.emit("feedings_today", { count });
  } catch (err) {
    console.error("[Firebase] Socket init error:", err.message);
  }

  socket.on("feed", async (data) => {
    const portion = parseInt(data?.portion) || 100;
    const type = data?.type || "manual";
    mqttClient.publish(
      TOPIC_CMD,
      JSON.stringify({ action: "feed", portion_g: portion }),
      { qos: 1 },
    );
    const record = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      portion_g: portion,
      type,
    };
    try {
      await firestoreDb.collection("feedings").doc(record.id.toString()).set(record);
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
  mqttClient.subscribe([TOPIC_STATUS, TOPIC_SENSOR, TOPIC_ALERTS], { qos: 1 });
  io.emit("mqtt_status", { connected: true });
});
mqttClient.on("reconnect", () => io.emit("mqtt_status", { connected: false }));
mqttClient.on("error", (err) => {
  if (err.code !== "ECONNREFUSED") console.error("[MQTT] Error:", err.message);
});

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

  if (topic === TOPIC_STATUS || topic === TOPIC_SENSOR) {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      food_level: data.food_level ?? 0,
      jammed: !!data.jammed,
      last_dispensed_g: data.last_dispensed_g ?? null,
      dispense_success: data.dispense_success ?? null,
      bowl_weight: data.bowl_weight ?? null,
    };
    try {
      await firestoreDb.collection("sensor_logs").doc(entry.id.toString()).set(entry);
    } catch (err) {
      console.error("[Firebase] Error saving sensor log:", err.message);
    }

    io.emit("status", entry);
    if (data.jammed)
      io.emit("alert", { level: "error", message: "Mechanical jam detected!" });
    if ((data.food_level ?? 100) < 20)
      io.emit("alert", {
        level: "warn",
        message: `Food level critical: ${data.food_level}%`,
      });
  }
});

/* ─────────────────────────── Schedule runner ────────────────── */
setInterval(async () => {
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  let schedules = [];
  try {
    const snapshot = await firestoreDb.collection("schedules").get();
    snapshot.forEach(doc => {
      const s = { id: doc.id, ...doc.data() };
      if (s.enabled && s.time === hhmm) schedules.push(s);
    });
  } catch (err) {
    console.error("[Firebase] Error running schedules from Firebase:", err.message);
  }

  for (const s of schedules) {
    if (s.days === "weekdays" && isWeekend) continue;
    if (s.days === "weekends" && !isWeekend) continue;
    mqttClient.publish(
      TOPIC_CMD,
      JSON.stringify({ action: "feed", portion_g: s.portion_g }),
      { qos: 1 },
    );
    const record = {
      id: Date.now(),
      timestamp: now.toISOString(),
      portion_g: s.portion_g,
      type: "scheduled",
      label: s.label,
    };
    try {
      await firestoreDb.collection("feedings").doc(record.id.toString()).set(record);
      io.emit("feeding_done", record);
      console.log(`[Schedule] "${s.label}" fired — ${s.portion_g}g`);
    } catch (err) {
      console.error("[Firebase] Error saving scheduled feed:", err.message);
    }
  }
}, 60_000);

/* ─────────────────────────── Start ──────────────────────────── */
server.listen(PORT, () => {
  console.log(`\n[Server] PawFeed server running → http://localhost:${PORT}`);
  console.log(`    MQTT broker : ${MQTT_BROKER}`);
  console.log(`    Database    : Firebase Firestore (Strictly)\n`);
});
