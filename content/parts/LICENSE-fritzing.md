# Parts art: Fritzing parts library (CC BY-SA 3.0)

Most of CircuitPath's breadboard and schematic pictures come from the
**Fritzing parts library** (https://github.com/fritzing/fritzing-parts), by the
Fritzing team and contributors, used under the
**Creative Commons Attribution-ShareAlike 3.0** licence
(https://creativecommons.org/licenses/by-sa/3.0/).

They were imported from commit `27535f2fd02097be9bed229b75aa8e9be282a4a0` by `go run ./tools/import_fritzing`,
which tidies them for the web app: editor metadata removed, styles turned into
attributes, ids made unique, numbers rounded, one drawing unit (0.01 inch)
everywhere, some elements tagged or grouped so the simulator can light,
press or turn them (LED colours, resistor colour bands, the servo horn, the
button cap, the potentiometer's rotor). These changed SVG files under
`ui/parts/` are adaptations of the Fritzing art and are shared under the
same licence, **CC BY-SA 3.0**. The licence applies to those SVG files only:
CircuitPath's own code, and the art CircuitPath drew itself (listed below),
are not covered by it.

## From the Fritzing parts library

| CircuitPath | Fritzing part | Files (in fritzing-parts) |
|---|---|---|
| board d1-mini | WeMos D1 Mini | `core/WeMos-D1-mini-male-headers-above_fixed.fzp`, `svg/core/breadboard/WeMos-D1-mini-male-headers-above_breadboard.svg`, `svg/core/schematic/WeMos-D1-mini_schematic.svg` |
| board mega | Arduino Mega 2560 (Rev3) | `core/Arduino_MEGA_2560-Rev3(fix).fzp`, `svg/core/breadboard/Arduino_MEGA_2560-Rev3_breadboard.svg`, `svg/core/schematic/Arduino_MEGA_2560-Rev3(fix)_schematic.svg` |
| board nano | Arduino Nano (Rev3.0) | `core/Arduino Nano3(fix).fzp`, `svg/core/breadboard/Arduino Nano3_breadboard.svg`, `svg/core/schematic/Arduino Nano3_schematic.svg` |
| board nodemcu | Amica NodeMCU DEVKIT 1.0 | `core/Amica_NodeMCU_DEVKIT_1.0.fzp`, `svg/core/breadboard/Amica_NodeMCU_DEVKIT_1.0_breadboard.svg`, `svg/core/schematic/Amica_NodeMCU_DEVKIT_1.0_schematic.svg` |
| board uno | Arduino Uno (Rev3) | `core/arduino_Uno_Rev3(fix).fzp`, `svg/core/breadboard/arduino_Uno_Rev3_breadboard.svg`, `svg/core/schematic/arduino_Uno_Rev3(fix)_schematic.svg` |
| breadboard | Half breadboard | `core/Half_breadboard_v2.fzp`, `svg/core/breadboard/Half_breadboard56a.svg` |
| button | Pushbutton | `core/pushbutton_4_horizontal.fzp`, `svg/core/breadboard/basic_pbutton.svg`, `svg/core/schematic/pushbutton4lead.svg` |
| buzzer | Piezo Speaker | `core/piezo sensor.fzp`, `svg/core/breadboard/piezo_sensor.svg`, `svg/core/schematic/piezo_sensor.svg` |
| hc-sr04 | HC-SR04 Ultrasonic Distance Sensor | `core/hc-sr04_bf8299a_002.fzp`, `svg/core/breadboard/hc-sr04_bf8299a_002.svg`, `svg/core/schematic/hc-sr04_bf8299a_002.svg` |
| ldr | Photocell (LDR) | `core/LDR_photocell_300mil_v5.fzp`, `svg/core/breadboard/ldr.svg`, `svg/core/schematic/ldr.svg` |
| led | Red LED - 5mm | `core/LED-generic-5mm_6852162_005.fzp`, `svg/core/breadboard/LED-5mm-red-leg.svg`, `svg/core/schematic/led.svg` |
| neopixel-ring | 12 NeoPixel Ring | `contrib/adafruit_ffd51df0b5410b3e06f7e782c37b6870_1_15.fzp`, `svg/contrib/breadboard/adafruit_88be198d12b447cdfecbbe9dfb4bc1a8_1_breadboard_15.svg`, `svg/contrib/schematic/adafruit_88be198d12b447cdfecbbe9dfb4bc1a8_1_schematic_15.svg` |
| neopixel-strip | NeoPixel Stick | `contrib/adafruit_6530a5d9a89aa5dfd404e4335177b1a6_1_71.fzp`, `svg/contrib/breadboard/adafruit_63ac9ae82a412ce2d647640ca7ab7795_1_breadboard_71.svg`, `svg/contrib/schematic/adafruit_63ac9ae82a412ce2d647640ca7ab7795_1_schematic_71.svg` |
| pir | PIR sensor | `contrib/PIR_sensor__723e9e78d3d1bdc76f4badecd521c4cb_6B.fzp`, `svg/contrib/breadboard/PIR_sensor__723e9e78d3d1bdc76f4badecd521__breadboard__bde4d2a73b9c7784602c3b4f93cfb0ab_6B.svg`, `svg/contrib/schematic/PIR_sensor__723e9e78d3d1bdc76f4badecd521__schematic__4c698e9578a08c9d23d9979cd290117a_6B.svg` |
| potentiometer | 12mm Trimmer Potentiometer (Large) | `core/potentiometer_trimmer_12mm_5.fzp`, `svg/core/breadboard/potentiometer_trimmer_12mm_5_breadboard.svg`, `svg/core/schematic/potentiometer_1_schematic.svg` |
| resistor-10k | 220 Ω Resistor | `core/resistor.fzp`, `svg/core/breadboard/resistor_220.svg`, `svg/core/schematic/resistor.svg` |
| resistor-220 | 220 Ω Resistor | `core/resistor.fzp`, `svg/core/breadboard/resistor_220.svg`, `svg/core/schematic/resistor.svg` |
| rgb-led | RGB LED (com. cathode, rgb) | `core/led-rgb-4pin-cathode_v5.fzp`, `svg/core/breadboard/led-rgb-4pin-anode-leg.svg`, `svg/core/schematic/led-rgb-4pin-cathode.svg` |
| servo | Basic Servo | `core/servo.fzp`, `svg/core/breadboard/servo.svg`, `svg/core/schematic/servo_schematic.svg` |
| soil-moisture | Soil Moisture Sensor | `core/SparkFun_Soil_Moisture_Sensor.fzp`, `svg/core/breadboard/SparkFun_Soil_Moisture_Sensor_breadboard.svg`, `svg/core/schematic/SparkFun_Soil_Moisture_Sensor_schematic.svg` |

## Drawn by CircuitPath (not from Fritzing)

These parts and boards aren't in the Fritzing core library, so CircuitPath
drew them in the same style (part.json says `"art": "circuitpath"`):

| CircuitPath | Picture |
|---|---|
| board esp32 | ESP32 DevKit V1 (30 pins) |
| board esp32-c3 | ESP32-C3 SuperMini |
| dht | DHT11 temperature and humidity module |
| joystick | Joystick module (KY-023) |
| keypad-4x4 | 4×4 membrane keypad |
| lcd-i2c | 16×2 LCD screen with I2C backpack |
| led-matrix | 8×8 LED matrix (MAX7219) |
| oled | OLED screen 0.96" (SSD1306, I2C) |
| rfid-rc522 | RFID reader (RC522) |
| tm1637 | 4-digit display (TM1637) |
