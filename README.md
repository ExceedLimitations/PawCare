# 🐾 PawCare — Smart IoT Pet Feeder Dashboard

A real-time web dashboard for monitoring and controlling an IoT-connected automatic pet feeder. Built with Node.js, Express, Socket.io, and MQTT on the backend and React + Vite on the frontend, with Firebase Firestore as the cloud database, PawCare lets you track food levels, dispense food manually, verify dispensing weight via load cell, and manage automated feeding schedules — all from a browser.

---

## Features

- **Real-time monitoring** — live food level gauge updated via MQTT and Socket.io
- **Manual dispensing** — trigger a food dispense with a configurable portion size from the dashboard
- **Automated schedules** — create and manage custom feeding schedules stored in Firebase Firestore
- **Precise weight dispensing** — verifies food drop exactly to the target weight via a built-in load cell
- **Feeding history** — logs every dispense (manual or scheduled) with timestamps and portion sizes
- **Alerts & notifications** — visual warnings for low food, chute jams, and other hardware events
- **Demo mode** — runs a simulated sensor feed automatically when no hardware is connected

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js, Express 4 |
| Real-time | Socket.io 4 |
| IoT messaging | MQTT 5 (default broker: HiveMQ public) |
| Database | Firebase Firestore (via firebase-admin) |
| Frontend | React 19, Vite 8 |
| Frontend charts | Chart.js 4, react-chartjs-2 |
| Icons | lucide-react |

---

## Project Structure

```
PawCare/
├── server.js                    # Express + Socket.io + MQTT server
├── firebase-service-account.json # Firebase Admin SDK credentials (not committed)
├── firmware.ino                 # ESP32 firmware
├── package.json                 # Server dependencies
├── .env                         # Environment variables (not committed)
├── .env.example                 # Example environment variables
├── netlify.toml                 # Netlify deployment config
└── frontend/               # React + Vite dashboard
    ├── index.html
    ├── vite.config.js
    ├── package.json        # Frontend dependencies
    └── src/
        ├── main.jsx
        ├── App.jsx         # Root component & dashboard logic
        ├── index.css       # Global styles
        ├── components/
        │   └── MetricPanels.jsx
        └── hooks/
            ├── useDashboard.js
            └── useSocket.js
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm

### Installation

```bash
git clone https://github.com/your-username/PawCare.git
cd PawCare
npm install          # install server dependencies
cd frontend
npm install          # install frontend dependencies
```

### Running in Development

Start the backend server and the Vite dev server in two separate terminals:

```bash
# Terminal 1 — backend
npm run dev

# Terminal 2 — frontend
cd frontend
npm run dev
```

The backend runs on [http://localhost:3000](http://localhost:3000) and the frontend dev server proxies API/socket requests to it.

### Building for Production

```bash
cd frontend
npm run build        # outputs to frontend/dist/
```

The Express server serves the built frontend from `frontend/dist/` in production.

---

## Configuration

Create a `.env` file in the project root to override defaults:

```env
PORT=3000
MQTT_BROKER=mqtt://broker.hivemq.com:1883
MQTT_TOPIC_STATUS=pawfeed/status
MQTT_TOPIC_SENSOR=pawfeed/sensor
MQTT_TOPIC_CMD=pawfeed/command
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `MQTT_BROKER` | `mqtt://broker.hivemq.com:1883` | MQTT broker URL |
| `MQTT_TOPIC_STATUS` | `pawfeed/status` | Topic for hardware status updates |
| `MQTT_TOPIC_SENSOR` | `pawfeed/sensor` | Topic for sensor readings |
| `MQTT_TOPIC_CMD` | `pawfeed/command` | Topic for dispense commands sent to hardware |
| `GOOGLE_APPLICATION_CREDENTIALS` | `./firebase-service-account.json` | Path to Firebase Admin SDK service account key |

---

## REST API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/feed` | Trigger a food dispense. Body: `{ "portion": 80, "type": "manual" }` |
| `GET` | `/feedings/today` | Get all feeding records for today |

---

## Hardware Integration

The server publishes dispense commands to `MQTT_TOPIC_CMD` as JSON:

```json
{ "action": "feed", "portion_g": 80 }
```

### Sensor Telemetry

The hardware publishes sensor readings to `MQTT_TOPIC_STATUS` / `MQTT_TOPIC_SENSOR`:

```json
{
  "food_level": 72,
  "jammed": false,
  "last_dispensed_g": 50.1,
  "dispense_success": true
}
```

### ESP32 Pin Configuration

When flashing `firmware.ino` to your ESP32, wire the hardware according to the following mapping:

| Hardware Component | ESP32 Pin | Note |
|---|---|---|
| **Servo Motor (Dispenser)** | `GPIO 13` | Controls chute opening (`ESP32Servo`) |
| **HC-SR04 Ultrasonic (Trigger)** | `GPIO 5` | Checks hopper food level |
| **HC-SR04 Ultrasonic (Echo)** | `GPIO 18` | Use standard 5V→3.3V logic level shift |
| **IR Jam Sensor (FC-51 / Break-beam)** | `GPIO 19` | Detects food blockages (`INPUT_PULLUP`). Polarity customizable via `IR_JAM_STATE`. |
| **HX711 Load Cell (DOUT)** | `GPIO 21` | Scale output |
| **HX711 Load Cell (SCK)** | `GPIO 22` | Scale clock |
| **Piezo Buzzer** | `GPIO 4` | Auditory alerts / dispensing cues |
| **Status LED** | `GPIO 2` | System health indication |
| **Alert/Error LED** | `GPIO 15` | Critical fault warning |

*Note: For the IR Sensor, flip `IR_JAM_STATE` to `HIGH` if utilizing a slot break-beam sensor instead of standard reflectance modules.*

When no hardware is connected, the dashboard automatically enters **demo simulation mode**.

---

## License

MIT
