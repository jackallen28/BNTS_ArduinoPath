// ArduinoPath kit check: uses every library the projects need, so a board
// that compiles this has everything a student will use. CI compiles it
// for every board after installing the Arduino tools.

// Board-specific libraries first: Keypad.h defines CLOSED and OPEN as
// macros, which clash with the ESP8266 WiFi headers if they come after it.
#if defined(ESP32)
#include <WiFi.h>
#include <WebServer.h>
#include <esp_now.h>
#include <Servo.h> // ArduinoPath's Servo.h for ESP32 (ESP32Servo)
WebServer server(80);
#elif defined(ESP8266)
#include <WiFi.h>      // ArduinoPath's WiFi.h for ESP8266 (ESP8266WiFi)
#include <WebServer.h> // ArduinoPath's WebServer.h for ESP8266 (ESP8266WebServer)
#include <espnow.h>
#include <Servo.h>
WebServer server(80);
#else
#include <Servo.h>
#include <LiquidCrystal_I2C.h> // Keypad Safe (Uno / Mega)
LiquidCrystal_I2C lcd(0x27, 16, 2);
#endif

#include <Wire.h>
#include <SPI.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>
#include <TM1637Display.h>
#include <Keypad.h>
#include <MFRC522.h>
#include <MD_MAX72xx.h>

Adafruit_NeoPixel pixels(12, 2, NEO_GRB + NEO_KHZ800);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
DHT dht(3, DHT11);
TM1637Display digits(4, 5);
MFRC522 rfid(10, 9);
MD_MAX72XX matrix(MD_MAX72XX::FC16_HW, 8, 1); // 8×8 LED matrix (Joystick Snake)
Servo servo;

const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};
byte rowPins[ROWS] = {0, 1, 2, 3};
byte colPins[COLS] = {4, 5, 6, 7};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

void setup() {
  Serial.begin(115200);
  pixels.begin();
  pixels.setPixelColor(0, pixels.Color(0, 150, 150));
  pixels.show();
  if (oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.println(F("Hello!"));
    oled.display();
  }
  dht.begin();
  digits.setBrightness(7);
  digits.showNumberDec(42);
  SPI.begin();
  rfid.PCD_Init();
  matrix.begin();
  matrix.setPoint(1, 1, true);
  servo.attach(9);
  servo.write(90);
#if defined(ESP32) || defined(ESP8266)
  WiFi.mode(WIFI_STA);
  esp_now_init();
  server.on("/", []() { server.send(200, "text/plain", "Hello!"); });
  server.begin();
#else
  lcd.init();
  lcd.backlight();
  lcd.print("Hello!");
#endif
}

void loop() {
  char key = keypad.getKey();
  if (key) Serial.println(key);
  float t = dht.readTemperature();
  if (!isnan(t)) Serial.println(t);
  if (rfid.PICC_IsNewCardPresent()) Serial.println(F("card"));
#if defined(ESP32) || defined(ESP8266)
  server.handleClient();
#endif
  delay(10);
}
