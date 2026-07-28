#include <WiFi.h>
#include <WiFiManager.h>          // tzapu/WiFiManager  — install via Library Manager
#include <PubSubClient.h>
#include <ArduinoJson.h>
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
#define BUZZER_CHANNEL     0
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
//  NON-BLOCKING BUZZER
// =============================================================================
int buzzerRemainingBeeps = 0;
unsigned long buzzerNextToggle = 0;
bool buzzerIsOn = false;
int buzzerCurrentDuration = 100;

void startBeeps(int count, int duration_ms) {
    buzzerRemainingBeeps = count * 2; // on and off phases
    buzzerCurrentDuration = duration_ms;
    buzzerNextToggle = millis();
}

void handleBuzzer() {
    if (buzzerRemainingBeeps > 0) {
        if (millis() >= buzzerNextToggle) {
            buzzerNextToggle = millis() + buzzerCurrentDuration;
            buzzerIsOn = !buzzerIsOn;
            if (buzzerIsOn) {
                ledcWriteTone(BUZZER_PIN, 2000); // 2kHz
            } else {
                ledcWriteTone(BUZZER_PIN, 0);
            }
            buzzerRemainingBeeps--;
            if (buzzerRemainingBeeps == 0) {
                buzzerIsOn = false;
                ledcWriteTone(BUZZER_PIN, 0);
            }
        }
    }
}

// =============================================================================
//  HTTP OTA CONFIG
// =============================================================================
// Bump FIRMWARE_VERSION whenever you build a new binary to deploy.
// Host version.json and firmware.bin at OTA_VERSION_URL / OTA_BIN_URL.
// Example version.json: {"version":"1.0.1","url":"https://yoursite.com/firmware/firmware.bin"}
#define FIRMWARE_VERSION  "1.2.9"
#define OTA_VERSION_URL   "https://pawcare-rcd9.onrender.com/firmware/version.json"

// ISRG Root X1 (Let's Encrypt Root CA)
const char* ISRG_ROOT_X1 = \
"-----BEGIN CERTIFICATE-----\n" \
"MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRnXubJIVcwAwDQYJKoZIhvcNAQELBQAw\n" \
"TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\n" \
"cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\n" \
"WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\n" \
"ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\n" \
"MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJ1yOObpPeYaUKQXp\n" \
"UaZJBPjRcdR/4Z3T9m6iHwFp9o8X9xYc0d5M9v8s4Q6sZ4c6n7x8x9u0c8Y0U6b1\n" \
"w0X7P6H6u4Y7Y8w4d5x0Q7b0X7X8s7H6V9W5P1Z8b7M8T8L6y9b7y2J7H9H9B7\n" \
"x3A6Q3G8q5Z5J5z2G2C3E2Z0N1B9A1L4E3E5Z9M9T0V1A3L8V9C8P5M0Z9Z5E1\n" \
"o4K7H9L7x5z0P4M5F0X1w8B8P9K3A5K0Z8H5A3Y8x7L0F8y2E1T5M6A9o5T3K1\n" \
"x6N1F2H9O5Q0T3N5K0A8C9Q4A3G2K6C4T1M9F5H0G7L2A5Q1N3M9E3B4F0B7H0\n" \
"H8H2A0F5M1D8Z0G8D2Y0N5M6J9K2L1B8N4B0Y9K4N3L7E2A9B0Y5E0B6H5M1A0\n" \
"z2Z7J9F2M1Q4C5Q0D7A9F5H1H2Y0G9N6K8A5T1E9D7C3F8N4M8Y1D9A0N6T7H3\n" \
"w0G2E6B3T0Y0N1C9J7M9F1D3K6B8E3G9A3Z4J6F2Z4Y9T6F9K9M1Q1J6G7T5Y3\n" \
"h4X9F8L8L9H6L4E9K9M0A3M5M0K6T5F5E4E3A9D9K0E8L4G6T8Z5T1D8J5Z9T3\n" \
"N9K8G5T0H3J8A8L0F6T5C9H3N9F1C3J7C5D1K3B4K3A7T5F5M6Z4L4H0A2A1A5\n" \
"x2D6B7B4E5F6N4Y9K3M7C4G1Q8E6K4H1M8A7G0L3B4J5B2E8Z2C8A7N9G4H7J8\n" \
"b0B2D4Y7J6C6T6T9Z3T3M9K4N0D9F6H4G8D9K0G3T0Y5M7L9F1N9K7B0M6E4N3\n" \
"i9E8A9H8L8M9K0A3F1F8D9G4K3H9E3G9D4F0E4D5J1F4D3C5C3B4Z1D7B4B7T0\n" \
"v2L4D2G0J1D6G3L8G8E3D7D5E8B9K0H7B0D3L5A0M3E0G1A5E0M2T7M6Z4N9K8\n" \
"K1D2T6L4A8T1Y9N6D0E9A8H8G7D3B0K8G6J1F8B8B5F6C6E4E9Z2A4J7C6N1E2\n" \
"j2B3H7J1E7L2J8Z3D1A5H9F7C2H3L6J1M0L9C8J7B6K3C1T8D7E6J4B8G5F5H8\n" \
"M2Z5E3E6T4L8H7E0F7C9N8G4A7E8D3K1N4A9L2G9A6L5Z5Z3D5N0F6N4M6D8C0\n" \
"T7Z8N8C2N0N9C4G7A8H8E4A0F9D2G7Z2C2L6G8E1G5T8Z4A0G8C0E8H2T7N0A5\n" \
"O1D8Z0L4A8A5N3M8C3B4L3B3E7A0Z1L9E4H9L1D3Z3L1T2C7F7A2C0M2B2M6B0\n" \
"MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRnXubJIVcwAwDQYJKoZIhvcNAQELBQAw\n" \
"-----END CERTIFICATE-----\n";


// How to trigger: send {"action":"ota_update"} via MQTT from the dashboard.
bool triggerOTACheck = false; // set true by MQTT command to trigger a check

float calibration_factor     = 418.95; // Official calibration factor
int   targetWeight           = 45;   // grams — overridden by portion_g from dashboard
const int   emptyThreshold   = 10;    // % level below which hopper is "empty"
const int   jamTimeout       = 1500;  // ms IR blocked before jam is declared

// ── Ultrasonic sensor calibration ──────────────────────────────────────────────
// HOPPER_FULL_CM  = distance (cm) from sensor to food surface when hopper is FULL.
//                   Food touching the mesh causes timeouts (dist==0), handled separately.
//                   Set this to the first stable non-zero reading you see when full (~2-4 cm).
// HOPPER_EMPTY_CM = distance (cm) from sensor to hopper bottom when COMPLETELY EMPTY.
//                   Measured value: sensor reads ~11 cm when hopper is fully empty.
//                   (Old value was 20 cm, which caused 50% to show when actually empty.)
//                   To re-calibrate: empty the hopper, open the lid, read from Serial Monitor.
#define HOPPER_FULL_CM   2    // cm — 100% level
#define HOPPER_EMPTY_CM  11   // cm — 0% level  ← corrected from 20 to match actual hopper depth

bool  systemJammed           = false;
float lastDispensedWeight    = 0.0;
bool  lastDispenseSuccessful = false;
int   lastValidLevel         = 50;    // hopper fill level (%) — neutral assumption until first sensor read
float currentBowlWeight      = 0.0;   // Keep variable for telemetry
float driftOffset            = 0.0;   // Auto-Zero Tracking software offset
bool  triggerDashboardFeed   = false;
bool  isPhysicalDispense     = false;  // true when dispense was triggered by physical button (not MQTT)
bool  triggerTare            = false;  // deferred tare — set from MQTT callback or button, executed in loop()
bool  g_tareJustFired        = false;  // set by any tare, consumed by load-cell block
unsigned long g_tareFiredAt  = 0;      // millis() timestamp of last tare

// =============================================================================
//  OBJECTS
// =============================================================================
WiFiClient   espClient;
PubSubClient client(espClient);
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
  mqtt_server[sizeof(mqtt_server)   - 1] = '\0'; // guarantee null-termination
  mqtt_port = atoi(p_mqtt_port.getValue());
  strncpy(topic_prefix, p_topic_pfx.getValue(), sizeof(topic_prefix) - 1);
  topic_prefix[sizeof(topic_prefix) - 1] = '\0'; // guarantee null-termination

  savePreferences(); // persist to NVS

  Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  digitalWrite(STATUS_LED_PIN, HIGH);
}

// =============================================================================
//  HELPERS
// =============================================================================

void setServoAngle(int angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  // map 0-180 to 410-1966 for 14-bit 50Hz PWM
  int duty = map(angle, 0, 180, 410, 1966);
  ledcWrite(SERVO_PIN, duty);
}

void openHopper() {
  setServoAngle(SERVO_OPEN);
}

void closeHopper() {
  setServoAngle(SERVO_CLOSED);
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

// FIX #11: Track whether the Alert LED was turned on by a non-state-machine alert
// (e.g. sensor fault) so the main loop can clear it when the fault resolves.
// The state-machine block (L990-991) handles jam / low-food LEDs separately.
unsigned long alertLedOnAt = 0;  // millis() timestamp of last triggerFlowchartAlert()

/** Buzz + LED alert, then publish an alert message to the dashboard. */
void triggerFlowchartAlert(String message) {
  Serial.println("[ALERT] " + message);
  digitalWrite(ALERT_LED_PIN, HIGH);
  alertLedOnAt = millis(); // record when the LED was turned on
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
  doc["fw_version"]        = FIRMWARE_VERSION;
  char buffer[256];
  serializeJson(doc, buffer);
  client.publish(TOPIC_SENSOR, buffer);
  Serial.printf("[MQTT] Telemetry → food_level=%d%% bowl=%.1fg jammed=%d\n",
                level, currentBowlWeight, systemJammed);
}

/** Publish a brief online/ready status on first connect so the server knows
 *  the device is alive even before the first sensor cycle. */
void sendOnlineStatus() {
  StaticJsonDocument<192> doc;
  doc["food_level"]  = lastValidLevel;
  doc["jammed"]      = systemJammed;
  doc["online"]      = true;
  doc["fw_version"]  = FIRMWARE_VERSION;
  char buffer[192];
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

// ── Non-Blocking Dispenser State Machine ───────────────────────────────────
enum DispenseState { DISPENSE_IDLE, DISPENSE_INIT, DISPENSE_SETTLE, DISPENSE_BULK, DISPENSE_TRICKLE_OPEN, DISPENSE_TRICKLE_WAIT, DISPENSE_FINAL_SETTLE, DISPENSE_EVALUATE };
DispenseState dispState = DISPENSE_IDLE;

float         dispStartingWeight = 0.0;
float         dispCurrentWeight = 0.0;
unsigned long dispStartTime = 0;
unsigned long dispMotorSettleTime = 0;
unsigned long dispTrickleTimer = 0;
unsigned long dispJamTimer = 0;
bool          dispIrBlocked = false;
int           dispJamBlockedCount = 0;
unsigned long lastDispenseTelemetry = 0;

void handleDispenser() {
    if (dispState == DISPENSE_IDLE) return;

    // Hard timeout (35 s)
    if (dispState != DISPENSE_IDLE && millis() - dispStartTime > 35000) {
        Serial.println("[Dispense] TIMEOUT — stopping.");
        dispState = DISPENSE_FINAL_SETTLE;
        closeHopper();
        dispTrickleTimer = millis();
        return;
    }

    float dispensed = dispCurrentWeight - dispStartingWeight;
    float remaining = (float)targetWeight - dispensed;

    switch (dispState) {
        case DISPENSE_INIT:
            Serial.printf("[Dispense] Target: %dg  — starting two-phase dispense...\n", targetWeight);
            dispStartingWeight = currentBowlWeight;
            dispCurrentWeight = dispStartingWeight;
            
            startBeeps(2, 100);
            closeHopper();
            
            dispStartTime = millis();
            dispMotorSettleTime = millis();
            dispIrBlocked = false;
            dispState = DISPENSE_SETTLE;
            break;

        case DISPENSE_SETTLE:
            if (millis() - dispMotorSettleTime > 600) { // MOTOR_SETTLE_MS
                dispState = DISPENSE_BULK;
                openHopper();
            }
            break;

        case DISPENSE_BULK:
            dispCurrentWeight = currentBowlWeight;
            
            if (dispensed >= (float)targetWeight * 0.90f) { // TRICKLE_START_PCT
                closeHopper();
                Serial.printf("[Dispense] Phase 2 — trickle at %.1fg (%.0f%% of %dg target)\n",
                              dispensed, 90.0, targetWeight);
                dispState = DISPENSE_TRICKLE_WAIT;
                dispTrickleTimer = millis();
            } else if (millis() - dispMotorSettleTime > 1100 && remaining <= 0.0f) {
                // Exit condition during bulk
                Serial.printf("[Dispense] Target reached in bulk — dispensed %.1fg\n", dispensed);
                dispState = DISPENSE_FINAL_SETTLE;
                closeHopper();
                dispTrickleTimer = millis();
            }
            break;

        case DISPENSE_TRICKLE_OPEN:
            dispCurrentWeight = currentBowlWeight;
            
            if (remaining <= 0.5f) { // IN_FLIGHT_TRICKLE_G
                Serial.printf("[Dispense] Target reached in trickle — dispensed %.1fg\n", dispensed);
                dispState = DISPENSE_FINAL_SETTLE;
                closeHopper();
                dispTrickleTimer = millis();
            } else if (millis() - dispTrickleTimer > 40) { // TRICKLE_OPEN_MS
                closeHopper();
                dispState = DISPENSE_TRICKLE_WAIT;
                dispTrickleTimer = millis();
            }
            break;

        case DISPENSE_TRICKLE_WAIT:
            dispCurrentWeight = currentBowlWeight;
            
            if (remaining <= 0.5f) {
                Serial.printf("[Dispense] Target reached in trickle wait — dispensed %.1fg\n", dispensed);
                dispState = DISPENSE_FINAL_SETTLE;
                closeHopper();
                dispTrickleTimer = millis();
            } else if (millis() - dispTrickleTimer > 350) { // TRICKLE_CLOSE_MS
                openHopper();
                dispState = DISPENSE_TRICKLE_OPEN;
                dispTrickleTimer = millis();
            }
            break;

        case DISPENSE_FINAL_SETTLE:
            if (millis() - dispTrickleTimer > 1500) {
                dispState = DISPENSE_EVALUATE;
            }
            break;
            
        case DISPENSE_EVALUATE:
            lastDispensedWeight = currentBowlWeight - dispStartingWeight;
            
            if (lastDispensedWeight < 0) lastDispensedWeight = 0;
            
            if (lastDispensedWeight >= (targetWeight - 3.0)) {
                lastDispenseSuccessful = true;
                Serial.printf("[Dispense] Success: %.1fg dispensed (target %dg, error %.1fg)\n",
                              lastDispensedWeight, targetWeight, lastDispensedWeight - targetWeight);
            } else {
                lastDispenseSuccessful = false;
                Serial.printf("[Dispense] Incomplete: %.1fg dispensed. Jam or timeout.\n", lastDispensedWeight);
            }
            
            sendTelemetry(lastValidLevel);
            dispState = DISPENSE_IDLE;
            break;
    }

    // ── Jam detection (only when dispensing) ──
    static float dispJamLastWeight = 0;

    if (dispState == DISPENSE_BULK || dispState == DISPENSE_TRICKLE_OPEN || dispState == DISPENSE_TRICKLE_WAIT) {
        if (digitalRead(IR_PIN) == LOW) { // IR_JAM_STATE
            dispJamBlockedCount++;
            if (dispJamBlockedCount >= 5) {
                if (!dispIrBlocked) {
                    dispIrBlocked = true;
                    dispJamTimer = millis();
                    dispJamLastWeight = currentBowlWeight;
                } else if (millis() - dispJamTimer > 1500) { // jamTimeout
                    if (currentBowlWeight - dispJamLastWeight > 0.5) {
                        // False positive: food is flowing normally (weight increasing). Reset timer.
                        dispJamTimer = millis();
                        dispJamLastWeight = currentBowlWeight;
                    } else {
                        Serial.println("[JAM] Anti-jam sequence triggered.");
                        closeHopper();
                        delay(800); // Give servo time to crush any kibble in the gate
                        if (digitalRead(IR_PIN) == LOW) {
                            systemJammed = true;
                            triggerFlowchartAlert("CRITICAL FAULT: Mechanical Jam Detected.");
                            dispState = DISPENSE_FINAL_SETTLE; // abort
                            closeHopper();
                            dispTrickleTimer = millis();
                        } else {
                            Serial.println("[JAM] Blockage cleared. Resuming dispense.");
                            dispIrBlocked = false;
                            dispJamBlockedCount = 0;
                            if (dispState == DISPENSE_BULK || dispState == DISPENSE_TRICKLE_OPEN) {
                                openHopper();
                            }
                        }
                    }
                }
            }
        } else {
            dispJamBlockedCount = 0;
            dispIrBlocked = false;
        }
    }

    // Periodically push live telemetry
    if (dispState != DISPENSE_IDLE && millis() - lastDispenseTelemetry > 3000) {
        lastDispenseTelemetry = millis();
        currentBowlWeight = dispCurrentWeight;
        sendTelemetry(lastValidLevel);
    }

    static unsigned long lastDebugPrint = 0;
    if ((dispState == DISPENSE_BULK || dispState == DISPENSE_TRICKLE_OPEN || dispState == DISPENSE_TRICKLE_WAIT) && millis() - lastDebugPrint >= 500) {
        lastDebugPrint = millis();
        float dispensed = currentBowlWeight - dispStartingWeight;
        Serial.printf("[Debug] Dispensing... dispensed: %.1fg (currentBowlWeight: %.1fg, target: %dg)\n", dispensed, currentBowlWeight, targetWeight);
    }
}

void dispenseByWeight() {
    dispState = DISPENSE_INIT; // Starts the state machine
    dispStartTime = millis();  // Reset start time to prevent immediate timeout
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
void publishOtaStatus(const char* status, const char* version, const char* error) {
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

void publishOtaStatus(const char* status, const char* version) {
  publishOtaStatus(status, version, "");
}

void publishOtaStatus(const char* status) {
  publishOtaStatus(status, "", "");
}

void checkForOTAUpdate() {
  Serial.println("[OTA] Checking for firmware update...");
  publishOtaStatus("checking");

  WiFiClientSecure secureClient;
  secureClient.setInsecure(); // Bypass SSL certificate validation for OTA

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
  startBeeps(1, 300);

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
      startBeeps(3, 80);
      
      ESP.restart(); // Now it's safe to reboot
      break;
    case HTTP_UPDATE_FAILED: {
      String errMsg = httpUpdate.getLastErrorString();
      Serial.printf("[OTA] ✗ Update failed: %s\n", errMsg.c_str());
      publishOtaStatus("failed", "", errMsg.c_str());
      // Two short beeps: failure
      startBeeps(2, 100);
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
    // Defer the actual tare to the main loop — scale.tare() blocks for ~1 s
    // and must not run inside the MQTT callback (network task context).
    triggerTare = true;
    Serial.println("[CMD] Tare requested via MQTT — queued for main loop.");

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
  if (client.connected()) {
    // FIX #4: Reset the failure counter whenever we confirm we are connected.
    // Without this, a board that reconnected after 4 failures starts the next
    // WiFi outage with counter = 4 and reboots on the very first retry.
    reconnectAttempts = 0;
    return;
  }

  if (millis() - lastReconnectAttempt > 5000) {
    lastReconnectAttempt = millis();
    Serial.print("[MQTT] Connecting...");
    String cid = String(mqtt_client_id) + "-" + WiFi.macAddress();
    
    // Set LWT (Last Will and Testament)
    if (client.connect(cid.c_str(), TOPIC_STATUS, 1, true, "{\"online\":false}")) {
      Serial.println(" connected.");
      client.subscribe(TOPIC_CMD, 1);
      sendOnlineStatus();
      reconnectAttempts = 0;

      startBeeps(2, 100);
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
  ledcAttach(BUZZER_PIN, 2000, 8);
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
      startBeeps(3, 80);
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
  ledcAttach(SERVO_PIN, 50, 14);
  closeHopper(); // Start at CLOSED (90°) — the idle/default position
  // NOTE: If the servo still twitches at the very moment of power-on, that is a
  // hardware bootloader issue. Add a 10 kΩ pull-down resistor on the signal wire
  // to hold the pin LOW before the ESP32 firmware takes control.
  delay(500);          // Give servo time to reach center

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
  handleDispenser();

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
  static bool          lastRawButtonState = HIGH;
  static bool          lastDebouncedState = HIGH;
  static bool          buttonHeld       = false;
  static unsigned long buttonPressTime  = 0;
  static bool          tareArmed        = false;   // tare pending on release
  const  unsigned long TARE_HOLD_MS     = 2000;    // hold duration for tare

  static unsigned long lastDebounceTime = 0;
  bool rawButtonState = digitalRead(BUTTON_PIN);
  
  if (rawButtonState != lastRawButtonState) {
    lastDebounceTime = millis();
  }
  
  bool currentButtonState = lastDebouncedState;
  if ((millis() - lastDebounceTime) > 50) {
    currentButtonState = rawButtonState;
  }
  lastRawButtonState = rawButtonState;

  if (lastDebouncedState == HIGH && currentButtonState == LOW) {
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
      startBeeps(1, 300);
    }
  }

  if (lastDebouncedState == LOW && currentButtonState == HIGH) {
    // ── Button just released ────────────────────────────────────────────────
    buttonHeld = false;
    if (tareArmed) {
      // ── LONG HOLD: queue the tare ─────────────────────────────────────────
      Serial.println("[BTN] Long hold detected — queuing tare.");
      triggerTare = true; // defer to main loop for safe execution
      tareArmed   = false;

    } else {
      // ── SHORT PRESS: manual dispense ─────────────────────────────────────
      Serial.println("[BTN] Short press — manual dispense.");
      targetWeight         = 45;
      triggerDashboardFeed = true;
      isPhysicalDispense   = true; // mark as physical so TOPIC_FEED_LOG is published
    }
  }

  lastDebouncedState = currentButtonState;

  // ── Execute Tare (deferred from MQTT callback or button long-hold) ─────────
  if (triggerTare) {
    triggerTare = false;
    Serial.println("[TARE] Executing deferred tare...");
    
    // Do NOT guard this with scale.is_ready(). The HX711 only signals ready 
    // for a tiny fraction of a second at 10Hz. scale.tare() is a blocking call
    // that inherently waits for the chip to become ready to take its samples.
    scale.tare();               // Zero the HX711 — takes ~800 ms (safe here in loop)
    driftOffset         = 0.0;
    currentBowlWeight   = 0.0;
    lastDispensedWeight = 0.0;
    g_tareJustFired     = true; // Flushes the rolling average in the load-cell block
    g_tareFiredAt       = millis();
    Serial.println("[TARE] Scale tared OK.");

    // Triple beep + LED flash as confirmation
    for (int i = 0; i < 3; i++) {
      digitalWrite(BUZZER_PIN,     HIGH);
      digitalWrite(STATUS_LED_PIN, LOW);
      delay(100);
      digitalWrite(BUZZER_PIN,     LOW);
      digitalWrite(STATUS_LED_PIN, HIGH);
      delay(100);
    }
    sendTelemetry(lastValidLevel);
  }

  // ── Execute Feed ────────────────────────────────────────────────────────────
  if (triggerDashboardFeed) {
    bool wasPhysical     = isPhysicalDispense; // capture before resetting
    isPhysicalDispense   = false;
    systemJammed         = false;
    digitalWrite(ALERT_LED_PIN, LOW);
    dispenseByWeight();
    triggerDashboardFeed = false;

    // Only publish TOPIC_FEED_LOG for physical button presses.
    // Dashboard/MQTT-triggered feeds are already logged by the server at command time,
    // so publishing here too would create duplicate Firestore records.
    if (wasPhysical) {
      StaticJsonDocument<128> feedDoc;
      feedDoc["portion_g"] = lastDispensedWeight > 0 ? (int)round(lastDispensedWeight) : targetWeight;
      feedDoc["type"]      = "physical";
      char feedBuf[128];
      serializeJson(feedDoc, feedBuf);
      client.publish(TOPIC_FEED_LOG, feedBuf);
    }
  }

  // ── Ultrasonic hopper level ─────────────────────────────────────────────────
  // Calibration constants are defined at the top of the file as:
  //   #define HOPPER_FULL_CM  2   (adjust if needed)
  //   #define HOPPER_EMPTY_CM 20  (measure your hopper depth and update)

  int dist = getDistance(); // median of 3 pings
  static int  sensorFailCount    = 0;
  static bool sensorAlerted      = false;
  static int  lastValidDist      = HOPPER_FULL_CM; // Assume full on boot
  // Change-guard counters: require N consecutive identical conclusions
  // before committing a level change. Prevents dispensing turbulence from
  // causing a momentary 0% spike.
  static int  zeroConfirmCount   = 0;  // consecutive timeouts leaning toward empty
  static int  fullConfirmCount   = 0;  // consecutive timeouts leaning toward full
  static const int CONFIRM_NEEDED = 5; // raised from 3 — needs 5 consecutive timeouts before committing

  if (dist == 0) {
    // Timeout (dist == 0): two cases —
    //   A) Food is touching or very close to the sensor mesh → sensor cannot echo → full
    //   B) Hopper is empty and the angled plastic bottom scatters the pulse → empty
    // Use the last valid measured distance as a hint.
    if (lastValidDist <= HOPPER_FULL_CM + 2) {
      // Last reading was very short = food was near the top = likely still full
      fullConfirmCount++;
      zeroConfirmCount = 0;
      if (fullConfirmCount >= CONFIRM_NEEDED) {
        lastValidLevel = 100;
        fullConfirmCount = CONFIRM_NEEDED; // clamp
      }
    } else {
      // Last reading was far away = food was low = lean toward empty, but hold level
      // until CONFIRM_NEEDED consecutive timeouts confirm it
      zeroConfirmCount++;
      fullConfirmCount = 0;
      if (zeroConfirmCount >= CONFIRM_NEEDED) {
        lastValidLevel = 0;
        zeroConfirmCount = CONFIRM_NEEDED; // clamp
      }
      // Not yet confirmed — keep displaying the last good level
    }
    sensorFailCount = 0;
    sensorAlerted   = false;
  } else if (dist > 0 && dist < 200) {
    // Good reading — map distance to percentage and update immediately
    lastValidDist    = dist;
    // map(): short distance (food near top) = high %, long distance (food low) = low %
    lastValidLevel   = constrain(map(dist, HOPPER_FULL_CM, HOPPER_EMPTY_CM, 100, 0), 0, 100);
    zeroConfirmCount = 0;
    fullConfirmCount = 0;
    sensorFailCount  = 0;
    sensorAlerted    = false;
  } else {
    // Reading is out of expected range (>= 200 cm) — likely electrical noise
    sensorFailCount++;
    if (sensorFailCount >= 15 && !sensorAlerted) {
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
  static int irBlockedCount = 0;
  static const int IR_JAM_DEBOUNCE_READINGS = 20;

  if (digitalRead(IR_PIN) == IR_JAM_STATE) {
    irBlockedCount++;
    if (irBlockedCount >= IR_JAM_DEBOUNCE_READINGS) {
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
    }
  } else {
    irBlockedCount = 0;
    if (isIrBlockedPassive) {
      isIrBlockedPassive = false;
      // Auto-clear jam if the blockage is physically removed
      if (systemJammed) {
        Serial.println("[JAM] Blockage cleared. System automatically recovered.");
        systemJammed = false;
        sendTelemetry(lastValidLevel);
      }
    }
  }

  // ── Alert LED sync ──────────────────────────────────────────────────────────
  // FIX #11 continued: If the LED was turned on by a sensor-fault alert (not a
  // jam or empty-hopper state), auto-extinguish it after 10 s so it doesn't
  // stay on permanently after the fault clears.
  bool ledShouldBeOn = (lastValidLevel < emptyThreshold || systemJammed);
  if (!ledShouldBeOn && alertLedOnAt > 0 && (millis() - alertLedOnAt < 10000)) {
    ledShouldBeOn = true; // keep it on for the alert grace period
  } else if (!ledShouldBeOn && alertLedOnAt > 0 && (millis() - alertLedOnAt >= 10000)) {
    alertLedOnAt = 0; // grace period expired — allow it to turn off
  }
  digitalWrite(ALERT_LED_PIN, ledShouldBeOn ? HIGH : LOW);

  // ── Update Load Cell Reading ────────────────────────────────────────────────
  // Defined here (outside both branches) so it is accessible to the else-if below.
  const unsigned long TARE_SETTLE_MS = 1000; // HX711 settle window after a tare
  if (scale.is_ready()) {
    // 3-sample median filter + EMA to aggressively reject spikes (like sudden 0s)
    static float samples[3] = {0,0,0};
    static int sIdx = 0;

    float newVal = scale.get_units(1);

    if (g_tareJustFired) {
      for (int i = 0; i < 3; i++) samples[i] = newVal;
      sIdx = 0;
    }

    samples[sIdx] = newVal;
    sIdx = (sIdx + 1) % 3;
    
    // Find median
    float s0 = samples[0], s1 = samples[1], s2 = samples[2];
    if (s0 > s1) { float t = s0; s0 = s1; s1 = t; }
    if (s1 > s2) { float t = s1; s1 = s2; s2 = t; }
    if (s0 > s1) { float t = s0; s0 = s1; s1 = t; }
    
    float medianWeight = s1;
    
    // EMA smoothing
    static float smoothedWeight = 0;
    if (g_tareJustFired) smoothedWeight = medianWeight;
    smoothedWeight = (0.6 * medianWeight) + (0.4 * smoothedWeight);
    
    float rawWeight = smoothedWeight;
    
    // Auto-Zero Tracking (AZT)
    // Skip for TARE_SETTLE_MS after a tare — HX711 needs time to settle and we don't
    // want noise spikes > 5 g to immediately overwrite currentBowlWeight.
    if (g_tareJustFired && (millis() - g_tareFiredAt < TARE_SETTLE_MS)) {
      currentBowlWeight = 0.0; // hold at zero during settle window
    } else {
      g_tareJustFired = false; // settle window expired

      float adjustedWeight = rawWeight - driftOffset;
      
      if (dispState == DISPENSE_IDLE) {
        // If the weight is between -5g and +5g, it's likely just drift/crumbs
        if (abs(adjustedWeight) < 5.0) {
          // Slowly pull the offset towards the raw weight to absorb the drift
          driftOffset += adjustedWeight * 0.1;
          currentBowlWeight = 0.0; // Snap to 0 for telemetry
        } else {
          currentBowlWeight = adjustedWeight;
        }
      } else {
        currentBowlWeight = medianWeight - driftOffset;
      }
    }
  } else if (g_tareJustFired && (millis() - g_tareFiredAt >= TARE_SETTLE_MS)) {
    // Scale was not ready throughout the settle window — clear the flag anyway
    // so it does not permanently block the load-cell block from running.
    g_tareJustFired = false;
  }

  // ── Non-blocking Jam Buzzer ─────────────────────────────────────────────────
  if (systemJammed) {
    /*
    static unsigned long lastBuzzTime = 0;
    static bool buzzerState = false;
    if (millis() - lastBuzzTime > 300) {
      lastBuzzTime = millis();
      buzzerState = !buzzerState;
      if (buzzerState) {
        ledcWriteTone(BUZZER_PIN, 2000);
      } else {
        ledcWriteTone(BUZZER_PIN, 0);
      }
    }
    */
  }
  handleBuzzer(); // Handle general async beeps


  // ── Periodic telemetry push (every 4 s) ───────────────────────────────────
  static unsigned long lastUpdate = 0;
  if (millis() - lastUpdate > 4000) {
    lastUpdate = millis();
    sendTelemetry(lastValidLevel);
  }
}
