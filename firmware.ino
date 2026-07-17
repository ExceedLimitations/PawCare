#include <WiFi.h>
#include <WiFiManager.h>          // tzapu/WiFiManager  — install via Library Manager
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include "HX711.h"
#include <Preferences.h>          // Built-in ESP32 NVS — stores custom params
#include <HTTPUpdate.h>             // HTTP OTA firmware updates
#include <WiFiClientSecure.h>       // HTTPS support for OTA download

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
char TOPIC_FEED_LOG[80];
char TOPIC_OTA_STATUS[80]; // Publishes OTA progress to the dashboard

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
#define SERVO_CLOSED       90  // Closed position for dispensing gate — straight ahead (servo neutral)
#define SERVO_OPEN         20  // Full-open position — 70° from neutral (food falls)

// =============================================================================
//  HTTP OTA CONFIG
// =============================================================================
// Bump FIRMWARE_VERSION whenever you build a new binary to deploy.
// Host version.json and firmware.bin at OTA_VERSION_URL / OTA_BIN_URL.
// Example version.json: {"version":"1.0.1","url":"https://yoursite.com/firmware/firmware.bin"}
#define FIRMWARE_VERSION  "1.1.0"
#define OTA_VERSION_URL   "https://pawcare-rcd9.onrender.com/firmware/version.json"

// How to trigger: send {"action":"ota_update"} via MQTT from the dashboard.
bool triggerOTACheck = false; // set true by MQTT command to trigger a check

float calibration_factor     = 418.95; // Official calibration factor
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
  snprintf(TOPIC_SENSOR,     sizeof(TOPIC_SENSOR),     "%s/sensor",     topic_prefix);
  snprintf(TOPIC_STATUS,     sizeof(TOPIC_STATUS),     "%s/status",     topic_prefix);
  snprintf(TOPIC_CMD,        sizeof(TOPIC_CMD),        "%s/command",    topic_prefix);
  snprintf(TOPIC_ALERTS,     sizeof(TOPIC_ALERTS),     "%s/alerts",     topic_prefix);
  snprintf(TOPIC_FEED_LOG,   sizeof(TOPIC_FEED_LOG),   "%s/feed_log",   topic_prefix);
  snprintf(TOPIC_OTA_STATUS, sizeof(TOPIC_OTA_STATUS), "%s/ota_status", topic_prefix);

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

void openHopper() {
  feederServo.write(SERVO_OPEN);
}

void closeHopper() {
  feederServo.write(SERVO_CLOSED);
}

/** Single HC-SR04 ping — returns distance in cm, or 0 on timeout. */
int pingOnce() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration > 0) return (int)((duration * 0.034) / 2);
  return 0;
}

/**
 * HC-SR04 distance with 3-sample median filter.
 * Takes three pings 10 ms apart and returns the median value.
 * Eliminates single-shot spikes caused by vibration, pouring
 * turbulence, or acoustic interference.
 */
int getDistance() {
  int s[3];
  for (int i = 0; i < 3; i++) {
    s[i] = pingOnce();
    delay(10); // inter-ping gap — sensor needs ~8 ms to reset
  }
  // Simple sort of 3 elements then return middle
  if (s[0] > s[1]) { int t = s[0]; s[0] = s[1]; s[1] = t; }
  if (s[1] > s[2]) { int t = s[1]; s[1] = s[2]; s[2] = t; }
  if (s[0] > s[1]) { int t = s[0]; s[0] = s[1]; s[1] = t; }
  return s[1]; // median
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

  // Read the baseline weight BEFORE attaching the servo.
  // This avoids HX711 noise from the motor's inrush current corrupting the baseline.
  float startingWeight = currentBowlWeight;
  if (scale.is_ready()) {
    startingWeight = scale.get_units(5) - driftOffset; // 5 samples for a stable baseline
  }
  float targetAbsoluteWeight = startingWeight + targetWeight;

  // Re-attach servo just before use — it was detached while idle to prevent
  // WiFi radio noise from causing slow unintended rotation.
  feederServo.attach(SERVO_PIN, 500, 2400);
  // Brief pre-charge pause: lets the 1000µF capacitor refill on the VIN rail
  // before the servo draws inrush current. Reduces voltage sag at startup.
  delay(80);
  feederServo.write(SERVO_OPEN);

  // Motor startup blackout: the servo motor's inrush current (and VIN rail sag)
  // makes the HX711 read falsely high for up to ~1 s after startup.
  // If we read the scale during this window, 'remaining' collapses and the dispense
  // jumps straight into trickle mode (looks like 'servo turns slowly').
  // Extended to 1200 ms to cover slower cap recharge times on marginal supplies.
  const unsigned long MOTOR_SETTLE_MS  = 1200;
  // Outlier filter: maximum plausible weight change per 50 ms loop cycle.
  // Anything larger is a VIN-sag spike from the HX711 — reject it.
  const float         MAX_WEIGHT_DELTA = 15.0; // grams

  float         currentWeight      = startingWeight;
  unsigned long irBlockStartTime   = 0;
  unsigned long dispenseStartTime  = millis();
  bool          isIrBlocked        = false;

  while (true) {
    float remaining = targetAbsoluteWeight - currentWeight;

    // 1. In-Flight Compensation (stop early to account for kibble in the air)
    // Raised to 3.0g to better account for kibble already airborne during trickle.
    if (remaining <= 3.0) {
      Serial.println("[Dispense] Target reached (including in-flight offset).");
      break;
    }

    // Hard timeout — 35s to allow for the slower, more precise trickle phase
    if (millis() - dispenseStartTime > 35000) {
      Serial.println("[Dispense] TIMEOUT — stopping.");
      break;
    }

    if (scale.is_ready() && (millis() - dispenseStartTime > MOTOR_SETTLE_MS)) {
      // Take 3 samples in trickle phase for a more stable reading near target
      int samples = (remaining <= 15.0) ? 3 : 1;
      float newWeight = scale.get_units(samples) - driftOffset;

      // Outlier filter: reject readings that jump implausibly fast —
      // these are caused by VIN rail voltage sag from servo inrush current
      // corrupting the HX711 ADC. Keep the last known-good value instead.
      if (abs(newWeight - currentWeight) <= MAX_WEIGHT_DELTA) {
        currentWeight = newWeight;
      } else {
        Serial.printf("[Dispense] Scale spike ignored: %.1fg -> %.1fg (delta %.1fg)\n",
                      currentWeight, newWeight, abs(newWeight - currentWeight));
      }
    }

    // 2. Trickle Feed for Gram-Level Accuracy
    if (remaining > 15.0) {
      // Full speed phase until we are 15g away
      openHopper();
    } else {
      // Trickle phase: very short pulses to drop ~1 kibble at a time.
      // 35ms open, 765ms closed (800ms total cycle).
      // Shorter open window means fewer kibbles per pulse and less overshoot.
      // The long closed period lets the scale settle before the next read.
      unsigned long cycle = (millis() - dispenseStartTime) % 800;
      if (cycle < 35) {
        openHopper();
      } else {
        closeHopper(); // Return to closed (idle) between trickle pulses
      }
    }

    // Jam detection
    if (digitalRead(IR_PIN) == IR_JAM_STATE) {
      if (!isIrBlocked) {
        isIrBlocked      = true;
        irBlockStartTime = millis();
      } else if (millis() - irBlockStartTime > jamTimeout) {
        Serial.println("[JAM] Anti-jam sequence triggered.");
        closeHopper(); // Return to closed before re-opening
        delay(1000);
        openHopper();
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

  closeHopper(); // Return servo to closed (idle/default) position

  Serial.println("[Dispense] Servo returned to closed — settling...");
  delay(1500); // Wait for servo to fully close and scale to settle

  feederServo.detach(); // Detach again — no more PWM until next dispense

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
//  HTTP OTA UPDATE
// =============================================================================
/**
 * Checks the hosted version.json manifest.
 * If the reported version differs from FIRMWARE_VERSION, downloads and
 * flashes the new binary.  The device reboots automatically on success.
 */
/** Publish a short OTA status update so the dashboard can show live progress. */
void publishOtaStatus(const char* status, const char* version = "", const char* error = "") {
  StaticJsonDocument<128> doc;
  doc["status"]  = status;
  if (strlen(version) > 0) doc["version"] = version;
  if (strlen(error)   > 0) doc["error"]   = error;
  char buf[128];
  serializeJson(doc, buf);
  
  // Publish live status without retaining it
  client.publish(TOPIC_OTA_STATUS, buf, false); 
  
  // Clear any old retained messages from the broker on terminal states
  if (strcmp(status, "success") == 0 || strcmp(status, "failed") == 0 || strcmp(status, "up_to_date") == 0) {
    client.publish(TOPIC_OTA_STATUS, "", true);
  }

  client.loop(); // flush immediately
}

void checkForOTAUpdate() {
  Serial.println("[OTA] Checking for firmware update...");
  publishOtaStatus("checking");

  WiFiClientSecure secureClient;
  secureClient.setInsecure(); // Skip cert validation — acceptable for private use.
                              // For production, set a root CA cert instead.

  HTTPClient http;
  http.begin(secureClient, OTA_VERSION_URL);
  int code = http.GET();

  if (code != 200) {
    Serial.printf("[OTA] Version check failed (HTTP %d). Skipping.\n", code);
    publishOtaStatus("failed", "", ("HTTP " + String(code)).c_str());
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload) != DeserializationError::Ok) {
    Serial.println("[OTA] Bad version.json — skipping.");
    return;
  }

  String remoteVersion = doc["version"] | "";
  String binUrl        = doc["url"]     | "";

  Serial.printf("[OTA] Device: %s  |  Available: %s\n",
                FIRMWARE_VERSION, remoteVersion.c_str());

  if (remoteVersion == FIRMWARE_VERSION || binUrl.isEmpty()) {
    Serial.println("[OTA] Firmware is up to date.");
    publishOtaStatus("up_to_date", FIRMWARE_VERSION);
    return;
  }

  // New version available — start flashing
  Serial.printf("[OTA] Updating to %s from:\n  %s\n",
                remoteVersion.c_str(), binUrl.c_str());
  publishOtaStatus("downloading", remoteVersion.c_str());

  // Single long beep: update starting
  digitalWrite(BUZZER_PIN, HIGH); delay(300); digitalWrite(BUZZER_PIN, LOW);

  // Disable auto-reboot so we can publish the success message via MQTT first
  httpUpdate.rebootOnUpdate(false);
  httpUpdate.setLedPin(STATUS_LED_PIN, LOW); // Blink status LED during flash
  t_httpUpdate_return result = httpUpdate.update(secureClient, binUrl);

  switch (result) {
    case HTTP_UPDATE_OK:
      Serial.println("[OTA] ✓ Update successful — rebooting.");
      publishOtaStatus("success", remoteVersion.c_str());
      
      // Give the network stack time to actually send the MQTT packet before rebooting
      delay(500); 

      // Triple beep on success
      for (int i = 0; i < 3; i++) {
        digitalWrite(BUZZER_PIN, HIGH); delay(80);
        digitalWrite(BUZZER_PIN, LOW);  delay(80);
      }
      
      ESP.restart(); // Now it's safe to reboot
      break;
    case HTTP_UPDATE_FAILED: {
      String errMsg = httpUpdate.getLastErrorString();
      Serial.printf("[OTA] ✗ Update failed: %s\n", errMsg.c_str());
      publishOtaStatus("failed", "", errMsg.c_str());
      // Two short beeps: failure
      for (int i = 0; i < 2; i++) {
        digitalWrite(BUZZER_PIN, HIGH); delay(100);
        digitalWrite(BUZZER_PIN, LOW);  delay(100);
      }
      break;
    }
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] No update needed (server agrees).");
      publishOtaStatus("up_to_date", FIRMWARE_VERSION);
      break;
  }
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

  } else if (action == "ota_update") {
    // Dashboard or remote trigger — queue an immediate OTA check
    Serial.println("[CMD] OTA update requested via MQTT.");
    triggerOTACheck = true;

  } else {
    Serial.printf("[CMD] Unknown action: %s\n", action.c_str());
  }
}

// =============================================================================
//  MQTT RECONNECT
// =============================================================================
unsigned long lastReconnectAttempt = 0;
int reconnectAttempts = 0;

void reconnect() {
  if (client.connected()) return;

  if (millis() - lastReconnectAttempt > 5000) {
    lastReconnectAttempt = millis();
    Serial.print("[MQTT] Connecting...");
    String cid = String(mqtt_client_id) + "-" + String(millis());
    
    // Set LWT (Last Will and Testament)
    if (client.connect(cid.c_str(), TOPIC_STATUS, 1, true, "{\"online\":false}")) {
      Serial.println(" connected.");
      client.subscribe(TOPIC_CMD, 1);
      sendOnlineStatus();
      reconnectAttempts = 0;

      digitalWrite(BUZZER_PIN, HIGH); delay(100);
      digitalWrite(BUZZER_PIN, LOW);  delay(100);
      digitalWrite(BUZZER_PIN, HIGH); delay(100);
      digitalWrite(BUZZER_PIN, LOW);
    } else {
      Serial.printf(" failed (rc=%d). Retry in 5s\n", client.state());
      reconnectAttempts++;
      if (reconnectAttempts >= 5) {
        Serial.println("[MQTT] Too many failures — rebooting.");
        ESP.restart();
      }
    }
  }

  // Blink status LED while waiting
  static unsigned long lastBlink = 0;
  if (millis() - lastBlink > 500) {
    lastBlink = millis();
    digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
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

  // Servo initialization is delayed until AFTER WiFi connects to prevent RF interference.


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

  // ── HTTP OTA ────────────────────────────────────────────────────────────────
  // Triggered via MQTT: {"action":"ota_update"} from the dashboard.
  Serial.printf("[OTA] HTTP OTA ready. Firmware: %s  (MQTT-triggered only)\n", FIRMWARE_VERSION);

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
  closeHopper(); // Start at CLOSED (90°) — the idle/default position
  // NOTE: If the servo still twitches at the very moment of power-on, that is a
  // hardware bootloader issue. Add a 10 kΩ pull-down resistor on the signal wire
  // to hold the pin LOW before the ESP32 firmware takes control.
  delay(500);          // Give servo time to reach center
  feederServo.detach(); // Detach so WiFi radio noise can't drive the servo while idle

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
  // ── HTTP OTA — triggered by MQTT command only ─────────────────────────────────
  // Send {"action":"ota_update"} from the dashboard to flash new firmware.
  if (triggerOTACheck) {
    triggerOTACheck = false;
    checkForOTAUpdate();
  }

  // ── MQTT keepalive ──────────────────────────────────────────────────────────
  if (!client.connected()) {
    reconnect();
  } else {
    digitalWrite(STATUS_LED_PIN, HIGH); // Solid when connected
  }
  client.loop();

  // ── Button: short press = dispense | hold ≥2 s = tare scale ────────────────
  //
  //  SHORT PRESS  (< 2 000 ms)  → manual 100 g dispense  (unchanged behaviour)
  //  LONG HOLD    (≥ 2 000 ms)  → re-tare the load cell
  //    Use case: you forgot to place the bowl before boot and the scale is
  //    reading the bowl weight as food weight.  Place the empty bowl, then
  //    hold the button for 2 s to zero the scale with the bowl in place.
  //
  static bool          lastButtonState  = HIGH;
  static bool          buttonHeld       = false;
  static unsigned long buttonPressTime  = 0;
  static bool          tareArmed        = false;   // tare pending on release
  const  unsigned long TARE_HOLD_MS     = 2000;    // hold duration for tare

  bool currentButtonState = digitalRead(BUTTON_PIN);

  if (lastButtonState == HIGH && currentButtonState == LOW) {
    // ── Button just pressed ─────────────────────────────────────────────────
    buttonPressTime = millis();
    buttonHeld      = true;
    tareArmed       = false;
  }

  if (buttonHeld && currentButtonState == LOW) {
    // ── Button still held — check if we've crossed the tare threshold ───────
    if (!tareArmed && (millis() - buttonPressTime >= TARE_HOLD_MS)) {
      tareArmed = true;
      // Give haptic feedback: single long beep so the user knows tare is queued
      digitalWrite(BUZZER_PIN, HIGH);
      delay(300);
      digitalWrite(BUZZER_PIN, LOW);
    }
  }

  if (lastButtonState == LOW && currentButtonState == HIGH) {
    // ── Button just released ────────────────────────────────────────────────
    unsigned long holdDuration = millis() - buttonPressTime;
    buttonHeld = false;

    if (tareArmed) {
      // ── LONG HOLD: tare the scale ─────────────────────────────────────────
      Serial.println("[BTN] Long hold detected — taring scale.");
      if (scale.is_ready()) {
        scale.tare();
        driftOffset       = 0.0;
        currentBowlWeight = 0.0;
        Serial.println("[TARE] Scale tared successfully (bowl weight zeroed).");

        // Triple beep + LED flash as confirmation
        for (int i = 0; i < 3; i++) {
          digitalWrite(BUZZER_PIN,    HIGH);
          digitalWrite(STATUS_LED_PIN, LOW);
          delay(100);
          digitalWrite(BUZZER_PIN,    LOW);
          digitalWrite(STATUS_LED_PIN, HIGH);
          delay(100);
        }

        sendTelemetry(lastValidLevel); // Update dashboard immediately
      } else {
        Serial.println("[TARE] Scale not ready — tare skipped.");
      }
      tareArmed = false;

    } else if (holdDuration < TARE_HOLD_MS) {
      // ── SHORT PRESS: manual dispense ─────────────────────────────────────
      Serial.println("[BTN] Short press — manual dispense.");
      targetWeight         = 100;
      triggerDashboardFeed = true;

      StaticJsonDocument<128> doc;
      doc["portion_g"] = targetWeight;
      doc["type"]      = "physical";
      char buffer[128];
      serializeJson(doc, buffer);
      client.publish(TOPIC_FEED_LOG, buffer);
    }
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
  int dist = getDistance(); // median of 3 pings
  static int  sensorFailCount    = 0;
  static bool sensorAlerted      = false;
  static int  lastValidDist      = 9;  // Assume ~empty on boot
  // Change-guard counters: require N consecutive identical conclusions
  // before updating lastValidLevel. Prevents fast-pour turbulence from
  // causing a momentary 0% reading.
  static int  zeroConfirmCount   = 0;  // consecutive "empty" timeouts
  static int  fullConfirmCount   = 0;  // consecutive "full" timeouts
  static const int CONFIRM_NEEDED = 3; // pings needed to commit a state change

  if (dist == 0) {
    // Timeout: ambiguous — full (kibble at mesh) OR empty (sound scatters).
    // Use last known distance to decide, but only commit after CONFIRM_NEEDED
    // consecutive occurrences so a single turbulence burst is ignored.
    if (lastValidDist <= 4) {
      // Was nearly full → likely touching mesh → probably still full
      fullConfirmCount++;
      zeroConfirmCount = 0;
      if (fullConfirmCount >= CONFIRM_NEEDED) {
        lastValidLevel = 100;
        fullConfirmCount = CONFIRM_NEEDED; // clamp
      }
    } else {
      // Was far from sensor → likely empty
      zeroConfirmCount++;
      fullConfirmCount = 0;
      if (zeroConfirmCount >= CONFIRM_NEEDED) {
        lastValidLevel = 0;
        zeroConfirmCount = CONFIRM_NEEDED; // clamp
      }
      // If not yet confirmed, leave lastValidLevel unchanged (hold last good value)
    }
    sensorFailCount = 0;
    sensorAlerted   = false;
  } else if (dist > 0 && dist < 200) {
    // Good reading — update immediately, reset confirmation counters
    lastValidDist    = dist;
    lastValidLevel   = constrain(map(dist, 2, 9, 100, 0), 0, 100);
    zeroConfirmCount = 0;
    fullConfirmCount = 0;
    sensorFailCount  = 0;
    sensorAlerted    = false;
  } else {
    sensorFailCount++;
    if (sensorFailCount >= 15 && !sensorAlerted) {
      lastValidLevel = 0;
      triggerFlowchartAlert("SENSOR FAULT: Ultrasonic Sensor Error.");
      sensorAlerted = true;
    }
    if (sensorFailCount > 1000) sensorFailCount = 15; // prevent overflow
  }

  // ── State machine / alerts ──────────────────────────────────────────────────
  static bool stateAlerted = false;
  static unsigned long emptyStartTime = 0;
  static unsigned long fullStartTime = 0;

  if (lastValidLevel < emptyThreshold) {
    fullStartTime = 0;
    if (emptyStartTime == 0) emptyStartTime = millis();
    else if (millis() - emptyStartTime > 5000) {
      if (!stateAlerted && !sensorAlerted) {
        triggerFlowchartAlert("ABORT: Hopper is empty. Send Refill Alert.");
        stateAlerted = true;
      }
    }
  } else {
    emptyStartTime = 0;
    if (fullStartTime == 0) fullStartTime = millis();
    else if (millis() - fullStartTime > 5000) {
      stateAlerted = false;
    }
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
    // 1 sample + manual rolling average to avoid blocking loop
    static float weightSamples[5] = {0,0,0,0,0};
    static int sampleIndex = 0;
    weightSamples[sampleIndex] = scale.get_units(1);
    sampleIndex = (sampleIndex + 1) % 5;
    
    float rawWeight = 0;
    for(int i=0; i<5; i++) rawWeight += weightSamples[i];
    rawWeight /= 5.0;
    
    // Auto-Zero Tracking (AZT)
    float adjustedWeight = rawWeight - driftOffset;
    
    // If the weight is between -5g and +5g, it's likely just drift/crumbs
    if (abs(adjustedWeight) < 5.0) {
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

  // ── Periodic telemetry push (every 4 s) ───────────────────────────────────
  static unsigned long lastUpdate = 0;
  if (millis() - lastUpdate > 4000) {
    lastUpdate = millis();
    sendTelemetry(lastValidLevel);
  }
}
