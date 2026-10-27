#pragma once
// Explicit host fakes: these are test adapters, NOT an Arduino core/toolchain.
#include <stddef.h>
#include <stdint.h>
#include <string>
#include <vector>
#include <sstream>
#define F(text) text
static const uint8_t LOW = 0, HIGH = 1, INPUT = 0, OUTPUT = 1, INPUT_PULLUP = 2;
namespace arduinostub {
struct Pulse { uint8_t pin; uint32_t timeMs; };
static uint32_t now = 0;
static uint8_t inputs[64] = {};
static uint8_t outputs[64] = {};
static uint8_t modes[64] = {};
static unsigned long echoes[64] = {};
static std::vector<Pulse> triggers;
static std::string serialBytes;
static int txFree = 64;
static std::vector<size_t> serialWrites;
inline void reset() {
  now = 0; triggers.clear(); serialBytes.clear(); serialWrites.clear(); txFree = 64;
  for (unsigned i = 0; i < 64; ++i) { inputs[i] = outputs[i] = modes[i] = 0; echoes[i] = 0; }
}
}
inline unsigned long millis() { return arduinostub::now; }
inline void delay(unsigned long duration) { arduinostub::now += static_cast<uint32_t>(duration); }
inline void delayMicroseconds(unsigned int) {}
inline void pinMode(uint8_t pin, uint8_t mode) { arduinostub::modes[pin] = mode; }
inline int digitalRead(uint8_t pin) { return arduinostub::inputs[pin]; }
inline void digitalWrite(uint8_t pin, uint8_t value) {
  arduinostub::outputs[pin] = value;
  if (value == HIGH && arduinostub::modes[pin] == OUTPUT)
    arduinostub::triggers.push_back({pin, arduinostub::now});
}
inline unsigned long pulseIn(uint8_t pin, uint8_t, unsigned long) { return arduinostub::echoes[pin]; }
template<typename T> T constrain(T value, T lower, T upper) { return value < lower ? lower : value > upper ? upper : value; }
class HostSerial {
 public:
  void begin(unsigned long baud) { baud_ = baud; }
  int availableForWrite() { return arduinostub::txFree; }
  size_t write(uint8_t byte) { arduinostub::serialBytes.push_back(static_cast<char>(byte)); return 1; }
  size_t write(const uint8_t* bytes, size_t count) { arduinostub::serialWrites.push_back(count); arduinostub::serialBytes.append(reinterpret_cast<const char*>(bytes), count); return count; }
  size_t print(const char* text) { arduinostub::serialBytes += text; return std::char_traits<char>::length(text); }
  template<typename T> size_t print(T value) { std::ostringstream text; text << value; return print(text.str().c_str()); }
  size_t println(const char* text = "") { const size_t count = print(text); arduinostub::serialBytes += '\n'; return count + 1; }
  unsigned long baud_ = 0;
};
static HostSerial Serial;
