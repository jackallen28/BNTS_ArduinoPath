// The library headers the simulator knows, and their JavaScript parts.
// Each library: { headers: { "Name.h": text }, families?: [...], functions, classes, objects }.
// families limits where a header exists (an ESP8266WiFi.h on an Uno is
// "No such file or directory", just like the real compiler).

import { ARDUINO_H, boardHeader } from "./core-header.js";
import * as core from "./api.js";
import { LIBRARIES } from "./libraries/index.js";

const ALWAYS = ["math.h", "stdlib.h", "string.h", "stdio.h", "stdint.h", "ctype.h", "stdbool.h", "inttypes.h", "limits.h", "Printable.h",
  "avr/pgmspace.h", "pgmspace.h", "Arduino.h", "WString.h", "Print.h", "Stream.h", "HardwareSerial.h"];
const AVR_ONLY = ["avr/io.h", "avr/interrupt.h", "util/delay.h", "avr/wdt.h", "avr/sleep.h", "avr/power.h"];

/** A function returning a header's text for this board, or null. */
export function headerLookup(board) {
  const fam = board.family;
  return (name) => {
    if (name === "Arduino.h") return ARDUINO_H + "\n" + boardHeader(board);
    if (ALWAYS.includes(name)) return name === "limits.h" ? LIMITS : "";
    if (AVR_ONLY.includes(name)) return fam === "avr" ? "" : null;
    for (const lib of LIBRARIES) {
      if (!(name in lib.headers)) continue;
      if (lib.families && !lib.families.includes(fam)) continue;
      return lib.headers[name];
    }
    return null;
  };
}

const LIMITS = `
#ifdef __AVR__
#define INT_MAX 32767
#define INT_MIN (-32767-1)
#define UINT_MAX 65535U
#else
#define INT_MAX 2147483647
#define INT_MIN (-2147483647-1)
#define UINT_MAX 4294967295U
#endif
#define LONG_MAX 2147483647L
#define LONG_MIN (-2147483647L-1)
#define ULONG_MAX 4294967295UL
#define CHAR_MAX 127
#define CHAR_MIN (-128)
#define UCHAR_MAX 255
`;

/** Every JavaScript implementation: { functions, classes, objects }. */
export function allNatives() {
  const out = { functions: { ...core.functions }, classes: { ...core.classes }, objects: { ...core.objects } };
  for (const lib of LIBRARIES) {
    Object.assign(out.functions, lib.functions || {});
    Object.assign(out.classes, lib.classes || {});
    Object.assign(out.objects, lib.objects || {});
  }
  return out;
}
