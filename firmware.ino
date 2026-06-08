#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include "HX711.h"

// --- NETWORK CONFIG ---
const char* ssid = "wifi";
const char* password = "password";
const char* mqtt_server = "broker.hivemq.com"; 

// --- PIN ASSIGNMENTS ---
#define SERVO_PIN         13 
#define TRIG_PIN          5  
#define ECHO_PIN          18 
#define IR_PIN            19 
#define BUZZER_PIN        4  
#define STATUS_LED_PIN    2   
#define ALERT_LED_PIN     15  
#define BUTTON_PIN        14   // Added for manual dispense button

// --- SETTINGS & GLOBALS ---
#define IR_JAM_STATE      LOW 
const int targetWeight = 50; 
const int emptyThreshold = 10; 
const float bowlHasFoodThreshold = 10.0; 
const int jamTimeout = 1500; 

bool systemJammed = false; 
float lastDispensedWeight = 0.0; 
bool lastDispenseSuccessful = false;
int lastValidLevel = 72; 

unsigned long lastAutoFeedTime = 0;
const unsigned long feedCooldown = 60000;

// --- LOAD CELL CONFIG ---
#define LOADCELL_DOUT_PIN 21
#define LOADCELL_SCK_PIN 22
HX711 scale;
float currentBowlWeight = 0.0;

WiFiClient espClient;
PubSubClient client(espClient);
Servo feederServo;

int getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000); 
  return (duration * 0.034 / 2);
}

void setup() {
  Serial.begin(115200);
  pinMode(IR_PIN, INPUT_PULLUP);
  pinMode(BUTTON_PIN, INPUT_PULLUP); // Setup manual dispense button
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(ALERT_LED_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  scale.tare();

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print("."); 
    digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN)); 
  }
  
  digitalWrite(STATUS_LED_PIN, HIGH); 
  Serial.println("\n✅ Wi-Fi Connected. System Ready."); 

  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);

  ESP32PWM::allocateTimer(0);
  feederServo.attach(SERVO_PIN, 500, 2400);
  feederServo.write(0); 
}

void triggerFlowchartAlert(String message) {
  Serial.println(message);
  digitalWrite(ALERT_LED_PIN, HIGH);
  for(int i=0; i<3; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    delay(200);
  }
  StaticJsonDocument<200> doc;
  doc["alert_message"] = message;
  char buffer[256];
  serializeJson(doc, buffer);
  client.publish("pawfeed/karyl/alerts", buffer);
}

// --- MQTT COMMANDS ---
void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<200> doc;
  deserializeJson(doc, payload, length);
  
  if (String(doc["action"]) == "feed") {
    systemJammed = false; 
    digitalWrite(ALERT_LED_PIN, LOW);
    dispenseByWeight(); 
  } 
  else if (String(doc["action"]) == "empty") {
    scale.tare();
    Serial.println("🐕 ACTION: Scale tared. Bowl is now empty (0.0g).");
    sendTelemetry(lastValidLevel);
  }
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  // Manual dispense button check with simple debounce
  static bool lastButtonState = HIGH;
  bool currentButtonState = digitalRead(BUTTON_PIN);
  if (lastButtonState == HIGH && currentButtonState == LOW) {
    Serial.println("BUTTON PRESSED: Manual dispense requested.");
    systemJammed = false;
    digitalWrite(ALERT_LED_PIN, LOW);
    dispenseByWeight();
    delay(200); // Debounce delay
  }
  lastButtonState = currentButtonState;

  int dist = getDistance();
  if (dist > 0 && dist < 200) {
    lastValidLevel = constrain(map(dist, 2, 20, 100, 0), 0, 100);
  }

  static bool stateAlerted = false;

  if (scale.is_ready()) {
    currentBowlWeight = scale.get_units(5); // Read average of 5 readings
  }

  if (lastValidLevel < emptyThreshold) {
    if (!stateAlerted) {
      triggerFlowchartAlert("ABORT: Hopper is empty. Send Refill Alert.");
      stateAlerted = true; 
    }
  } 
  else if (currentBowlWeight > bowlHasFoodThreshold) {
    if (!stateAlerted) {
      triggerFlowchartAlert("STATUS: Food is still present in the pet bowl.");
      stateAlerted = true;
    }
  } 
  else {
    stateAlerted = false; 
    if (millis() - lastAutoFeedTime > feedCooldown && !systemJammed) {
      Serial.println("AUTON: Sensors clear. Automatically Activating Servo...");
      dispenseByWeight();
      lastAutoFeedTime = millis();
    }
  }

  if (digitalRead(IR_PIN) == IR_JAM_STATE) {
    static unsigned long passiveJamStart = millis();
    if (millis() - passiveJamStart > 3000) {
      if (!systemJammed) Serial.println("PASSIVE JAM DETECTED!");
      systemJammed = true;
    }
  }

  if (lastValidLevel < emptyThreshold || systemJammed) {
    digitalWrite(ALERT_LED_PIN, HIGH); 
  } else {
    digitalWrite(ALERT_LED_PIN, LOW); 
  }

  static unsigned long lastUpdate = 0;
  if (millis() - lastUpdate > 10000) { 
    lastUpdate = millis();
    sendTelemetry(lastValidLevel);
  }
}

// --- WEIGHT DISPENSING ---
void dispenseByWeight() {
  Serial.println("ACTIVATE SERVO MOTOR...");
  digitalWrite(BUZZER_PIN, HIGH);
  delay(300);
  digitalWrite(BUZZER_PIN, LOW);

  scale.tare(); // Tare the actual scale
  feederServo.write(90); 

  float currentWeight = 0;
  unsigned long irBlockStartTime = 0;
  unsigned long dispenseStartTime = millis(); 
  bool isIrBlocked = false;
  unsigned long lastPrintTime = millis();

  while (currentWeight < targetWeight) { 
    
    if (millis() - dispenseStartTime > 15000) {
      Serial.println("TIMEOUT: Terminating dispense.");
      break;
    }

    // --- LOADCELL LOGIC ---
    if (scale.is_ready()) {
      currentWeight = scale.get_units(1); // Read raw weight value
    }

    if (millis() - lastPrintTime > 200) {
      lastPrintTime = millis();
      Serial.print("Current Bowl Weight: ");
      Serial.print(currentWeight);
      Serial.println("g");
    }
    
    // --- JAM DETECTION PROCESS PHASE FLOWCHART ---
    if (digitalRead(IR_PIN) == IR_JAM_STATE) { 
      if (!isIrBlocked) {
        isIrBlocked = true;
        irBlockStartTime = millis(); 
      } else if (millis() - irBlockStartTime > jamTimeout) {
          Serial.println("JAM DETECTED: Executing Anti-Jam Sequence...");
          feederServo.write(0); 
          delay(1000);
          systemJammed = true; 
          triggerFlowchartAlert("CRITICAL FAULT: Mechanical Jam Detected.");
          break; 
      }
    } else {
      isIrBlocked = false; 
    }
    delay(50); 
  }

  if (!systemJammed) {
    feederServo.write(0); 
  }
  
  Serial.println("Stop Servo Motor. Allowing scale to settle...");
  delay(1500); 
  
  // Update last dispensed weight
  currentBowlWeight = currentWeight;
  lastDispensedWeight = currentWeight;

  if (lastDispensedWeight >= (targetWeight - 2.0)) {
    lastDispenseSuccessful = true;
    Serial.print("✅ VERIFIED: Successfully dispensed ");
  } else {
    lastDispenseSuccessful = false;
    Serial.print("❌ INCOMPLETE: Only dispensed ");
  }
  Serial.print(lastDispensedWeight);
  Serial.println("g.");

  sendTelemetry(lastValidLevel); 
}

void sendTelemetry(int level) {
  StaticJsonDocument<256> doc;
  doc["food_level"] = level;
  doc["jammed"] = systemJammed; 
  doc["last_dispensed_g"] = lastDispensedWeight; 
  doc["dispense_success"] = lastDispenseSuccessful;
  doc["bowl_weight"] = currentBowlWeight; // Send actual weight to dashboard

  char buffer[256];
  serializeJson(doc, buffer);
  client.publish("pawfeed/karyl/sensor", buffer);
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect("PawCareClient-karyl")) {
      client.subscribe("pawfeed/karyl/command");
    } else { delay(5000); }
  }
}
