// The Wiring Wizard's test: a sketch generated from a project's parts that
// tries each one (outputs take turns; inputs report changes), using a
// simple serial protocol:
//   TEST:<part id>:<what>     an output is doing something now ("ON", "BEEP", "90")
//   READ:<part id>:<value>    an input's reading changed ("0", "512", "23.5,40")
//   HELLO                     the sketch has started
// Every generated test must compile for every board the project lists (CI).
// Pure (tested in Node).

export const TEST_BAUD = 115200;

/**
 * Each part type's test. pins: the part's legs → pin code (from the bench's
 * netlist). Return { includes, globals, setup, outputs (code run when it's
 * this part's turn), loop (code run every time) }; null for parts with
 * nothing to test (resistors).
 */
const TESTS = {
  led: (p) => p.pins.anode && ({
    setup: [`pinMode(${p.pins.anode}, OUTPUT);`],
    outputs: [`Serial.println(F("TEST:${p.id}:ON"));`, `digitalWrite(${p.pins.anode}, HIGH);`, "delay(600);", `digitalWrite(${p.pins.anode}, LOW);`],
  }),
  "rgb-led": (p) => ({
    setup: ["red", "green", "blue"].filter((c) => p.pins[c]).map((c) => `pinMode(${p.pins[c]}, OUTPUT);`),
    outputs: ["red", "green", "blue"].filter((c) => p.pins[c]).flatMap((c) => [
      `Serial.println(F("TEST:${p.id}:${c.toUpperCase()}"));`,
      `digitalWrite(${p.pins[c]}, HIGH);`, "delay(500);", `digitalWrite(${p.pins[c]}, LOW);`]),
  }),
  buzzer: (p) => p.pins.positive && ({
    setup: [`pinMode(${p.pins.positive}, OUTPUT);`],
    outputs: [`Serial.println(F("TEST:${p.id}:BEEP"));`, `tone(${p.pins.positive}, 880);`, "delay(250);", `noTone(${p.pins.positive});`, "delay(150);"],
  }),
  servo: (p) => p.pins.signal && ({
    includes: ["#include <Servo.h>"], // on ESP32, ArduinoPath's Servo.h is ESP32Servo
    globals: [`Servo servo_${cid(p.id)};`],
    setup: [`servo_${cid(p.id)}.attach(${p.pins.signal});`],
    outputs: [0, 90, 180, 90].flatMap((a) => [`servo_${cid(p.id)}.write(${a});`, `Serial.println(F("TEST:${p.id}:${a}"));`, "delay(400);"]),
  }),
  button: (p) => p.pins.signal && reading(p, `pinMode(${p.pins.signal}, INPUT_PULLUP);`, `digitalRead(${p.pins.signal})`, 0),
  pir: (p) => p.pins.signal && reading(p, `pinMode(${p.pins.signal}, INPUT);`, `digitalRead(${p.pins.signal})`, 0),
  potentiometer: (p) => p.pins.wiper && reading(p, "", `analogRead(${p.pins.wiper})`, 12),
  ldr: (p) => p.pins.signal && reading(p, "", `analogRead(${p.pins.signal})`, 12),
  "soil-moisture": (p) => p.pins.signal && reading(p, "", `analogRead(${p.pins.signal})`, 12),
  joystick: (p) => ({
    setup: p.pins.sw ? [`pinMode(${p.pins.sw}, INPUT_PULLUP);`] : [],
    globals: [`int last_${cid(p.id)} = -100;`],
    loop: [
      `{ int v = ${p.pins.x ? `analogRead(${p.pins.x})` : "0"} + ${p.pins.y ? `analogRead(${p.pins.y})` : "0"} * 2 + ${p.pins.sw ? `(digitalRead(${p.pins.sw}) == LOW ? 9000 : 0)` : "0"};`,
      `  if (abs(v - last_${cid(p.id)}) > 24) { last_${cid(p.id)} = v; Serial.print(F("READ:${p.id}:"));`,
      `    Serial.print(${p.pins.x ? `analogRead(${p.pins.x})` : "0"}); Serial.print(','); Serial.print(${p.pins.y ? `analogRead(${p.pins.y})` : "0"}); Serial.print(',');`,
      `    Serial.println(${p.pins.sw ? `digitalRead(${p.pins.sw}) == LOW ? 1 : 0` : "0"}); } }`,
    ],
  }),
  "hc-sr04": (p) => p.pins.trig && p.pins.echo && ({
    setup: [`pinMode(${p.pins.trig}, OUTPUT);`, `pinMode(${p.pins.echo}, INPUT);`],
    globals: [`unsigned long at_${cid(p.id)} = 0;`],
    loop: [
      `if (millis() - at_${cid(p.id)} > 400) {`,
      `  at_${cid(p.id)} = millis();`,
      `  digitalWrite(${p.pins.trig}, LOW); delayMicroseconds(2);`,
      `  digitalWrite(${p.pins.trig}, HIGH); delayMicroseconds(10); digitalWrite(${p.pins.trig}, LOW);`,
      `  long us = pulseIn(${p.pins.echo}, HIGH, 30000UL);`,
      `  Serial.print(F("READ:${p.id}:")); Serial.println(us / 58);`,
      "}",
    ],
  }),
  dht: (p) => p.pins.data && ({
    includes: ["#include <DHT.h>"],
    globals: [`DHT dht_${cid(p.id)}(${p.pins.data}, ${p.options?.model === "DHT22" ? "DHT22" : "DHT11"});`, `unsigned long at_${cid(p.id)} = 0;`],
    setup: [`dht_${cid(p.id)}.begin();`],
    loop: [
      `if (millis() - at_${cid(p.id)} > 2000) {`,
      `  at_${cid(p.id)} = millis();`,
      `  float t = dht_${cid(p.id)}.readTemperature(); float h = dht_${cid(p.id)}.readHumidity();`,
      `  Serial.print(F("READ:${p.id}:"));`,
      "  if (isnan(t) || isnan(h)) Serial.println(F(\"none\")); else { Serial.print(t, 1); Serial.print(','); Serial.println(h, 0); }",
      "}",
    ],
  }),
  oled: (p) => ({
    includes: ["#include <Wire.h>", "#include <Adafruit_GFX.h>", "#include <Adafruit_SSD1306.h>"],
    globals: [`Adafruit_SSD1306 oled_${cid(p.id)}(128, ${p.options?.height === 32 ? 32 : 64}, &Wire, -1);`],
    setup: [
      `if (oled_${cid(p.id)}.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {`,
      `  oled_${cid(p.id)}.clearDisplay(); oled_${cid(p.id)}.setTextSize(2); oled_${cid(p.id)}.setTextColor(SSD1306_WHITE);`,
      `  oled_${cid(p.id)}.setCursor(10, 10); oled_${cid(p.id)}.println(F("Hello!")); oled_${cid(p.id)}.display();`,
      `  Serial.println(F("TEST:${p.id}:HELLO"));`,
      `} else Serial.println(F("TEST:${p.id}:MISSING"));`,
    ],
  }),
  "lcd-i2c": (p) => ({
    includes: ["#include <Wire.h>", "#include <LiquidCrystal_I2C.h>"],
    globals: [`LiquidCrystal_I2C lcd_${cid(p.id)}(0x${(p.options?.address ?? 0x27).toString(16)}, 16, 2);`],
    setup: [`lcd_${cid(p.id)}.init(); lcd_${cid(p.id)}.backlight(); lcd_${cid(p.id)}.setCursor(0, 0); lcd_${cid(p.id)}.print(F("Hello!"));`, `Serial.println(F("TEST:${p.id}:HELLO"));`],
  }),
  tm1637: (p) => p.pins.clk && p.pins.dio && ({
    includes: ["#include <TM1637Display.h>"],
    globals: [`TM1637Display disp_${cid(p.id)}(${p.pins.clk}, ${p.pins.dio});`],
    setup: [`disp_${cid(p.id)}.setBrightness(5);`],
    outputs: [`disp_${cid(p.id)}.showNumberDec(1234);`, `Serial.println(F("TEST:${p.id}:1234"));`, "delay(700);", `disp_${cid(p.id)}.clear();`],
  }),
  "led-matrix": (p) => p.pins.cs && ({
    includes: ["#include <MD_MAX72xx.h>", "#include <SPI.h>"],
    globals: [`MD_MAX72XX mx_${cid(p.id)}(MD_MAX72XX::FC16_HW, ${p.pins.cs}, 1);`],
    setup: [`mx_${cid(p.id)}.begin();`, `mx_${cid(p.id)}.control(MD_MAX72XX::INTENSITY, 2);`],
    outputs: [
      "{ const uint8_t smile[8] = { 0x3C, 0x42, 0xA5, 0x81, 0xA5, 0x99, 0x42, 0x3C };",
      `  for (uint8_t r = 0; r < 8; r++) mx_${cid(p.id)}.setRow(0, r, smile[r]); }`,
      `Serial.println(F("TEST:${p.id}:SMILE"));`, "delay(700);", `mx_${cid(p.id)}.clear();`],
  }),
  "neopixel-ring": (p) => neopixel(p, p.options?.pixels ?? 12),
  "neopixel-strip": (p) => neopixel(p, p.options?.pixels ?? 8),
  "keypad-4x4": (p) => {
    const rows = ["r1", "r2", "r3", "r4"].map((k) => p.pins[k]);
    const cols = ["c1", "c2", "c3", "c4"].map((k) => p.pins[k]);
    if (rows.some((x) => !x) || cols.some((x) => !x)) return null;
    return {
      includes: ["#include <Keypad.h>"],
      globals: [
        `char keys_${cid(p.id)}[4][4] = { {'1','2','3','A'}, {'4','5','6','B'}, {'7','8','9','C'}, {'*','0','#','D'} };`,
        `byte rows_${cid(p.id)}[4] = { ${rows.join(", ")} };`,
        `byte cols_${cid(p.id)}[4] = { ${cols.join(", ")} };`,
        `Keypad keypad_${cid(p.id)} = Keypad(makeKeymap(keys_${cid(p.id)}), rows_${cid(p.id)}, cols_${cid(p.id)}, 4, 4);`,
      ],
      loop: [`{ char k = keypad_${cid(p.id)}.getKey(); if (k) { Serial.print(F("READ:${p.id}:")); Serial.println(k); } }`],
    };
  },
  "rfid-rc522": (p) => p.pins.sda && p.pins.rst && ({
    includes: ["#include <SPI.h>", "#include <MFRC522.h>"],
    globals: [`MFRC522 rfid_${cid(p.id)}(${p.pins.sda}, ${p.pins.rst});`],
    setup: ["SPI.begin();", `rfid_${cid(p.id)}.PCD_Init();`],
    loop: [
      `if (rfid_${cid(p.id)}.PICC_IsNewCardPresent() && rfid_${cid(p.id)}.PICC_ReadCardSerial()) {`,
      `  Serial.print(F("READ:${p.id}:"));`,
      `  for (byte i = 0; i < rfid_${cid(p.id)}.uid.size; i++) { if (rfid_${cid(p.id)}.uid.uidByte[i] < 16) Serial.print('0'); Serial.print(rfid_${cid(p.id)}.uid.uidByte[i], HEX); }`,
      "  Serial.println();",
      `  rfid_${cid(p.id)}.PICC_HaltA();`,
      "}",
    ],
  }),
};

/** A part id as a C name. */
function cid(id) {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

/** An input that prints its value when it changes by more than `jitter`. */
function reading(p, setupLine, expr, jitter) {
  return {
    setup: setupLine ? [setupLine] : [],
    globals: [`int last_${cid(p.id)} = -100;`],
    loop: [`{ int v = ${expr}; if (abs(v - last_${cid(p.id)}) > ${jitter}) { last_${cid(p.id)} = v; Serial.print(F("READ:${p.id}:")); Serial.println(v); } }`],
  };
}

function neopixel(p, count) {
  if (!p.pins.din) return null;
  return {
    includes: ["#include <Adafruit_NeoPixel.h>"],
    globals: [`Adafruit_NeoPixel px_${cid(p.id)}(${count}, ${p.pins.din}, NEO_GRB + NEO_KHZ800);`],
    setup: [`px_${cid(p.id)}.begin();`, `px_${cid(p.id)}.setBrightness(40);`],
    outputs: [
      `for (int s = 0; s < 3; s++) { for (int i = 0; i < ${count}; i++) px_${cid(p.id)}.setPixelColor(i, px_${cid(p.id)}.gamma32(px_${cid(p.id)}.ColorHSV((i * 65536L / ${count}) + s * 21845L))); px_${cid(p.id)}.show(); delay(200); }`,
      `Serial.println(F("TEST:${p.id}:RAINBOW"));`,
      `px_${cid(p.id)}.clear(); px_${cid(p.id)}.show();`,
    ],
  };
}

/** Which parts are outputs (the student confirms "I saw it work") and which are inputs (they act). */
export const KIND = {
  led: "output", "rgb-led": "output", buzzer: "output", servo: "output", oled: "output", "lcd-i2c": "output",
  tm1637: "output", "led-matrix": "output", "neopixel-ring": "output", "neopixel-strip": "output",
  button: "input", pir: "input", potentiometer: "input", ldr: "input", "soil-moisture": "input", joystick: "input",
  "hc-sr04": "input", dht: "input", "keypad-4x4": "input", "rfid-rc522": "input",
};

/** What the wizard asks the student to do for each input. */
export const PROMPTS = {
  button: "Press the button.",
  pir: "Wave your hand in front of the motion sensor.",
  potentiometer: "Turn the knob.",
  ldr: "Cover the light sensor with your hand.",
  "soil-moisture": "Touch the sensor's prongs with a damp finger.",
  joystick: "Move the joystick and press it down.",
  "hc-sr04": "Move your hand towards the sensor and away.",
  dht: "Wait a few seconds for a reading.",
  "keypad-4x4": "Press any key on the keypad.",
  "rfid-rc522": "Hold a card or tag on the reader.",
};

/**
 * Builds the test sketch.
 * @param {{ id, type, label?, pins: Record<string,string>, options? }[]} parts
 * @param {{ name: string }} board
 * @returns {{ code: string, rows: { id, label, type, kind: "output"|"input", prompt? }[] }}
 */
export function testSketch(parts, board) {
  const includes = [];
  const globals = [];
  const setup = [];
  const outputs = [];
  const loop = [];
  const rows = [];
  for (const p of parts) {
    const make = TESTS[p.type];
    const t = make && make({ ...p, pins: p.pins ?? {} });
    if (!t) continue;
    for (const i of t.includes ?? []) if (!includes.includes(i) || i.startsWith("#if") || i.startsWith("#e")) includes.push(i);
    globals.push(...(t.globals ?? []));
    setup.push(...(t.setup ?? []));
    if (t.outputs?.length) outputs.push({ id: p.id, code: t.outputs });
    loop.push(...(t.loop ?? []));
    rows.push({ id: p.id, label: p.label ?? p.id, type: p.type, kind: KIND[p.type] ?? "output", prompt: PROMPTS[p.type] });
  }
  const dedupedIncludes = dedupeIncludes(includes);
  const ind = (lines, n = 1) => lines.map((l) => "  ".repeat(n) + l).join("\n");
  const turns = outputs.map((o, i) => `    case ${i}:\n${ind(o.code, 3)}\n      break;`).join("\n");
  const code = `// ArduinoPath wiring test for your ${board.name}.
// It tries each part in turn and reports on the Serial Monitor (${TEST_BAUD} baud).
${dedupedIncludes.join("\n")}${dedupedIncludes.length ? "\n" : ""}
${globals.join("\n")}${globals.length ? "\n" : ""}int turn = 0;
unsigned long lastTurn = 0;

void setup() {
  Serial.begin(${TEST_BAUD});
${ind(setup)}
  Serial.println(F("HELLO"));
}

void loop() {
${ind(loop)}${loop.length ? "\n" : ""}  if (millis() - lastTurn > 1500) {
    lastTurn = millis();
    switch (turn) {
${turns}
    }
    turn = (turn + 1) % ${Math.max(1, outputs.length)};
  }
}
`;
  return { code, rows };
}

/** Keeps the first of each #include, and #if blocks once. */
function dedupeIncludes(lines) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#if")) {
      const block = [];
      while (i < lines.length && !lines[i].startsWith("#endif")) block.push(lines[i++]);
      block.push("#endif");
      const key = block.join("\n");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(...block);
      }
      continue;
    }
    if (!seen.has(lines[i])) {
      seen.add(lines[i]);
      out.push(lines[i]);
    }
  }
  return out;
}

/** "READ:pot:512" → { kind: "READ", id: "pot", value: "512" }; null for other lines. */
export function parseTestLine(line) {
  const m = /^(TEST|READ):([a-z0-9-]+):(.*)$/.exec(line.trim());
  if (m) return { kind: m[1], id: m[2], value: m[3] };
  if (line.trim() === "HELLO") return { kind: "HELLO" };
  return null;
}
