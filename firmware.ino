#include <WiFi.h>
#include <WiFiManager.h>          // tzapu/WiFiManager  — install via Library Manager
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include "HX711.h"
#include <Preferences.h>          // Built-in ESP32 NVS — stores custom params

// =============================================================================
//  MQTT CONFIG  —  stored in NVS, editable via the captive-portal config page
// =============================================================================
// Defaults used only on first boot (before any values are saved to flash)
#define DEFAULT_MQTT_SERVER  "broker.hivemq.com"
#define DEFAULT_MQTT_PORT    "1883"
#define DEFAULT_MQTT_USER    "pawfeed/device01"  // used as topic prefix

char mqtt_server[64]  = DEFAULT_MQTT_SERVER;
int  mqtt_port        = 1883;
char topic_prefix[64] = DEFAULT_MQTT_USER;   // e.g. "pawfeed/device01"

// Topics built at runtime from topic_prefix
char TOPIC_SENSOR[80];
char TOPIC_STATUS[80];
char TOPIC_CMD[80];
char TOPIC_ALERTS[80];

// Unique client-ID — avoids broker kick-outs if multiple devices share the broker
const char* mqtt_client_id = "PawCareClient-device01";

// =============================================================================
//  PIN ASSIGNMENTS
// =============================================================================
#define SERVO_PIN         13
#define TRIG_PIN           5
#define ECHO_PIN          18
#define IR_PIN            19
#define BUZZER_PIN         4
#define STATUS_LED_PIN     2
#define ALERT_LED_PIN     15
#define BUTTON_PIN        14   // manual dispense button  /  hold on boot = WiFi reset
#define LOADCELL_DOUT_PIN 21
#define LOADCELL_SCK_PIN  22

// =============================================================================
//  SETTINGS & GLOBALS
// =============================================================================
#define IR_JAM_STATE      LOW

float calibration_factor     = 399.0; // Official calibration factor
int   targetWeight           = 100;   // grams — overridden by portion_g from dashboard
const int   emptyThreshold   = 10;    // % level below which hopper is "empty"
const int   jamTimeout       = 1500;  // ms IR blocked before jam is declared

bool  systemJammed           = false;
float lastDispensedWeight    = 0.0;
bool  lastDispenseSuccessful = false;
int   lastValidLevel         = 72;    // hopper fill level (%)
float currentBowlWeight      = 0.0;   // Keep variable for telemetry
float driftOffset            = 0.0;   // Auto-Zero Tracking software offset
bool  triggerDashboardFeed   = false;

unsigned long lastAutoFeedTime = 0;
const unsigned long feedCooldown = 60000; // ms between feeds

// =============================================================================
//  OBJECTS
// =============================================================================
WiFiClient   espClient;
PubSubClient client(espClient);
Servo        feederServo;
HX711        scale;
Preferences  prefs;

// =============================================================================
//  NVS HELPERS  —  persist custom MQTT settings across reboots
// =============================================================================

/** Load mqtt_server, mqtt_port, and topic_prefix from NVS flash. */
void loadPreferences() {
  prefs.begin("pawcare", true); // read-only namespace
  String srv = prefs.getString("mqtt_srv", DEFAULT_MQTT_SERVER);
  int    prt = prefs.getInt   ("mqtt_port", 1883);
  String pfx = prefs.getString("topic_pfx", DEFAULT_MQTT_USER);
  prefs.end();

  srv.toCharArray(mqtt_server,  sizeof(mqtt_server));
  mqtt_port = prt;
  pfx.toCharArray(topic_prefix, sizeof(topic_prefix));
}

/** Save current mqtt_server, mqtt_port, and topic_prefix to NVS flash. */
void savePreferences() {
  prefs.begin("pawcare", false); // read-write
  prefs.putString("mqtt_srv",  mqtt_server);
  prefs.putInt   ("mqtt_port", mqtt_port);
  prefs.putString("topic_pfx", topic_prefix);
  prefs.end();
}

/** Build topic strings from the (possibly updated) topic_prefix. */
void buildTopics() {
  snprintf(TOPIC_SENSOR, sizeof(TOPIC_SENSOR), "%s/sensor",  topic_prefix);
  snprintf(TOPIC_STATUS, sizeof(TOPIC_STATUS), "%s/status",  topic_prefix);
  snprintf(TOPIC_CMD,    sizeof(TOPIC_CMD),    "%s/command", topic_prefix);
  snprintf(TOPIC_ALERTS, sizeof(TOPIC_ALERTS), "%s/alerts",  topic_prefix);

  Serial.printf("[MQTT] Topics: sensor=%s  cmd=%s\n", TOPIC_SENSOR, TOPIC_CMD);
}

// =============================================================================
//  WIFI MANAGER SETUP
// =============================================================================

/**
 * Start WiFiManager.
 *
 * On the captive-portal page the user can set:
 *   • SSID / Password  (built into WiFiManager)
 *   • MQTT Server
 *   • MQTT Port
 *   • Topic Prefix    (e.g.  pawfeed/device01)
 *
 * Credentials are saved by WiFiManager in its own flash region;
 * our custom params are saved to NVS via savePreferences().
 */
void startWiFiManager(bool forceConfig = false) {
  // Custom parameters shown in the captive-portal
  WiFiManagerParameter p_mqtt_srv ("mqtt_server", "MQTT Server",      mqtt_server,  63);
  WiFiManagerParameter p_mqtt_port("mqtt_port",   "MQTT Port",        DEFAULT_MQTT_PORT, 5);
  WiFiManagerParameter p_topic_pfx("topic_pfx",   "Topic Prefix",     topic_prefix, 63);

  WiFiManager wm;

  // Optional: timeout the portal after 3 minutes of inactivity
  wm.setConfigPortalTimeout(180);

  // Blink status LED while the portal is open
  wm.setAPCallback([](WiFiManager*) {
    Serial.println("[WiFiManager] Config portal open. Connect to AP: PawCare-Setup");
    // Fast blink to signal portal mode
    for (int i = 0; i < 6; i++) {
      digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
      delay(150);
    }
  });

  wm.addParameter(&p_mqtt_srv);
  wm.addParameter(&p_mqtt_port);
  wm.addParameter(&p_topic_pfx);

  bool connected;
  if (forceConfig) {
    // Erase saved WiFi creds and reopen portal unconditionally
    wm.resetSettings();
    connected = wm.startConfigPortal("PawCare-Setup", "pawcare123");
  } else {
    // Try saved creds; open portal only if they fail
    connected = wm.autoConnect("PawCare-Setup", "pawcare123");
  }

  if (!connected) {
    Serial.println("[WiFi] Failed to connect — rebooting in 3s.");
    delay(3000);
    ESP.restart();
  }

  // Copy updated custom params back into our char arrays
  strncpy(mqtt_server,  p_mqtt_srv.getValue(),  sizeof(mqtt_server)  - 1);
  mqtt_port = atoi(p_mqtt_port.getValue());
  strncpy(topic_prefix, p_topic_pfx.getValue(), sizeof(topic_prefix) - 1);

  savePreferences(); // persist to NVS

  Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  digitalWrite(STATUS_LED_PIN, HIGH);
}

// =============================================================================
//  HELPERS
// =============================================================================

/** HC-SR04 ultrasonic distance (cm). Returns 0 on timeout. */
int getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  
  // Read the echo pin, timeout after 30000 microseconds (30ms)
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  
  if (duration > 0) {
    return (duration * 0.034) / 2;
  }
  return 0;
}

/** Buzz + LED alert, then publish an alert message to the dashboard. */
void triggerFlowchartAlert(String message) {
  Serial.println("[ALERT] " + message);
  digitalWrite(ALERT_LED_PIN, HIGH);
  StaticJsonDocument<256> doc;
  doc["alert_message"] = message;
  char buffer[256];
  serializeJson(doc, buffer);
  client.publish(TOPIC_ALERTS, buffer);
}

/** Publish full sensor telemetry so the dashboard stays in sync. */
void sendTelemetry(int level) {
  StaticJsonDocument<256> doc;
  doc["food_level"]        = level;
  doc["jammed"]            = systemJammed;
  doc["last_dispensed_g"]  = lastDispensedWeight;
  doc["dispense_success"]  = lastDispenseSuccessful;
  doc["bowl_weight"]       = currentBowlWeight;
  char buffer[256];
  serializeJson(doc, buffer);
  client.publish(TOPIC_SENSOR, buffer);
  Serial.printf("[MQTT] Telemetry → food_level=%d%% bowl=%.1fg jammed=%d\n",
                level, currentBowlWeight, systemJammed);
}

/** Publish a brief online/ready status on first connect so the server knows
 *  the device is alive even before the first sensor cycle. */
void sendOnlineStatus() {
  StaticJsonDocument<128> doc;
  doc["food_level"]  = lastValidLevel;
  doc["jammed"]      = systemJammed;
  doc["online"]      = true;
  char buffer[128];
  serializeJson(doc, buffer);
  client.publish(TOPIC_STATUS, buffer);
  Serial.println("[MQTT] Online status published.");
}

// =============================================================================
//  DISPENSING (WEIGHT-BASED)
// =============================================================================

/**
 * Spin the servo and dispense food until the target weight is reached via the load cell.
 * Performs active jam detection via the IR sensor.
 */
void dispenseByWeight() {
  Serial.printf("[Dispense] Target: %dg  — Activating servo (weight-based)...\n", targetWeight);

  // Play double beep before dispensing
  for (int i = 0; i < 2; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
  }

  float startingWeight = currentBowlWeight; 
  if (scale.is_ready()) {
    startingWeight = scale.get_units(3) - driftOffset;
  }
  float targetAbsoluteWeight = startingWeight + targetWeight;

  feederServo.write(90);

  float         currentWeight      = startingWeight;
  unsigned long irBlockStartTime   = 0;
  unsigned long dispenseStartTime  = millis();
  bool          isIrBlocked        = false;

  while (currentWeight < targetAbsoluteWeight) {
    // Hard timeout — prevents infinite loop
    if (millis() - dispenseStartTime > 15000) {
      Serial.println("[Dispense] TIMEOUT — stopping.");
      break;
    }

    if (scale.is_ready()) {
      currentWeight = scale.get_units(1) - driftOffset; // Read current weight
    }

    // Jam detection
    if (digitalRead(IR_PIN) == IR_JAM_STATE) {
      if (!isIrBlocked) {
        isIrBlocked      = true;
        irBlockStartTime = millis();
      } else if (millis() - irBlockStartTime > jamTimeout) {
        Serial.println("[JAM] Anti-jam sequence triggered.");
        feederServo.write(0);
        delay(1000);
        feederServo.write(90);
        delay(1000);
        
        if (digitalRead(IR_PIN) == IR_JAM_STATE) {
          systemJammed = true;
          triggerFlowchartAlert("CRITICAL FAULT: Mechanical Jam Detected.");
          break;
        } else {
          isIrBlocked = false;
        }
      }
    } else {
      isIrBlocked = false;
    }

    client.loop(); // Keep MQTT alive

    // Periodically push telemetry so dashboard doesn't time out
    static unsigned long lastDispenseTelemetry = 0;
    if (millis() - lastDispenseTelemetry > 3000) {
      lastDispenseTelemetry = millis();
      currentBowlWeight = currentWeight; // Live update for dashboard
      sendTelemetry(lastValidLevel);
    }

    delay(50);
  }

  feederServo.write(0);

  Serial.println("[Dispense] Servo stopped — settling...");
  delay(1500);

  if (scale.is_ready()) {
    currentBowlWeight = scale.get_units(5) - driftOffset; // get average over 5 readings
    lastDispensedWeight = currentBowlWeight - startingWeight;
  } else {
    lastDispensedWeight = currentWeight - startingWeight;
  }

  if (lastDispensedWeight < 0) lastDispensedWeight = 0; // sanity check

  if (lastDispensedWeight >= (targetWeight - 2.0)) {
    lastDispenseSuccessful = true;
    Serial.printf("[Dispense] ✓ Success: %.1fg dispensed.\n", lastDispensedWeight);
  } else {
    lastDispenseSuccessful = false;
    Serial.printf("[Dispense] ✗ Incomplete: %.1fg dispensed. Jam detected or timeout.\n", lastDispensedWeight);
  }

  // Immediately push result so the dashboard shows updated data
  sendTelemetry(lastValidLevel);
}

// =============================================================================
//  MQTT CALLBACK  —  receives commands from the dashboard
// =============================================================================
void callback(char* topic, byte* payload, unsigned int length) {
  Serial.printf("[MQTT] ← %s\n", topic);

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.println("[MQTT] Bad JSON — ignoring.");
    return;
  }

  String action = doc["action"] | "";

  if (action == "feed") {
    // Dashboard sends portion_g; fall back to current targetWeight if absent
    if (doc.containsKey("portion_g")) {
      targetWeight = doc["portion_g"].as<int>();
    }
    Serial.printf("[CMD] Feed command received — portion_g=%dg\n", targetWeight);
    triggerDashboardFeed = true; // Set the flag and exit the callback quickly!

  } else if (action == "empty" || action == "tare") {
    // Bowl was manually emptied via dashboard
    scale.tare(); // Physically zero out the scale
    driftOffset          = 0.0;
    currentBowlWeight    = 0.0;
    lastDispensedWeight  = 0.0;
    Serial.println("[CMD] Bowl marked as empty. Scale tared.");
    sendTelemetry(lastValidLevel);

  } else {
    Serial.printf("[CMD] Unknown action: %s\n", action.c_str());
  }
}

// =============================================================================
//  MQTT RECONNECT
// =============================================================================
void reconnect() {
  int attempts = 0;
  while (!client.connected()) {
    Serial.print("[MQTT] Connecting...");
    // Use a unique client-id to avoid broker kicking stale sessions
    String cid = String(mqtt_client_id) + "-" + String(millis());
    if (client.connect(cid.c_str())) {
      Serial.println(" connected.");
      client.subscribe(TOPIC_CMD, 1);   // QoS 1 — at-least-once delivery
      sendOnlineStatus();               // tell dashboard we are live

      // Double beep on successful connection
      digitalWrite(BUZZER_PIN, HIGH); delay(100);
      digitalWrite(BUZZER_PIN, LOW);  delay(100);
      digitalWrite(BUZZER_PIN, HIGH); delay(100);
      digitalWrite(BUZZER_PIN, LOW);
    } else {
      Serial.printf(" failed (rc=%d). Retry in 5s\n", client.state());
      // Blink status LED while waiting
      for (int i = 0; i < 10; i++) {
        digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
        delay(500);
      }
      attempts++;
      if (attempts >= 5) {
        Serial.println("[MQTT] Too many failures — rebooting.");
        ESP.restart();
      }
    }
  }
}

// =============================================================================
//  SETUP
// =============================================================================
void setup() {
  Serial.begin(115200);

  pinMode(IR_PIN,         INPUT_PULLUP);
  pinMode(BUTTON_PIN,     INPUT_PULLUP);
  pinMode(BUZZER_PIN,     OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(ALERT_LED_PIN,  OUTPUT);
  pinMode(TRIG_PIN,       OUTPUT);
  pinMode(ECHO_PIN,       INPUT);

  // ── Load saved MQTT settings from NVS ──────────────────────────────────────
  loadPreferences();

  // ── WiFi — hold BUTTON on boot for 3 s to force re-configuration ───────────
  bool forcePortal = false;
  Serial.println("[WiFi] Hold button now to enter WiFi setup mode...");
  unsigned long holdStart = millis();
  while (millis() - holdStart < 3000) {
    if (digitalRead(BUTTON_PIN) == LOW) {
      forcePortal = true;
      Serial.println("[WiFi] Button held — will open config portal.");
      // Triple beep to confirm portal mode will start
      for (int i = 0; i < 3; i++) {
        digitalWrite(BUZZER_PIN, HIGH); delay(80);
        digitalWrite(BUZZER_PIN, LOW);  delay(80);
      }
      break;
    }
    delay(50);
  }

  startWiFiManager(forcePortal);
  buildTopics();

  // ── MQTT ───────────────────────────────────────────────────────────────────
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(60);      // seconds — keeps connection alive

  // ── Servo ──────────────────────────────────────────────────────────────────
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  feederServo.setPeriodHertz(50);
  feederServo.attach(SERVO_PIN, 500, 2400);
  feederServo.write(0);

  // ── Load Cell ──────────────────────────────────────────────────────────────
  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  scale.set_scale(calibration_factor);
  
  // Give the HX711 a second to wake up and stabilize
  delay(1000);
  
  // Tare the scale so the empty bowl equals 0.00g
  scale.tare(); 

  Serial.println("[System] PawCare firmware ready.");
}

// =============================================================================
//  MAIN LOOP
// =============================================================================
void loop() {
  // ── MQTT keepalive ──────────────────────────────────────────────────────────
  if (!client.connected()) reconnect();
  client.loop();

  // ── Manual dispense button (with debounce) ──────────────────────────────────
  static bool lastButtonState = HIGH;
  bool currentButtonState = digitalRead(BUTTON_PIN);
  if (lastButtonState == HIGH && currentButtonState == LOW) {
    Serial.println("[BTN] Manual dispense pressed.");
    targetWeight = 100; 
    triggerDashboardFeed = true; // Route the physical button to the same flag
    delay(200);
  }
  lastButtonState = currentButtonState;

  // ── Execute Feed ────────────────────────────────────────────────────────────
  if (triggerDashboardFeed) {
    systemJammed = false;
    digitalWrite(ALERT_LED_PIN, LOW);
    dispenseByWeight();
    triggerDashboardFeed = false; // Reset flag after dispensing
  }

  // ── Ultrasonic hopper level ─────────────────────────────────────────────────
  int dist = getDistance();
  static int sensorFailCount = 0;
  static bool sensorAlerted = false;

  if (dist > 0 && dist < 200) {
    lastValidLevel = constrain(map(dist, 2, 20, 100, 0), 0, 100);
    sensorFailCount = 0;
    sensorAlerted = false;
  } else {
    sensorFailCount++;
    if (sensorFailCount >= 15 && !sensorAlerted) {
      lastValidLevel = 0;
      triggerFlowchartAlert("SENSOR FAULT: Ultrasonic Sensor Not Connected.");
      sensorAlerted = true;
    }
    if (sensorFailCount > 1000) sensorFailCount = 15; // prevent overflow
  }

  // ── State machine / alerts ──────────────────────────────────────────────────
  static bool stateAlerted = false;

  if (lastValidLevel < emptyThreshold) {
    if (!stateAlerted && !sensorAlerted) {
      triggerFlowchartAlert("ABORT: Hopper is empty. Send Refill Alert.");
      stateAlerted = true;
    }
  } else {
    stateAlerted = false;
    // Note: Autonomous feeding based on bowl empty state has been disabled 
    // because the load cell was removed. It now relies purely on schedule/manual feed.
  }

  // ── Passive jam & Auto-Clear ────────────────────────────────────────────────
  static unsigned long passiveJamStart = 0;
  static bool isIrBlockedPassive = false;

  if (digitalRead(IR_PIN) == IR_JAM_STATE) {
    if (!isIrBlockedPassive) {
      isIrBlockedPassive = true;
      passiveJamStart = millis();
    } else if (millis() - passiveJamStart > 3000) {
      if (!systemJammed) {
        Serial.println("[JAM] Passive jam detected!");
        systemJammed = true;
        triggerFlowchartAlert("CRITICAL FAULT: Mechanical Jam Detected.");
      }
    }
  } else {
    isIrBlockedPassive = false;
    // Auto-clear jam if the blockage is physically removed
    if (systemJammed) {
      Serial.println("[JAM] Blockage cleared. System automatically recovered.");
      systemJammed = false;
      sendTelemetry(lastValidLevel);
    }
  }

  // ── Alert LED sync ──────────────────────────────────────────────────────────
  digitalWrite(ALERT_LED_PIN,
    (lastValidLevel < emptyThreshold || systemJammed) ? HIGH : LOW);

  // ── Update Load Cell Reading ────────────────────────────────────────────────
  if (scale.is_ready()) {
    float rawWeight = scale.get_units(5); // Read accurate weight, averaged over 5 readings
    
    // Auto-Zero Tracking (AZT)
    float adjustedWeight = rawWeight - driftOffset;
    
    // If the weight is between -3g and +3g, it's likely just drift/crumbs
    if (abs(adjustedWeight) < 3.0) {
      // Slowly pull the offset towards the raw weight to absorb the drift
      driftOffset += adjustedWeight * 0.1;
      currentBowlWeight = 0.0; // Snap to 0 for telemetry
    } else {
      currentBowlWeight = adjustedWeight;
    }
  }

  // ── Non-blocking Jam Buzzer ─────────────────────────────────────────────────
  if (systemJammed) {
    static unsigned long lastBuzzTime = 0;
    static bool buzzerState = false;
    if (millis() - lastBuzzTime > 300) {
      lastBuzzTime = millis();
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }

  // ── Periodic telemetry push (every 10 s) ───────────────────────────────────
  static unsigned long lastUpdate = 0;
  if (millis() - lastUpdate > 10000) {
    lastUpdate = millis();
    sendTelemetry(lastValidLevel);
  }
}
