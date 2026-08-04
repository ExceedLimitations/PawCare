# 🐾 PawCare — Smart IoT Pet Feeder Dashboard

A full-stack IoT system for monitoring and controlling an automatic pet feeder in real-time. Built with Node.js, Express, Socket.io, and MQTT on the backend; React + Vite on the frontend; Firebase Firestore as the cloud database; and an ESP32 microcontroller running custom Arduino firmware.

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Firebase Setup](#firebase-setup)
6. [Environment Variables](#environment-variables)
7. [Running Locally (Development)](#running-locally-development)
8. [Building for Production](#building-for-production)
9. [Deploying to Render (Backend)](#deploying-to-render-backend)
10. [Deploying to Netlify (Frontend-only)](#deploying-to-netlify-frontend-only)
11. [REST API Reference](#rest-api-reference)
12. [Socket.io Events](#socketio-events)
13. [MQTT Topics & Payloads](#mqtt-topics--payloads)
14. [Hardware & Wiring](#hardware--wiring)
15. [Firmware (ESP32)](#firmware-esp32)
16. [Over-the-Air (OTA) Updates](#over-the-air-ota-updates)
17. [Security Model](#security-model)
18. [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Description |
|---|---|
| **Real-time monitoring** | Live food-level gauge and device-online indicator via MQTT → Socket.io |
| **Manual dispensing** | Trigger a food dispense with a configurable portion (1–500 g) from the dashboard |
| **Physical button** | Press the on-device button to dispense; the event is logged to Firestore automatically |
| **Automated schedules** | Create, edit, enable/disable, and delete feeding schedules stored in Firestore; schedules fire even if the dashboard is closed |
| **Precise weight dispensing** | The ESP32 opens the hopper servo until the HX711 load cell confirms the target weight has dropped into the bowl |
| **Feeding history** | Logs every dispense (manual, scheduled, or physical) with timestamps and portion sizes; viewable as daily, weekly, and monthly charts |
| **Sensor history** | Tracks average food level over the last 7 days |
| **Alerts & notifications** | Visual warnings for low food, chute jams, and other hardware events; persisted to Firestore |
| **Pet profile** | Store your pet's name, breed, age, birthday, and avatar photo |
| **OTA firmware updates** | Push new ESP32 firmware from the dashboard without physical access to the device |
| **Demo mode** | Dashboard shows simulated sensor data automatically when no hardware is connected |
| **JWT authentication** | All REST endpoints and Socket.io connections require a signed JWT |
| **Rate limiting** | Login (10 req/min) and feed (30 req/min) endpoints are rate-limited |

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| **Backend runtime** | Node.js | ≥ 18 |
| **HTTP server** | Express | 4.x |
| **Real-time** | Socket.io | 4.x |
| **IoT messaging** | MQTT | 5.x |
| **Database** | Firebase Firestore (via `firebase-admin`) | 14.x |
| **Auth** | JSON Web Tokens (`jsonwebtoken`) | 9.x |
| **Rate limiting** | `express-rate-limit` | 8.x |
| **Frontend** | React + Vite | React 19, Vite 8 |
| **Charts** | Chart.js + `react-chartjs-2` | 4.x / 5.x |
| **Icons** | `lucide-react` | 1.x |
| **Serverless (optional)** | Netlify Functions | — |
| **Dev server** | nodemon | 3.x |

---

## Project Structure

```
PawCare/
├── server.js                       # Express + Socket.io + MQTT + schedule runner
├── firmware.ino                    # ESP32 Arduino firmware (main sketch)
├── firmware/
│   ├── firmware.bin                # Compiled firmware binary (served for OTA)
│   └── version.json                # OTA manifest: { "version": "x.y.z", "url": "..." }
├── netlify/
│   └── functions/                  # Netlify serverless functions (static deployment)
│       ├── _firebase.js            # Shared Firestore initializer
│       ├── _helpers.js             # Shared utility functions
│       ├── _data.js                # Shared data-access helpers
│       ├── feed.js                 # POST /feed
│       ├── feedings-today.js       # GET /feedings/today
│       ├── feedings-weekly.js      # GET /feedings/weekly
│       ├── feedings-recent.js      # GET /feedings/recent
│       ├── sensor-history.js       # GET /sensor/history
│       ├── schedules.js            # GET & POST /schedules
│       ├── schedules-id.js         # PATCH & DELETE /schedules/:id
│       ├── status.js               # GET /status
│       └── profile.js              # GET & POST /profile
├── netlify.toml                    # Netlify build & redirect configuration
├── frontend/                       # React + Vite dashboard
│   ├── index.html
│   ├── vite.config.js              # Dev proxy → localhost:3000
│   ├── package.json
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                 # Root component & all dashboard logic
│       ├── index.css               # Global styles
│       ├── components/
│       │   └── MetricPanels.jsx    # Reusable stat-card panels
│       └── hooks/
│           ├── useDashboard.js     # All API calls & state management
│           └── useSocket.js        # Socket.io connection & event handlers
├── package.json                    # Server (backend) dependencies
├── .env.example                    # Template for your .env file
├── .gitignore
└── rewrite_firmware.py             # Helper script to regenerate firmware.ino
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) **v18 or later** (both backend and frontend build)
- npm (bundled with Node)
- A **Firebase project** with Firestore enabled (see [Firebase Setup](#firebase-setup))
- An MQTT broker — the public HiveMQ broker (`broker.hivemq.com:1883`) works for development; use a private broker in production
- *(For firmware)* Arduino IDE with ESP32 board support and the libraries listed in [Firmware](#firmware-esp32)

---

## Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a new project (or use an existing one).
2. Enable **Cloud Firestore** in Native mode.
3. Go to **Project Settings → Service Accounts** and click **Generate new private key**. Save the downloaded JSON file as `firebase-service-account.json` in the project root.
4. In your `.env` file set:
   ```env
   GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
   ```
   > **Tip for PaaS (Render, Railway, etc.):** Instead of uploading the file, paste the entire JSON content as a single-line string into the `FIREBASE_SERVICE_ACCOUNT` environment variable. The server reads this automatically.

The server will verify the Firestore connection on startup and crash with a helpful error if it cannot reach the database.

### Firestore Collections Used

| Collection | Purpose |
|---|---|
| `feedings` | One document per dispense event |
| `schedules` | One document per feeding schedule |
| `sensor_logs` | Sensor telemetry; `latest` document always holds the most recent reading |
| `notifications` | Persisted alert/notification records |
| `config/profile` | Single document storing the pet profile |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3000` | No | HTTP server port |
| `MQTT_BROKER` | `mqtt://broker.hivemq.com:1883` | No | MQTT broker URL |
| `MQTT_TOPIC_STATUS` | `pawfeed/device01/status` | No | Hardware status updates |
| `MQTT_TOPIC_SENSOR` | `pawfeed/device01/sensor` | No | Sensor readings |
| `MQTT_TOPIC_CMD` | `pawfeed/device01/command` | No | Commands sent to hardware |
| `MQTT_TOPIC_ALERTS` | `pawfeed/device01/alerts` | No | Device alert messages |
| `MQTT_TOPIC_FEED_LOG` | `pawfeed/device01/feed_log` | No | Physical button feed events from device |
| `MQTT_TOPIC_OTA_STATUS` | `pawfeed/device01/ota_status` | No | OTA progress updates |
| `GOOGLE_APPLICATION_CREDENTIALS` | `./firebase-service-account.json` | **Yes*** | Path to Firebase service account JSON |
| `FIREBASE_SERVICE_ACCOUNT` | *(empty)* | **Yes*** | Firebase service account JSON as a string (PaaS alternative to the file) |
| `ADMIN_USER` | *(none)* | **Yes** | Dashboard login username |
| `ADMIN_PASS` | *(none)* | **Yes** | Dashboard login password |
| `JWT_SECRET` | *(none)* | **Yes** | JWT signing secret (use 32+ random characters) |
| `TZ` | `Asia/Manila` | No | Timezone for schedule execution and date labels |

> **\*** Either `GOOGLE_APPLICATION_CREDENTIALS` (file path) or `FIREBASE_SERVICE_ACCOUNT` (JSON string) must be provided. The server exits immediately if Firebase cannot initialize.

> **Security:** The server **refuses to start** if `ADMIN_USER`, `ADMIN_PASS`, or `JWT_SECRET` are missing. Never use default or weak values in production.

---

## Running Locally (Development)

### 1. Install dependencies

```bash
# Project root — backend deps
npm install

# Frontend deps
cd frontend
npm install
cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in ADMIN_USER, ADMIN_PASS, JWT_SECRET, and Firebase credentials
```

### 3. Start the backend

```bash
npm run dev          # uses nodemon — auto-restarts on file changes
```

The backend runs at **http://localhost:3000**.

### 4. Start the frontend (separate terminal)

```bash
cd frontend
npm run dev          # Vite dev server — usually http://localhost:5173
```

The Vite dev server proxies all `/feed`, `/schedules`, `/status`, and socket requests to `localhost:3000`, so CORS is not an issue in development.

> **No hardware?** The dashboard automatically enters **demo simulation mode** — it generates random sensor readings so you can explore the UI without any physical device connected.

---

## Building for Production

```bash
cd frontend
npm run build        # outputs to frontend/dist/
```

In production mode the Express server at the project root serves the built React app from `frontend/dist/`. You only need to run the backend:

```bash
npm start            # runs node server.js
```

---

## Deploying to Render (Backend)

Render is the recommended platform for the full-stack deployment (backend + Firebase + MQTT).

1. Push the repo to GitHub.
2. Create a new **Web Service** on [Render](https://render.com/) pointing to your repo.
3. Set the build command to:
   ```
   npm install && cd frontend && npm install && npm run build
   ```
4. Set the start command to:
   ```
   node server.js
   ```
5. Add all environment variables from the table above in the Render dashboard.
6. For Firebase credentials on Render, paste the entire service account JSON into the `FIREBASE_SERVICE_ACCOUNT` environment variable.

The live URL (`https://pawcare-rcd9.onrender.com`) is already embedded in the firmware as the OTA endpoint.

---

## Deploying to Netlify (Frontend-only)

Netlify is supported for a **static + serverless** deployment where the frontend and API functions are both served from Netlify's CDN (no persistent backend — MQTT real-time is not available in this mode).

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Authenticate and link your site
netlify login
netlify link

# Run locally with Netlify Functions
npm run netlify-dev
```

`netlify.toml` maps all API routes (e.g., `/feed`, `/schedules`) to the corresponding functions in `netlify/functions/`. The SPA fallback rule serves `index.html` for all unmatched paths.

> **Note:** Socket.io real-time updates and the schedule runner are only available with the full Node.js backend on Render (or equivalent). The Netlify deployment is suitable for read-only or limited-write dashboards without live sensor streaming.

---

## REST API Reference

All endpoints except `GET /health`, `POST /login`, `GET /firmware/version.json`, and `GET /firmware/firmware.bin` require a `Bearer <token>` header.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/login` | Obtain a JWT. Body: `{ "username": "admin", "password": "..." }`. Returns `{ "success": true, "token": "..." }`. Token expires in 8 hours. |
| `GET` | `/health` | Liveness probe. Returns `{ "ok": true, "ts": <epoch_ms> }`. |

### Feeding

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/feed` | ✅ | Dispatch a food dispense. Body: `{ "portion": 80, "type": "manual" }`. Portion clamped to 1–500 g. |
| `GET` | `/feedings/today` | ✅ | Today's total feed count and grams. |
| `GET` | `/feedings/recent` | ✅ | Last 50 feeding records (newest first). |
| `GET` | `/feedings/weekly` | ✅ | Daily totals for the past 7 days (zero-padded). |
| `GET` | `/feedings/monthly` | ✅ | Daily totals for the past 30 days (zero-padded). |
| `GET` | `/feedings/daily` | ✅ | Hourly breakdown for today. |

### Sensor & Status

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/status` | ✅ | Latest sensor snapshot from Firestore. |
| `GET` | `/sensor/history` | ✅ | Daily average food level for the past 7 days. |

### Schedules

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/schedules` | ✅ | List all feeding schedules. |
| `POST` | `/schedules` | ✅ | Create a new schedule. Body: `{ "label": "Morning", "time": "08:00", "portion_g": 80, "days": "daily" }`. `days` accepts `"daily"`, `"weekdays"`, or `"weekends"`. |
| `PATCH` | `/schedules/:id` | ✅ | Update a schedule field. Any subset of `{ label, time, portion_g, days, enabled }`. |
| `DELETE` | `/schedules/:id` | ✅ | Delete a schedule. |

### Notifications

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/notifications` | ✅ | Last 100 notifications (newest first). |
| `POST` | `/notifications` | ✅ | Save a notification. Body: `{ "type": "error", "title": "...", "message": "..." }`. |
| `DELETE` | `/notifications` | ✅ | Clear all notifications. |
| `DELETE` | `/notifications/:id` | ✅ | Dismiss a single notification. |

### Pet Profile

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/profile` | ✅ | Retrieve pet profile (`name`, `breed`, `avatar`, `birthday`, `age`). |
| `POST` | `/profile` | ✅ | Save/update pet profile. Accepts Base64 avatar image (up to 10 MB). |

### Firmware (OTA)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/firmware/version.json` | ❌ | Returns the OTA version manifest. |
| `GET` | `/firmware/firmware.bin` | ❌ | Streams the compiled firmware binary to the ESP32. |
| `POST` | `/firmware/update` | ✅ | Sends an `ota_update` MQTT command to trigger an OTA check on the device. |

---

## Socket.io Events

The frontend connects with its JWT in the handshake auth: `{ auth: { token } }`.

### Events emitted **by the server** to clients

| Event | Payload | Description |
|---|---|---|
| `status` | `{ food_level, jammed, last_dispensed_g, dispense_success, bowl_weight, online, ... }` | Real-time sensor update from device |
| `feeding_done` | `{ id, timestamp, portion_g, type, label? }` | Confirmed dispense (any source) |
| `alert` | `{ level: "error", message: "..." }` | Hardware alert |
| `mqtt_status` | `{ connected: true \| false }` | MQTT broker connectivity change |
| `ota_status` | `{ state, progress?, version? }` | OTA firmware update progress |
| `tare_ack` | `{ timestamp }` | Scale tare command acknowledged |
| `error` | `{ message }` | Socket-level error (e.g., rate limit exceeded) |

### Events emitted **by clients** to the server

| Event | Payload | Description |
|---|---|---|
| `feed` | `{ portion: 80, type: "manual" }` | Trigger a dispense (rate-limited: 30/min) |
| `tare` | *(none)* | Zero the load cell scale |

---

## MQTT Topics & Payloads

All topics use the prefix configured via `MQTT_TOPIC_*` environment variables (default: `pawfeed/device01`).

### Server → Device (`/command`)

```json
{ "action": "feed",       "portion_g": 80 }
{ "action": "tare" }
{ "action": "ota_update" }
```

### Device → Server (`/status` or `/sensor`)

```json
{
  "food_level": 72,
  "jammed": false,
  "last_dispensed_g": 50.1,
  "dispense_success": true,
  "bowl_weight": 122.5,
  "fw_version": "1.3.10"
}
```

### Device → Server (`/feed_log`) — Physical button only

```json
{ "type": "physical", "portion_g": 100 }
```

### Device → Server (`/alerts`)

```json
{ "alert_message": "Hopper jammed — check dispenser chute" }
```

### Device → Server (`/ota_status`)

```json
{ "state": "downloading", "progress": 45 }
{ "state": "complete",    "version": "1.3.10" }
{ "state": "error",       "message": "HTTP error 404" }
```

---

## Hardware & Wiring

Flash `firmware.ino` to your ESP32 and wire the components according to the table below.

| Component | ESP32 Pin | Notes |
|---|---|---|
| **Servo Motor (Dispenser gate)** | `GPIO 13` | Controls chute opening via `ESP32Servo` / ledc PWM |
| **HC-SR04 Ultrasonic — Trigger** | `GPIO 5` | Measures hopper fill level |
| **HC-SR04 Ultrasonic — Echo** | `GPIO 18` | Use a 5V → 3.3V logic level shifter |
| **IR Jam Sensor (FC-51 / break-beam)** | `GPIO 19` | `INPUT_PULLUP`; `IR_JAM_STATE = LOW` for reflectance modules, `HIGH` for break-beam |
| **HX711 Load Cell — DOUT** | `GPIO 21` | Scale data output |
| **HX711 Load Cell — SCK** | `GPIO 22` | Scale clock |
| **Piezo Buzzer** | `GPIO 4` | Non-blocking PWM via ledc; auditory feedback on dispense and errors |
| **Status LED** | `GPIO 2` | Solid = online; fast blink = WiFi portal open |
| **Alert/Error LED** | `GPIO 15` | Flashes on jam or dispense failure |
| **Manual Dispense Button** | `GPIO 14` | Short press = dispense; hold 3 s at boot = WiFi reset |

### Hopper Ultrasonic Calibration

The firmware maps the HC-SR04 distance to a 0–100% food level:

```
HOPPER_FULL_CM  = 2   cm  →  100%  (sensor to food surface when full)
HOPPER_EMPTY_CM = 11  cm  →  0%    (sensor to hopper bottom when empty)
```

To recalibrate: empty the hopper, open the lid, and read the distance from the Arduino Serial Monitor. Update `HOPPER_EMPTY_CM` to match.

### Servo Gate Calibration

| Constant | Value | Meaning |
|---|---|---|
| `SERVO_CLOSED` | `90°` | Gate sealed — food held in hopper |
| `SERVO_OPEN` | `20°` | Gate fully open — food falls to bowl |

Adjust these angles if your servo mechanical linkage is different.

---

## Firmware (ESP32)

### Required Arduino Libraries

Install these via Arduino Library Manager (Sketch → Include Library → Manage Libraries):

| Library | Author |
|---|---|
| `WiFiManager` | tzapu |
| `PubSubClient` | Nick O'Leary |
| `ArduinoJson` | Benoit Blanchon |
| `HX711` | bogde |
| `ESP32Servo` | Kevin Harrington |

The following are built into the ESP32 Arduino core and do not need separate installation: `WiFi`, `Preferences`, `HTTPUpdate`, `WiFiClientSecure`.

### First Boot — WiFi Setup

On first boot (or after a WiFi reset), the ESP32 opens a captive-portal access point:

- **SSID:** `PawCare-Setup`
- **Password:** `pawcare123`

Connect with your phone or laptop, open any browser, and you will be redirected to a configuration page where you can enter:

- Your home Wi-Fi SSID and password
- MQTT Server address
- MQTT Port
- Topic Prefix (e.g., `pawfeed/device01`)

All settings are saved to ESP32 NVS flash and survive reboots. To reset WiFi and re-open the portal, hold the button on `GPIO 14` for **3 seconds at boot**.

### Key Firmware Constants

| Constant | Default | Description |
|---|---|---|
| `FIRMWARE_VERSION` | `"1.3.10"` | Must match `firmware/version.json` to avoid boot-loop OTA |
| `OTA_VERSION_URL` | `https://pawcare-rcd9.onrender.com/firmware/version.json` | Where the device checks for updates |
| `calibration_factor` | `418.95` | HX711 scale calibration; adjust until `1 g = 1 g` in Serial Monitor |
| `targetWeight` | `45` g | Default portion if no `portion_g` arrives from dashboard |
| `emptyThreshold` | `10` % | Food level below which hopper is considered empty |
| `jamTimeout` | `1500` ms | Time IR sensor must be blocked before declaring a jam |
| `IR_JAM_STATE` | `LOW` | Flip to `HIGH` for break-beam IR sensors |

---

## Over-the-Air (OTA) Updates

PawCare supports pushing new firmware to the ESP32 without physical access.

### Workflow

1. Compile the new firmware in Arduino IDE: **Sketch → Export Compiled Binary** → copy the `.bin` to `firmware/firmware.bin`.
2. Bump the version string in `firmware/version.json`:
   ```json
   { "version": "1.3.11", "url": "https://pawcare-rcd9.onrender.com/firmware/firmware.bin" }
   ```
3. Bump `FIRMWARE_VERSION` in `firmware.ino` to the **same** string (prevents the device from OTA-ing itself in an infinite loop).
4. Deploy the updated server (with the new `firmware/` files) to Render.
5. From the dashboard, click **Update Firmware** — this sends `{ "action": "ota_update" }` via MQTT. The device fetches the version manifest, compares versions, downloads the binary over HTTPS, and reboots.

OTA progress is streamed back to the dashboard via the `ota_status` MQTT topic.

---

## Security Model

| Area | Mechanism |
|---|---|
| **Dashboard login** | Username + password validated against `ADMIN_USER` / `ADMIN_PASS` env vars |
| **API auth** | JWT signed with `JWT_SECRET`; 8-hour expiry; all routes except login/health/OTA download require `Authorization: Bearer <token>` |
| **Socket.io auth** | JWT verified in Socket.io middleware on every connection |
| **Rate limiting** | Login: 10 req/min; Feed (HTTP): 30 req/min; Feed (Socket): 30 events/min per socket |
| **Startup guard** | Server refuses to start if `ADMIN_USER`, `ADMIN_PASS`, or `JWT_SECRET` are unset |
| **Portion clamping** | Portion values are clamped to 1–500 g server-side regardless of what the client sends |
| **OTA endpoints** | Firmware download endpoints are public (ESP32 cannot send auth headers), but they only serve static files |
| **Firestore** | Access is server-side only via Firebase Admin SDK; Firestore Security Rules should be set to deny all direct client access |

---

## Troubleshooting

### Server won't start

- **"ADMIN_USER, ADMIN_PASS, and JWT_SECRET must be set"** — Add these to your `.env` file.
- **Firebase initialization fails** — Check that `firebase-service-account.json` exists or `FIREBASE_SERVICE_ACCOUNT` is set correctly. Ensure Firestore is created in the Firebase Console.
- **Firestore connection FAILED** — Visit the link in the error message and create the database if it doesn't exist.

### Dashboard shows demo mode / no live data

- The device is not connected to MQTT. Check the ESP32 Serial Monitor — it should print `[MQTT] Connected` and start publishing sensor data.
- Verify the MQTT broker and topic prefix match between the server `.env` and the firmware NVS values.

### ESP32 cannot connect to WiFi

- Hold `GPIO 14` button for 3 seconds at boot to reset WiFi and re-open the captive portal.

### Food level reads wrong

- Recalibrate `HOPPER_FULL_CM` and `HOPPER_EMPTY_CM` with the Serial Monitor (see [Hopper Ultrasonic Calibration](#hopper-ultrasonic-calibration)).

### Scale weight is inaccurate

- Adjust `calibration_factor` in `firmware.ino` until the reported weight matches a known reference weight.

### OTA update fails

- Ensure `FIRMWARE_VERSION` in `firmware.ino` matches the version in `firmware/version.json` after an update (mismatch causes a boot-loop).
- Verify the `OTA_VERSION_URL` is reachable from the device.

---

## License

MIT
