// Every library the simulator knows (see headers.js for the format).

import servo from "./servo.js";
import neopixel from "./neopixel.js";
import dht from "./dht.js";
import bus from "./bus.js";
import oled from "./oled.js";
import lcd from "./lcd.js";
import tm1637 from "./tm1637.js";
import keypad from "./keypad.js";
import rfid from "./rfid.js";
import matrix from "./matrix.js";
import wifi from "./wifi.js";
import timelib from "./timelib.js";
import espnow from "./espnow.js";

export const LIBRARIES = [servo, neopixel, dht, bus, oled, lcd, tm1637, keypad, rfid, matrix, ...wifi, timelib, espnow];
