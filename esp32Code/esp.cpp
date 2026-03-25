#include <WiFi.h>
#include <WebSocketsClient.h>
#include <Wire.h>
#include "MAX30100_PulseOximeter.h"
#include "time.h"
#include <LiquidCrystal_I2C.h>

// ---------------- WIFI ----------------
#define WIFI_SSID "Somil's A35"
#define WIFI_PASS "somil@12"

// ---------------- SERVER ----------------
#define SERVER_IP "10.164.246.30"
#define SERVER_PORT 3000

// ---------------- NTP ----------------
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 19800;
const int daylightOffset_sec = 0;

// ---------------- SENSOR ----------------
#define REPORTING_PERIOD_MS 1000
#define WARMUP_READINGS 10

PulseOximeter pox;
WebSocketsClient webSocket;
LiquidCrystal_I2C lcd(0x27, 16, 2);

uint32_t tsLastReport = 0;
int skipCount = 0;
int zeroCount = 0;

// ---------------- HEARTBEAT ----------------
void onBeatDetected() {
  Serial.println("❤️ Beat detected");
}

// ---------------- WEBSOCKET EVENTS ----------------
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("✅ Connected to Node Server");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Server Connected");
      break;

    case WStype_DISCONNECTED:
      Serial.println("❌ WebSocket Disconnected");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Server Lost...");
      break;

    default:
      break;
  }
}

// ---------------- GET TIME ----------------
String getTimeStamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return "TIME_ERR";
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buffer);
}

// ---------------- SENSOR REINIT ----------------
void reinitSensor() {
  Serial.println("⚠️ Reinitializing sensor...");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Reinit Sensor..");
  pox.begin();
  pox.setIRLedCurrent(MAX30100_LED_CURR_11MA);
  pox.setOnBeatDetectedCallback(onBeatDetected);
  zeroCount = 0;
  skipCount = 0;
}

// ---------------- I2C SCANNER (DEBUG) ----------------
void scanI2C() {
  Serial.println("Scanning I2C bus...");
  for (byte i = 8; i < 120; i++) {
    Wire.beginTransmission(i);
    if (Wire.endTransmission() == 0) {
      Serial.print("✅ I2C Device found at 0x");
      Serial.println(i, HEX);
    }
  }
  Serial.println("I2C Scan Done.");
}

// ================================================
//                     SETUP
// ================================================
void setup() {

  Serial.begin(115200);
  delay(1000);

  // -------- I2C --------
  Wire.begin(21, 22);
  Wire.setClock(100000);

  // -------- I2C SCAN --------
  scanI2C();

  // -------- LCD INIT --------
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Booting...");
  delay(1000);

  // -------- SENSOR INIT --------
  Serial.println("Initializing MAX30100...");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Sensor Init...");

  if (!pox.begin()) {
    Serial.println("❌ MAX30100 NOT DETECTED");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Sensor ERROR!");
    lcd.setCursor(0, 1);
    lcd.print("Check Wiring");
    while (1);
  }

  // ⚠️ Use lower current — 50MA causes saturation on clone boards
  pox.setIRLedCurrent(MAX30100_LED_CURR_11MA);
  pox.setOnBeatDetectedCallback(onBeatDetected);

  Serial.println("✅ MAX30100 Ready");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Sensor Ready");
  delay(1000);

  // -------- WIFI --------
  Serial.print("Connecting WiFi");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi Connect...");

  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int wifiRetry = 0;
  while (WiFi.status() != WL_CONNECTED && wifiRetry < 20) {
    delay(500);
    Serial.print(".");
    wifiRetry++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi Connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Connected");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
    delay(2000);
  } else {
    Serial.println("\n⚠️ WiFi Failed - continuing offline");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Failed");
    lcd.setCursor(0, 1);
    lcd.print("Offline Mode");
    delay(2000);
  }

  // -------- TIME SYNC --------
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Syncing Time");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Syncing Time...");
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    struct tm timeinfo;
    int timeRetry = 0;
    while (!getLocalTime(&timeinfo) && timeRetry < 10) {
      Serial.print(".");
      delay(500);
      timeRetry++;
    }
    Serial.println("\n✅ Time Synced");
  }

  // -------- WEBSOCKET --------
  webSocket.begin(SERVER_IP, SERVER_PORT, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Place Finger");
  lcd.setCursor(0, 1);
  lcd.print("On Sensor...");

  Serial.println("🚑 System Ready - Place finger on sensor");
}

// ================================================
//                     LOOP
// ================================================
void loop() {

  // ⚠️ MUST run as fast as possible - no delay() here
  pox.update();
  webSocket.loop();

  // -------- WIFI WATCHDOG --------
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi lost - reconnecting...");
    WiFi.reconnect();
    delay(500);
    return;
  }

  // -------- REPORTING --------
  if (millis() - tsLastReport > REPORTING_PERIOD_MS) {

    float hr   = pox.getHeartRate();
    float spo2 = pox.getSpO2();

    Serial.print("HR: "); Serial.print(hr);
    Serial.print(" | SpO2: "); Serial.println(spo2);

    // -------- WARMUP SKIP --------
    if (skipCount < WARMUP_READINGS) {
      skipCount++;
      Serial.println("⏳ Warming up sensor...");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Warming up...");
      lcd.setCursor(0, 1);
      lcd.print("Please wait");
      tsLastReport = millis();
      return;
    }

    // -------- ZERO READING WATCHDOG --------
    if (hr == 0 && spo2 == 0) {
      zeroCount++;
      Serial.print("⚠️ Zero reading count: ");
      Serial.println(zeroCount);

      if (zeroCount >= 10) {
        reinitSensor();
      }

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Place Finger");
      lcd.setCursor(0, 1);
      lcd.print("On Sensor...");

      tsLastReport = millis();
      return;
    }

    zeroCount = 0;

    // -------- VALIDITY CHECK --------
    if (hr < 30 || hr > 220 || spo2 < 80) {
      Serial.println("⚠️ Invalid reading - skipping");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Adjust Finger");
      lcd.setCursor(0, 1);
      lcd.print("Keep Still...");
      tsLastReport = millis();
      return;
    }

    // -------- VALID READING --------
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("HR:");
    lcd.print(hr, 0);
    lcd.print(" bpm");
    lcd.setCursor(0, 1);
    lcd.print("SpO2:");
    lcd.print(spo2, 0);
    lcd.print("%");

    // -------- BUILD & SEND PACKET --------
    String timestamp = getTimeStamp();

    char packet[160];
    snprintf(packet, sizeof(packet),
      "{\"id\":\"AMB_01\",\"time\":\"%s\",\"hr\":%.1f,\"spo2\":%.1f}",
      timestamp.c_str(), hr, spo2);

    Serial.print("📦 Packet: ");
    Serial.println(packet);

    if (webSocket.isConnected()) {
      webSocket.sendTXT(packet);
      Serial.println("📡 Sent successfully");
    } else {
      Serial.println("⚠️ WebSocket not connected - skipping send");
    }

    tsLastReport = millis();
  }
}