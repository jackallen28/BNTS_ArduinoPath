#pragma once
#include "../../firmware/esp32_c3_wifi_bridge/relay_protocol.h"
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>

namespace firmwaretests {
static unsigned assertions = 0;
inline void expect(bool condition, const char* message) {
  ++assertions;
  if (!condition) throw std::runtime_error(message);
}
inline std::string frame(const std::string& json, bool crlf = false) {
  char checksum[5];
  std::snprintf(checksum, sizeof checksum, "%04X", bntsrelay::crc16(json.data(), json.size()));
  return "@" + json + "*" + checksum + (crlf ? "\r\n" : "\n");
}
inline unsigned feed(bntsrelay::Receiver& receiver, const std::string& bytes, uint32_t now) {
  unsigned accepted = 0;
  for (unsigned char byte : bytes) if (receiver.feed(byte, now)) ++accepted;
  return accepted;
}
inline void relayTests() {
  using bntsrelay::Receiver;
  expect(bntsrelay::crc16("123456789", 9) == 0x29B1, "CRC16-CCITT-FALSE official check vector");
  const std::string valid = "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":12,\"seq\":1}";
  Receiver empty;
  expect(!empty.hasTelemetry(), "receiver starts with no readings");
  expect(!empty.connected(0), "no UART data cannot appear connected");
  expect(!empty.connected(100000), "time alone cannot create a reading");

  Receiver bytewise;
  const auto bytes = frame(valid);
  for (size_t i = 0; i + 1 < bytes.size(); ++i)
    expect(!bytewise.feed(static_cast<uint8_t>(bytes[i]), 100), "partial frame is not published");
  expect(!bytewise.hasTelemetry(), "incomplete frame leaves no telemetry");
  expect(bytewise.feed('\n', 100), "newline publishes a complete valid frame");
  expect(bytewise.hasTelemetry(), "valid frame establishes telemetry");
  expect(bytewise.connected(100), "valid fresh UART is connected");
  expect(bytewise.jsonLength() == valid.size(), "payload length is retained");
  expect(std::string(bytewise.json(), bytewise.jsonLength()) == valid, "bridge retains exact Uno JSON bytes");
  expect(bytewise.receivedAgeMs(125) == 25, "transport age is elapsed receive time");
  expect(!bytewise.connected(100 + bntsrelay::kLinkTimeoutMs + 1), "silent link becomes disconnected");

  const std::string second = "{\"fill\":100,\"lidOpen\":true,\"sensorOk\":false,\"ageMs\":4294967295,\"seq\":4294967295,\"approachOk\":false,\"lidMoving\":true,\"upMs\":0}";
  expect(feed(bytewise, frame(second, true), 1000) == 1, "CRLF frame accepted");
  expect(std::string(bytewise.json(), bytewise.jsonLength()) == second, "bad sensor metadata is forwarded unchanged");
  expect(bytewise.lastReceivedMs() == 1000, "receive timestamp belongs to last accepted frame");
  expect(feed(bytewise, frame(valid) + frame(second), 1100) == 2, "batched frames are handled separately");

  const std::string full = "{\"fill\":100,\"lidOpen\":false,\"sensorOk\":false,\"ageMs\":4294967295,\"seq\":4294967295,\"approachOk\":false,\"lidMoving\":false,\"closedSwitch\":false,\"lidFault\":false,\"homing\":false}";
  expect(full.size() == 171, "worst-case Uno payload stays within fixed memory budget");
  expect(feed(bytewise, frame(full), 1150) == 1, "original-program closed/fault/homing metadata accepted");
  expect(std::string(bytewise.json(), bytewise.jsonLength()) == full, "all Uno control metadata is forwarded unchanged");
  expect(feed(bytewise, frame(full + std::string(bntsrelay::kMaxJsonLength - full.size(), ' ')), 1160) == 1, "maximum length valid frame accepted");
  expect(feed(bytewise, frame(full + std::string(bntsrelay::kMaxJsonLength - full.size() + 1, ' ')), 1170) == 0, "one byte over receiver budget rejected");
  expect(feed(bytewise, frame(second), 1180) == 1, "short valid frame recovers after length boundary");

  std::string broken = frame(valid);
  broken[broken.find("42")] = '5';
  expect(feed(bytewise, broken, 1200) == 0, "modified payload with old CRC is rejected");
  expect(bytewise.lastReceivedMs() == 1180, "corrupt bytes do not refresh freshness");
  expect(std::string(bytewise.json(), bytewise.jsonLength()) == second, "corrupt frame cannot replace last valid payload");
  expect(feed(bytewise, "bootloader text\r\n\0garbage\n", 1300) == 0, "debug text is not telemetry");
  expect(feed(bytewise, frame(valid), 1400) == 1, "valid frame recovers after garbage");

  // Each candidate has an internally consistent CRC, so schema validation is exercised.
  const char* invalid[] = {
    "{}", "null", "[]", "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0}",
    "{\"fill\":101,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1}",
    "{\"fill\":-1,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1}",
    "{\"fill\":1.5,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1}",
    "{\"fill\":\"42\",\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1}",
    "{\"fill\":42,\"fill\":43,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1}",
    "{\"fill\":42,\"lidOpen\":1,\"sensorOk\":true,\"ageMs\":0,\"seq\":1}",
    "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":\"true\",\"ageMs\":0,\"seq\":1}",
    "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":-1,\"seq\":1}",
    "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":4294967296,\"seq\":1}",
    "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1,\"approachOk\":1}",
    "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1,\"extra\":{}}",
    "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1,}",
    "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":01}",
    "{\"fill\":42,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":1} trailing"
  };
  for (const auto candidate : invalid) {
    const uint32_t acceptedAt = bytewise.lastReceivedMs();
    expect(feed(bytewise, frame(candidate), 2000) == 0, "CRC-valid malformed schema is rejected");
    expect(bytewise.lastReceivedMs() == acceptedAt, "invalid schema cannot refresh receive time");
  }

  for (const char* field : {"closedSwitch", "lidFault", "homing"}) {
    const std::string prefix = valid.substr(0, valid.size() - 1);
    const std::string wrong = prefix + ",\"" + field + "\":1}";
    const std::string duplicate = prefix + ",\"" + field + "\":true,\"" + field + "\":false}";
    expect(feed(bytewise, frame(wrong), 2050) == 0, "control flags require booleans");
    expect(feed(bytewise, frame(duplicate), 2050) == 0, "duplicate control flags rejected");
  }

  const std::string spaced = " { \"seq\" : 2 , \"ageMs\" : 0 , \"sensorOk\" : true , \"lidOpen\" : false , \"fill\" : 0 } ";
  expect(feed(bytewise, frame(spaced), 2100) == 1, "valid reordered whitespace JSON accepted");
  expect(std::string(bytewise.json(), bytewise.jsonLength()) == spaced, "valid JSON is not normalized or recomputed");

  Receiver recover;
  expect(feed(recover, "@" + std::string(400, 'x') + "\n", 1) == 0, "overflow frame rejected");
  expect(feed(recover, frame(valid), 2) == 1, "overflow resynchronizes at new frame");
  expect(feed(recover, "@{\"fill\":", 10) == 0, "truncated frame remains unpublished");
  expect(feed(recover, frame(second), 10 + bntsrelay::kFrameTimeoutMs + 10) == 1, "timed-out partial frame does not poison next valid frame");

  Receiver wrap;
  expect(feed(wrap, frame(valid), UINT32_MAX - 15) == 1, "frame accepted near timer rollover");
  expect(wrap.connected(16), "transport freshness survives millis rollover");
  expect(wrap.receivedAgeMs(16) == 32, "receive age uses unsigned timer subtraction");
  expect(!wrap.connected(bntsrelay::kLinkTimeoutMs + 17), "wrapped silent link becomes stale");

  // UART noise and overflow exercise bounded parser state under sanitizers.
  Receiver noise;
  uint32_t random = 0x12345678;
  for (unsigned i = 0; i < 10000; ++i) {
    random = random * 1664525U + 1013904223U;
    noise.feed(static_cast<uint8_t>(random >> 24), i / 100);
  }
  expect(feed(noise, "\n" + frame(valid), 1000) == 1, "parser recovers from arbitrary UART noise");
}
}
