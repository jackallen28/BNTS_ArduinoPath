import { test } from "node:test";
import assert from "node:assert/strict";
import { guessPort, sortPorts, portLabel, isUsb } from "../../ui/js/realboard.js";

const uno = { id: "uno", fqbn: "arduino:avr:uno" };
const nano = { id: "nano", fqbn: "arduino:avr:nano" };
// What a Raspberry Pi lists with a CH340 Nano clone plugged in.
const piPorts = [
  { port: "/dev/ttyAMA0", label: "/dev/ttyAMA0" },
  { port: "/dev/ttyS0", label: "/dev/ttyS0" },
  { port: "/dev/ttyUSB0", vid: "0x1a86", pid: "0x7523", chip: "CH340" },
];

test("the computer's own ports are never guessed as the board", () => {
  assert.equal(guessPort(piPorts, nano, null), "/dev/ttyUSB0");
  assert.equal(guessPort([{ port: "COM1" }], uno, null), null);
  assert.equal(guessPort([{ port: "/dev/cu.Bluetooth-Incoming-Port" }, { port: "/dev/cu.usbserial-110", vid: "0x1a86" }], uno, null), "/dev/cu.usbserial-110");
});

test("a remembered port wins while it's plugged in", () => {
  const two = [...piPorts, { port: "/dev/ttyUSB1", vid: "0x10c4", chip: "CP2102" }];
  assert.equal(guessPort(two, nano, "/dev/ttyUSB1"), "/dev/ttyUSB1");
  assert.equal(guessPort(two, nano, null), null); // two boards: the student picks
  assert.equal(guessPort(two, nano, "/dev/ttyUSB9"), null);
});

test("a board that names itself is picked", () => {
  const ports = [{ port: "COM3", vid: "0x1a86" }, { port: "COM4", vid: "0x2341", board: "Arduino Uno", fqbn: "arduino:avr:uno" }];
  assert.equal(guessPort(ports, uno, null), "COM4");
});

test("USB ports are listed first, and built-in ones say so", () => {
  assert.deepEqual(sortPorts(piPorts).map((p) => p.port), ["/dev/ttyUSB0", "/dev/ttyAMA0", "/dev/ttyS0"]);
  assert.equal(isUsb(piPorts[2]), true);
  assert.match(portLabel(piPorts[0]), /built into this computer/);
  assert.equal(portLabel(piPorts[2]), "/dev/ttyUSB0 (CH340: most clone boards)");
});
