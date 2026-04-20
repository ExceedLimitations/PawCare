"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mqtt = require("mqtt");
const { Low, JSONFile } = require("lowdb");

/* ─────────────────────────── Config ─────────────────────────── */
const PORT = process.env.PORT || 3000;
const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://broker.hivemq.com:1883";
const TOPIC_STATUS = process.env.MQTT_TOPIC_STATUS || "pawfeed/karyl/status";
const TOPIC_SENSOR = process.env.MQTT_TOPIC_SENSOR || "pawfeed/karyl/sensor";
const TOPIC_CMD = process.env.MQTT_TOPIC_CMD || "pawfeed/karyl/command";

/* ─────────────────────────── Database (lowdb v2) ────────────── */
const adapter = new JSONFile(path.join(__dirname, "pawfeed.json"));
const db = new Low(adapter);

async function initDb() {
  await db.read();
  db.data ||= {
    feedings: [],
    sensor_logs: [],
    schedules: [
      {
        id: 1,
        label: "Morning",
        time: "07:00",
        portion_g: 80,
        days: "daily",
        enabled: true,
      },
      {
        id: 2,
        label: "Afternoon",
        time: "12:30",
        portion_g: 80,
        days: "daily",
        enabled: true,
      },
      {
        id: 3,
        label: "Evening",
        time: "18:00",
        portion_g: 80,
        days: "daily",
        enabled: true,
      },
      {
        id: 4,
        label: "Late snack",
        time: "22:00",
        portion_g: 40,
        days: "weekends",
        enabled: false,
      },
    ],
  };
  await db.write();
}

function nextId(collection) {
  if (!collection.length) return 1;
  return Math.max(...collection.map((r) => r.id)) + 1;
}

/* ─────────────────────────── Express ────────────────────────── */
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(__dirname)); // serves index.html & static assets

/* ── REST: Feeding ─────────────────────────────────────────── */
app.post("/feed", async (req, res) => {
  const portion = parseInt(req.body.portion) || 80;
  const type = req.body.type || "manual";
  mqttClient.publish(
    TOPIC_CMD,
    JSON.stringify({ action: "feed", portion_g: portion }),
    { qos: 1 },
  );
  await db.read();
  const record = {
    id: nextId(db.data.feedings),
    timestamp: new Date().toISOString(),
    portion_g: portion,
    type,
  };
  db.data.feedings.push(record);
  await db.write();
  io.emit("feeding_done", record);
  res.json({ success: true, ...record });
});

app.get("/feedings/today", async (_req, res) => {
  await db.read();
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.data.feedings.filter((f) => f.timestamp.startsWith(today));
  res.json({
    count: rows.length,
    total_g: rows.reduce((s, f) => s + f.portion_g, 0),
  });
});

app.get("/feedings/weekly", async (_req, res) => {
  await db.read();
  const result = {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);
  db.data.feedings
    .filter((f) => new Date(f.timestamp) >= cutoff)
    .forEach((f) => {
      const day = f.timestamp.slice(0, 10);
      if (!result[day]) result[day] = { day, count: 0, total_g: 0 };
      result[day].count++;
      result[day].total_g += f.portion_g;
    });
  res.json(Object.values(result).sort((a, b) => a.day.localeCompare(b.day)));
});

app.get("/feedings/recent", async (_req, res) => {
  await db.read();
  res.json([...db.data.feedings].reverse().slice(0, 50));
});

/* ── REST: Sensor ──────────────────────────────────────────── */
app.get("/status", async (_req, res) => {
  await db.read();
  const logs = db.data.sensor_logs;
  res.json(
    logs.length
      ? logs[logs.length - 1]
      : { food_level: 72, jammed: false, last_dispensed_g: null, dispense_success: null },
  );
});

app.get("/sensor/history", async (_req, res) => {
  await db.read();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);
  const byDay = {};
  db.data.sensor_logs
    .filter((s) => new Date(s.timestamp) >= cutoff)
    .forEach((s) => {
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
  res.json(rows);
});

/* ── REST: Schedules ───────────────────────────────────────── */
app.get("/schedules", async (_req, res) => {
  await db.read();
  res.json(db.data.schedules);
});

app.post("/schedules", async (req, res) => {
  const { label, time, portion_g = 80, days = "daily" } = req.body;
  if (!label || !time)
    return res.status(400).json({ error: "label and time required" });
  await db.read();
  const entry = {
    id: nextId(db.data.schedules),
    label,
    time,
    portion_g,
    days,
    enabled: true,
  };
  db.data.schedules.push(entry);
  await db.write();
  res.json(entry);
});

app.patch("/schedules/:id", async (req, res) => {
  await db.read();
  const s = db.data.schedules.find((x) => x.id === parseInt(req.params.id));
  if (!s) return res.status(404).json({ error: "Not found" });
  s.enabled = !!req.body.enabled;
  await db.write();
  res.json({ success: true });
});

app.delete("/schedules/:id", async (req, res) => {
  await db.read();
  db.data.schedules = db.data.schedules.filter(
    (x) => x.id !== parseInt(req.params.id),
  );
  await db.write();
  res.json({ success: true });
});

/* ─────────────────────────── Socket.io ──────────────────────── */
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", async (socket) => {
  console.log(`[Socket.io] Client connected — ${socket.id}`);
  await db.read();
  const logs = db.data.sensor_logs;
  if (logs.length) socket.emit("status", logs[logs.length - 1]);
  const today = new Date().toISOString().slice(0, 10);
  socket.emit("feedings_today", {
    count: db.data.feedings.filter((f) => f.timestamp.startsWith(today)).length,
  });
  socket.on("feed", async (data) => {
    const portion = parseInt(data?.portion) || 80;
    const type = data?.type || "manual";
    mqttClient.publish(
      TOPIC_CMD,
      JSON.stringify({ action: "feed", portion_g: portion }),
      { qos: 1 },
    );
    await db.read();
    const record = {
      id: nextId(db.data.feedings),
      timestamp: new Date().toISOString(),
      portion_g: portion,
      type,
    };
    db.data.feedings.push(record);
    await db.write();
    io.emit("feeding_done", record);
    console.log(`[Feed] ${portion}g (${type})`);
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
  mqttClient.subscribe([TOPIC_STATUS, TOPIC_SENSOR], { qos: 1 });
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

  if (topic === TOPIC_STATUS || topic === TOPIC_SENSOR) {
    const entry = {
      id: 0,
      timestamp: new Date().toISOString(),
      food_level: data.food_level ?? 0,
      jammed: !!data.jammed,
      last_dispensed_g: data.last_dispensed_g ?? null,
      dispense_success: data.dispense_success ?? null,
    };
    await db.read();
    entry.id = nextId(db.data.sensor_logs);
    db.data.sensor_logs.push(entry);
    if (db.data.sensor_logs.length > 1000)
      db.data.sensor_logs.splice(0, db.data.sensor_logs.length - 1000);
    await db.write();
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
  await db.read();
  const due = db.data.schedules.filter((s) => s.enabled && s.time === hhmm);
  for (const s of due) {
    if (s.days === "weekdays" && isWeekend) continue;
    if (s.days === "weekends" && !isWeekend) continue;
    mqttClient.publish(
      TOPIC_CMD,
      JSON.stringify({ action: "feed", portion_g: s.portion_g }),
      { qos: 1 },
    );
    const record = {
      id: nextId(db.data.feedings),
      timestamp: now.toISOString(),
      portion_g: s.portion_g,
      type: "scheduled",
      label: s.label,
    };
    db.data.feedings.push(record);
    await db.write();
    io.emit("feeding_done", record);
    console.log(`[Schedule] "${s.label}" fired — ${s.portion_g}g`);
  }
}, 60_000);

/* ─────────────────────────── Start ──────────────────────────── */
initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🐾  PawFeed server running → http://localhost:${PORT}`);
    console.log(`    MQTT broker : ${MQTT_BROKER}`);
    console.log(`    Database    : ${path.join(__dirname, "pawfeed.json")}\n`);
  });
});
