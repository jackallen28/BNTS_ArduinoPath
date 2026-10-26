# Bin monitor preview

Original image exports from the existing BNTS bin-monitor SANDBOX prototype, using ArduinoPath’s framework and theme and the official school logo. These files are copied byte-for-byte from the original exports.

## Dashboard

This is an actual browser screenshot using simulated ESP32 HTTP telemetry. The visible live badge describes the mocked data connection; the yellow banner identifies the readings as simulated. This screenshot does not establish connectivity to a physical ESP32.

![Bin monitor dashboard with simulated ESP32 readings](dashboard.png)

[Open dashboard image](dashboard.png)

## ESP32 wiring

Connection schematic for a classic ESP32 DevKit, HC-SR04 ultrasonic distance sensor and reed-switch lid sensor. Check your board’s pin labels; this is not a physical pinout.

![ESP32 bin monitor wiring diagram](wiring.png)

[Open wiring image](wiring.png) · [Scalable SVG](wiring.svg)

The HC-SR04 ECHO signal is 5 V. It must pass through the shown divider: ECHO → 1 kΩ → GPIO18 junction; junction → 2 kΩ → GND. Never connect 5 V ECHO directly to ESP32 GPIO. GPIO5 drives TRIG; GPIO19 reads the switch to ground, closed when the lid is closed.

## Validation status

Browser checks passed for simulation controls, Wi-Fi polling through intercepted HTTP, fill and lid animation, stale/invalid readings, reconnect, school-logo loading and mobile layout. The dashboard assets were checked against the firmware-embedded payload.

Still unverified: firmware target compilation/upload, actual phone/laptop association with the ESP32 Wi-Fi network, on-board HTTP serving, power stability, divider voltage, physical sensor calibration and lid-switch operation. Cloud firmware compilation was blocked by package-download network restrictions. After flashing, the intended Wi-Fi flow is to power the board, join BNTS-Bin-Monitor, stay connected despite no internet, and manually open http://192.168.4.1. USB data is not required for that flow.
