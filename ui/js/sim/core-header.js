// Arduino.h for the simulator: the declarations the compiler checks
// student code against. Functions declared here without a body are
// implemented in JavaScript (api.js); "callback" is a function the sketch
// hands over (attachInterrupt, server.on).

export const ARDUINO_H = String.raw`
#define HIGH 0x1
#define LOW 0x0
#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2
#ifdef ESP32
#define INPUT_PULLDOWN 0x9
#endif
#ifdef ESP8266
#define INPUT_PULLDOWN_16 0x4
#endif
#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define EULER 2.718281828459045235360287471352
#define SERIAL 0x0
#define DISPLAY 0x1
#define LSBFIRST 0
#define MSBFIRST 1
#define CHANGE 1
#define FALLING 2
#define RISING 3
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2
#define DEFAULT 1
#define EXTERNAL 0
#define INTERNAL 3
#define SERIAL_8N1 0x06
#define NOT_AN_INTERRUPT -1
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define abs(x) ((x)>0?(x):-(x))
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
#define round(x) ((x)>=0?(long)((x)+0.5):(long)((x)-0.5))
#define radians(deg) ((deg)*DEG_TO_RAD)
#define degrees(rad) ((rad)*RAD_TO_DEG)
#define sq(x) ((x)*(x))
#define lowByte(w) ((uint8_t) ((w) & 0xff))
#define highByte(w) ((uint8_t) ((w) >> 8))
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitToggle(value, bit) ((value) ^= (1UL << (bit)))
#define bitWrite(value, bit, bitvalue) ((bitvalue) ? bitSet(value, bit) : bitClear(value, bit))
#define bit(b) (1UL << (b))
#define F(x) (x)
#define PSTR(x) (x)
#define FPSTR(x) (x)
#define PROGMEM
#define ICACHE_RAM_ATTR
#define IRAM_ATTR
#define NULL 0
#define RANDOM_MAX 0x7FFFFFFF
#define clockCyclesPerMicrosecond() (F_CPU / 1000000L)

typedef bool boolean;
typedef unsigned char byte;
typedef unsigned char uint8_t;
typedef signed char int8_t;
typedef unsigned long long uint64_t;
typedef long long int64_t;
#ifdef __AVR__
typedef unsigned int uint16_t;
typedef int int16_t;
typedef unsigned long uint32_t;
typedef long int32_t;
typedef unsigned int word;
#else
typedef unsigned short uint16_t;
typedef short int16_t;
typedef unsigned int uint32_t;
typedef int int32_t;
typedef unsigned short word;
#endif
typedef unsigned int size_t;
typedef int ptrdiff_t;
typedef long time_t;

void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
void analogReference(uint8_t mode);
void analogWrite(uint8_t pin, int val);
unsigned long millis();
unsigned long micros();
void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout = 1000000L);
unsigned long pulseInLong(uint8_t pin, uint8_t state, unsigned long timeout = 1000000L);
void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t val);
uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder);
void attachInterrupt(uint8_t interruptNum, callback userFunc, int mode);
void detachInterrupt(uint8_t interruptNum);
void interrupts();
void noInterrupts();
void tone(uint8_t pin, unsigned int frequency, unsigned long duration = 0);
void noTone(uint8_t pin);
long random(long howbig);
long random(long howsmall, long howbig);
void randomSeed(unsigned long seed);
long map(long value, long fromLow, long fromHigh, long toLow, long toHigh);
unsigned int makeWord(unsigned int w);
unsigned int makeWord(unsigned char h, unsigned char l);
void yield();
#ifdef __AVR__
int digitalPinToInterrupt(uint8_t pin);
#else
#define digitalPinToInterrupt(p) (p)
#endif
#ifdef ESP32
void analogReadResolution(uint8_t bits);
void analogWriteResolution(uint8_t bits);
uint32_t analogReadMilliVolts(uint8_t pin);
bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution);
bool ledcAttachChannel(uint8_t pin, uint32_t freq, uint8_t resolution, uint8_t channel);
uint32_t ledcSetup(uint8_t channel, uint32_t freq, uint8_t resolution);
void ledcAttachPin(uint8_t pin, uint8_t channel);
bool ledcWrite(uint8_t pin, uint32_t duty);
bool ledcDetach(uint8_t pin);
uint32_t ledcWriteTone(uint8_t pin, uint32_t freq);
int touchRead(uint8_t pin);
float temperatureRead();
#endif
#ifdef ESP8266
void analogWriteRange(uint32_t range);
void analogWriteFreq(uint32_t freq);
void analogWriteResolution(int res);
#endif

double sqrt(double x);
double pow(double x, double y);
double sin(double x);
double cos(double x);
double tan(double x);
double asin(double x);
double acos(double x);
double atan(double x);
double atan2(double y, double x);
double exp(double x);
double log(double x);
double log10(double x);
double log2(double x);
double fabs(double x);
double floor(double x);
double ceil(double x);
double trunc(double x);
double fmod(double x, double y);
double hypot(double x, double y);
double cbrt(double x);
double fmin(double x, double y);
double fmax(double x, double y);
float sqrtf(float x);
float fabsf(float x);
float powf(float x, float y);
float sinf(float x);
float cosf(float x);
long lround(double x);
int isnan(double x);
int isinf(double x);

bool isAlphaNumeric(int c);
bool isAlpha(int c);
bool isAscii(int c);
bool isWhitespace(int c);
bool isControl(int c);
bool isDigit(int c);
bool isGraph(int c);
bool isLowerCase(int c);
bool isPrintable(int c);
bool isPunct(int c);
bool isSpace(int c);
bool isUpperCase(int c);
bool isHexadecimalDigit(int c);
int toAscii(int c);
int toLowerCase(int c);
int toUpperCase(int c);
int isdigit(int c);
int isalpha(int c);
int isalnum(int c);
int isspace(int c);
int isupper(int c);
int islower(int c);
int isxdigit(int c);
int ispunct(int c);
int isprint(int c);
int toupper(int c);
int tolower(int c);

int atoi(const char* s);
long atol(const char* s);
double atof(const char* s);
long strtol(const char* s, void* end, int base);
unsigned long strtoul(const char* s, void* end, int base);
double strtod(const char* s, void* end);
char* itoa(int value, char* s, int radix);
char* ltoa(long value, char* s, int radix);
char* utoa(unsigned int value, char* s, int radix);
char* ultoa(unsigned long value, char* s, int radix);
char* dtostrf(double val, signed char width, unsigned char prec, char* s);
size_t strlen(const char* s);
int strcmp(const char* a, const char* b);
int strncmp(const char* a, const char* b, size_t n);
int strcasecmp(const char* a, const char* b);
char* strcpy(char* dest, const char* src);
char* strncpy(char* dest, const char* src, size_t n);
char* strcat(char* dest, const char* src);
char* strncat(char* dest, const char* src, size_t n);
char* strchr(const char* s, int c);
char* strrchr(const char* s, int c);
char* strstr(const char* s, const char* find);
char* strtok(char* s, const char* delim);
void* memset(void* dest, int c, size_t n);
void* memcpy(void* dest, const void* src, size_t n);
int memcmp(const void* a, const void* b, size_t n);
int sprintf(char* buf, const char* fmt, ...);
int snprintf(char* buf, size_t n, const char* fmt, ...);
size_t strlen_P(const char* s);
char* strcpy_P(char* dest, const char* src);
int strcmp_P(const char* a, const char* b);
void* memcpy_P(void* dest, const void* src, size_t n);
uint8_t pgm_read_byte(const void* p);
uint16_t pgm_read_word(const void* p);
uint32_t pgm_read_dword(const void* p);
float pgm_read_float(const void* p);
uint8_t pgm_read_byte_near(const void* p);
uint16_t pgm_read_word_near(const void* p);
void exit(int status);
void abort();

class Print {
};

class Stream : public Print {
};

class HardwareSerial : public Stream {
public:
  void begin(unsigned long baud);
  void begin(unsigned long baud, uint8_t config);
#ifndef __AVR__
  void begin(unsigned long baud, uint8_t config, int rx, int tx);
  void setDebugOutput(bool on);
#endif
  void end();
  int available();
  int availableForWrite();
  int peek();
  int read();
  void flush();
  size_t write(uint8_t c);
  size_t write(const char* s);
  size_t write(const uint8_t* buf, size_t size);
  void setTimeout(unsigned long timeout);
  unsigned long getTimeout();
  String readString();
  String readStringUntil(char terminator);
  long parseInt();
  float parseFloat();
  size_t readBytes(char* buffer, size_t length);
  size_t readBytesUntil(char terminator, char* buffer, size_t length);
  bool find(const char* target);
  bool findUntil(const char* target, const char* terminator);
};

extern HardwareSerial Serial;
#if defined(ARDUINO_AVR_MEGA2560) || defined(ESP32)
extern HardwareSerial Serial1;
extern HardwareSerial Serial2;
#endif
#ifdef ESP8266
extern HardwareSerial Serial1;
#endif

#ifndef __AVR__
class EspClass {
public:
  void restart();
  void deepSleep(uint64_t us);
  uint32_t getFreeHeap();
  uint32_t getChipId();
  uint32_t getCpuFreqMHz();
  uint64_t getEfuseMac();
  String getChipModel();
  uint32_t getFlashChipSize();
  String getSdkVersion();
  uint32_t getCycleCount();
};
extern EspClass ESP;
#include <time.h>
#endif
`;

/** Board macros, as gcc would define them for each board. */
export function boardDefines(board) {
  const d = { ARDUINO: "10607", __cplusplus: "201103L" };
  const fam = board.family;
  if (fam === "avr") {
    Object.assign(d, { __AVR__: "1", __AVR: "1", ARDUINO_ARCH_AVR: "1", F_CPU: "16000000L" });
    if (board.id === "uno") Object.assign(d, { ARDUINO_AVR_UNO: "1", __AVR_ATmega328P__: "1" });
    else if (board.id === "nano") Object.assign(d, { ARDUINO_AVR_NANO: "1", __AVR_ATmega328P__: "1" });
    else if (board.id === "mega") Object.assign(d, { ARDUINO_AVR_MEGA2560: "1", __AVR_ATmega2560__: "1" });
  } else if (fam === "esp8266") {
    Object.assign(d, { ESP8266: "1", ARDUINO_ARCH_ESP8266: "1", F_CPU: "80000000L" });
    if (board.id === "nodemcu") Object.assign(d, { ARDUINO_ESP8266_NODEMCU_ESP12E: "1" });
    else if (board.id === "d1-mini") Object.assign(d, { ARDUINO_ESP8266_WEMOS_D1MINI: "1" });
  } else if (fam === "esp32") {
    Object.assign(d, { ESP32: "1", ARDUINO_ARCH_ESP32: "1", F_CPU: "240000000L" });
    if (board.id === "esp32-c3") Object.assign(d, { ARDUINO_ESP32C3_DEV: "1", CONFIG_IDF_TARGET_ESP32C3: "1" });
    else Object.assign(d, { ARDUINO_ESP32_DEV: "1", CONFIG_IDF_TARGET_ESP32: "1" });
  }
  return d;
}

/** The board's pin constants as C++: A0, D5, LED_BUILTIN, SDA... */
export function boardHeader(board) {
  const lines = [];
  for (const p of board.pins || []) {
    if (!/^\d+$/.test(p.code)) lines.push(`static const uint8_t ${p.code} = ${p.number};`);
  }
  const num = (code) => (board.pins || []).find((p) => p.code === String(code))?.number ?? Number(code);
  if (board.led_builtin) lines.push(`#define LED_BUILTIN ${num(board.led_builtin.pin)}`);
  if (board.i2c) lines.push(`static const uint8_t SDA = ${num(board.i2c.sda)};`, `static const uint8_t SCL = ${num(board.i2c.scl)};`);
  if (board.spi) {
    for (const k of ["mosi", "miso", "sck", "ss"]) lines.push(`static const uint8_t ${k.toUpperCase()} = ${num(board.spi[k])};`);
  }
  return lines.join("\n");
}
