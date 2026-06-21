#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include "HX711.h"

// =============================================================================
//  NETWORK CONFIG  —  update these to match your environment
// =============================================================================
const char* ssid          = "wifi";
const char* password      = "password";

// MQTT broker: must match MQTT_BROKER in your server .env
// If running the Node server locally use its LAN IP, e.g. "192.168.1.100"
// If using the public HiveMQ broker keep "broker.hivemq.com"
const char* mqtt_server   = "broker.hivemq.com";
const int   mqtt_port     = 1883;

// ── MQTT Topics  (must match MQTT_TOPIC_* in server .env / server.js) ────────
const char* TOPIC_SENSOR  = "pawfeed/karyl/sensor";   // firmware  → server
const char* TOPIC_STATUS  = "pawfeed/karyl/status";   // firmware  → server (on connect)
const char* TOPIC_CMD     = "pawfeed/karyl/command";  // server    → firmware
const char* TOPIC_ALERTS  = "pawfeed/karyl/alerts";   // firmware  → server (alerts)

// Unique client-ID — avoids broker kick-outs if multiple devices share the broker
const char* mqtt_client_id = "PawCareClient-karyl";

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
#define BUTTON_PIN        14   // manual dispense button
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
  // This completely bypasses the need for an ISR
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
//  DISPENSING (TIME-BASED ESTIMATION)
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

  // Wi-Fi
  Serial.printf("[WiFi] Connecting to %s", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
  }
  digitalWrite(STATUS_LED_PIN, HIGH);
  Serial.printf("\n[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());

  // MQTT
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(60);      // seconds — keeps connection alive

  // Servo
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  feederServo.setPeriodHertz(50);
  feederServo.attach(SERVO_PIN, 500, 2400);
  feederServo.write(0);

  // Load Cell
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
