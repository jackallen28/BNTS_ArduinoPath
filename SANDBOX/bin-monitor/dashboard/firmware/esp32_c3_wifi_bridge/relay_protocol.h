#ifndef BNTS_BIN_RELAY_PROTOCOL_H
#define BNTS_BIN_RELAY_PROTOCOL_H

// Transport validation only: sensor interpretation and lid control belong to Uno.
// Fixed storage and a flat, explicit telemetry schema avoid an extra JSON library.
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace bntsrelay {

static const size_t kMaxJsonLength = 192;
static const uint32_t kLinkTimeoutMs = 2000;
static const uint32_t kFrameTimeoutMs = 250;

// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection/final XOR.
static inline uint16_t crc16(const char *data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; ++i) {
    crc ^= static_cast<uint16_t>(static_cast<uint8_t>(data[i])) << 8;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021)
                           : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

namespace detail {
static inline bool whitespace(char c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}
static inline void skipWhitespace(const char *data, size_t length, size_t &at) {
  while (at < length && whitespace(data[at])) ++at;
}
static inline bool match(const char *data, size_t start, size_t length,
                         const char *name) {
  return strlen(name) == length && memcmp(data + start, name, length) == 0;
}
static inline bool readBool(const char *data, size_t length, size_t &at) {
  if (length - at >= 4 && memcmp(data + at, "true", 4) == 0) {
    at += 4;
    return true;
  }
  if (length - at >= 5 && memcmp(data + at, "false", 5) == 0) {
    at += 5;
    return true;
  }
  return false;
}
static inline bool readUnsigned(const char *data, size_t length, size_t &at,
                               uint32_t &value) {
  if (at >= length || data[at] < '0' || data[at] > '9') return false;
  const bool zero = data[at] == '0';
  value = 0;
  size_t digits = 0;
  while (at < length && data[at] >= '0' && data[at] <= '9') {
    const uint8_t digit = static_cast<uint8_t>(data[at] - '0');
    if (value > (UINT32_MAX - digit) / 10U) return false;
    value = value * 10U + digit;
    ++at;
    ++digits;
  }
  // JSON numbers must not have leading zeros. Signs/floats are not our schema.
  return !(zero && digits > 1);
}
static inline int hex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
} // namespace detail

// Validate values, required/duplicate fields and JSON structure. No value is
// changed: valid JSON is forwarded byte-for-byte to the HTTP client.
static inline bool validateTelemetry(const char *data, size_t length) {
  if (!data || length == 0 || length > kMaxJsonLength) return false;
  size_t at = 0;
  detail::skipWhitespace(data, length, at);
  if (at >= length || data[at++] != '{') return false;
  uint16_t seen = 0;
  while (true) {
    detail::skipWhitespace(data, length, at);
    if (at >= length || data[at++] != '"') return false;
    const size_t nameStart = at;
    while (at < length && data[at] != '"') {
      // Schema keys are plain ASCII identifiers; escaped keys are unsupported.
      if (data[at] < ' ' || data[at] == '\\') return false;
      ++at;
    }
    if (at >= length) return false;
    const size_t nameLength = at++ - nameStart;
    uint16_t field = 0;
    bool boolean = false;
    if (detail::match(data, nameStart, nameLength, "fill")) field = 1;
    else if (detail::match(data, nameStart, nameLength, "lidOpen")) { field = 2; boolean = true; }
    else if (detail::match(data, nameStart, nameLength, "sensorOk")) { field = 4; boolean = true; }
    else if (detail::match(data, nameStart, nameLength, "ageMs")) field = 8;
    else if (detail::match(data, nameStart, nameLength, "seq")) field = 16;
    else if (detail::match(data, nameStart, nameLength, "approachOk")) { field = 32; boolean = true; }
    else if (detail::match(data, nameStart, nameLength, "lidMoving")) { field = 64; boolean = true; }
    else if (detail::match(data, nameStart, nameLength, "upMs")) field = 128;
    else if (detail::match(data, nameStart, nameLength, "closedSwitch")) { field = 256; boolean = true; }
    else if (detail::match(data, nameStart, nameLength, "lidFault")) { field = 512; boolean = true; }
    else if (detail::match(data, nameStart, nameLength, "homing")) { field = 1024; boolean = true; }
    else return false;
    if (seen & field) return false;
    seen |= field;
    detail::skipWhitespace(data, length, at);
    if (at >= length || data[at++] != ':') return false;
    detail::skipWhitespace(data, length, at);
    if (boolean) {
      if (!detail::readBool(data, length, at)) return false;
    } else {
      uint32_t value = 0;
      if (!detail::readUnsigned(data, length, at, value)) return false;
      if (field == 1 && value > 100) return false;
    }
    detail::skipWhitespace(data, length, at);
    if (at >= length) return false;
    const char separator = data[at++];
    if (separator == ',') continue;
    if (separator != '}') return false;
    detail::skipWhitespace(data, length, at);
    return at == length && (seen & 31) == 31;
  }
}

class Receiver {
 public:
  Receiver() : frameLength_(0), jsonLength_(0), collecting_(false), sawCR_(false),
               hasTelemetry_(false), lastByteMs_(0), lastReceivedMs_(0) {
    json_[0] = '\0';
  }

  // Return true only when this byte completes a valid, checksummed frame.
  bool feed(uint8_t byte, uint32_t nowMs) {
    if (collecting_ && static_cast<uint32_t>(nowMs - lastByteMs_) > kFrameTimeoutMs) {
      resetFrame();
    }
    if (byte == '@') {
      collecting_ = true;
      sawCR_ = false;
      frameLength_ = 0;
      lastByteMs_ = nowMs;
      return false;
    }
    if (!collecting_) return false;
    lastByteMs_ = nowMs;
    if (byte == '\n') {
      const bool accepted = acceptFrame(nowMs);
      resetFrame();
      return accepted;
    }
    if (sawCR_) { resetFrame(); return false; }
    if (byte == '\r') { sawCR_ = true; return false; }
    if (byte < ' ' || byte > '~') { resetFrame(); return false; }
    if (frameLength_ >= sizeof(frame_)) { resetFrame(); return false; }
    frame_[frameLength_++] = static_cast<char>(byte);
    return false;
  }

  bool hasTelemetry() const { return hasTelemetry_; }
  bool connected(uint32_t nowMs) const {
    return hasTelemetry_ && receivedAgeMs(nowMs) <= kLinkTimeoutMs;
  }
  const char *json() const { return json_; }
  size_t jsonLength() const { return jsonLength_; }
  uint32_t lastReceivedMs() const { return lastReceivedMs_; }
  // Only meaningful after hasTelemetry(); HTTP uses null before the first frame.
  uint32_t receivedAgeMs(uint32_t nowMs) const {
    return static_cast<uint32_t>(nowMs - lastReceivedMs_);
  }

 private:
  void resetFrame() { collecting_ = false; sawCR_ = false; frameLength_ = 0; }
  bool acceptFrame(uint32_t nowMs) {
    if (frameLength_ < 6) return false;
    const size_t length = frameLength_ - 5;
    if (length > kMaxJsonLength || frame_[length] != '*') return false;
    uint16_t expected = 0;
    for (size_t i = length + 1; i < frameLength_; ++i) {
      const int digit = detail::hex(frame_[i]);
      if (digit < 0) return false;
      expected = static_cast<uint16_t>((expected << 4) | digit);
    }
    if (crc16(frame_, length) != expected || !validateTelemetry(frame_, length)) return false;
    memcpy(json_, frame_, length);
    json_[length] = '\0';
    jsonLength_ = length;
    lastReceivedMs_ = nowMs;
    hasTelemetry_ = true;
    return true;
  }

  // Payload + '*' + exactly four hex digits. No allocation or unbounded input.
  char frame_[kMaxJsonLength + 5];
  char json_[kMaxJsonLength + 1];
  size_t frameLength_;
  size_t jsonLength_;
  bool collecting_;
  bool sawCR_;
  bool hasTelemetry_;
  uint32_t lastByteMs_;
  uint32_t lastReceivedMs_;
};

} // namespace bntsrelay
#endif
