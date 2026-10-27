# Uno controller: original Grove program plus capacity

The supplied working program's lid behaviour and pins are preserved. The long delays are represented as states so telemetry remains responsive throughout the five-second opening cycle; trusted capacity sampling resumes when the bin is closed. Wi-Fi is optional; disconnecting the ESP32-C3 does not stop the Uno.

## Original hardware and sequence

- D2: closed-position button, `INPUT` with the original **external pull-down**, HIGH when the lid is physically closed.
- D3: servo signal. Use an appropriate regulated servo supply and common ground; do not overload the Uno regulator.
- D7: original **Grove single-signal ultrasonic** for hand detection.
- D8: original LED (with appropriate series resistor).
- Startup and each closure: attach servo, LED HIGH, sweep 0–180° in 1° steps with 15 ms spacing, after each 15 ms dwell sample D2, stopping when HIGH and learning that closing angle. If no switch is found, report a fault and use the original 90° fallback. Hold the closing command for 300 ms, then detach servo and set LED LOW.
- While ready: one valid Grove integer-centimetre measurement from 1–30 cm opens immediately to the original 0° command. After 400 ms check that the switch has released; a still-HIGH switch reports a fault. Hold a total 5000 ms from opening, close and relax as above, cool down 2000 ms and wait the original loop’s final 200 ms before resuming approach polling. The first poll after startup occurs immediately after closing relaxation. Keeping a hand nearby does not extend the original fixed five-second hold.

The original `duration / 29 / 2` integer-centimetre conversion and 5 µs Grove trigger pulse are retained for the hand sensor. This is a classroom prototype, not certified obstruction or pinch protection. Check servo endpoints with its linkage disconnected before fitting it.

## Added capacity sensor

Default second sensor: another Grove single-signal ultrasonic on **D6**. Its VCC goes to 5 V and GND to common ground. If the internal sensor is a four-pin HC-SR04 instead, set `CAPACITY_USE_HCSR04` to 1: TRIG D5, ECHO D6. Both ECHO/signal levels are compatible with the 5 V Uno; they must not be connected directly to the C3.

Capacity calibration: `BIN_EMPTY_MM` (220 mm, 0 %) and `BIN_FULL_MM` (200 mm, 100 %) at the top of the sketch, copied into the settings before `controller.begin()`; accepted distance 20–600 mm. Measure your bin with `firmware/bin_calibration`. The Uno calculates a median-filtered percentage from three valid samples and clamps it to 0–100. Invalid capacity readings retain the last known percentage but mark it unavailable. Old data beyond 2500 ms is also marked invalid.

Trusted capacity requires the servo detached, a settled closed phase, the physical D2 switch HIGH and 750 ms since closing relaxation finished. Open/moving/uncertain lids invalidate capacity while retaining the last known value. A fixed sensor mounted facing into the bin is recommended. Any two ultrasonic transmissions are separated by at least 70 ms to reduce cross-talk; capacity pings yield to the original approach polling. Each echo wait is bounded to 30 ms. Capacity pings run only in a trusted closed phase, so they do not block the original 15 ms homing sweep. Framed serial output drains only free UART buffer space to avoid a long blocking write during homing. The additional sensor can still add small scheduling jitter to the approach cadence; real mechanics and sensor cross-talk need hardware testing.

## One-way C3 link

D1 TX sends hardware-UART telemetry at **115200 baud** instead of the original 9600. Connect D1 through 2.2 kΩ to the C3 GPIO4 RX junction, and 3.3 kΩ from that junction to GND. Join Uno GND and C3 GND. There is exactly one data signal; no C3 TX connection or acknowledgement is required. The divider reduces nominal 5 V to 3 V. Never apply 5 V directly to a C3 GPIO. USB debug output from the Uno will show framed data; debug lines are omitted so they cannot contaminate it.

Frames are `@<compact JSON>*<CRC16>\n`; CRC-16/CCITT-FALSE is calculated over the JSON bytes and sent as four hex digits. The Uno decides every field: integer `fill` 0–100; boolean `lidOpen` (commanded state); boolean `sensorOk` (trusted capacity); unsigned `ageMs`; unsigned `seq`; booleans `approachOk`, `lidMoving`, `closedSwitch`, `lidFault` and `homing`. Before the first trusted capacity sample, `sensorOk:false` and `ageMs:4294967295` mean unknown, not empty.

`lidOpen` and `lidMoving` describe the software command, not proven servo motion. `closedSwitch` reports the actual button. `lidFault` flags an unsuccessful closing sweep or a switch that remained pressed after the opening release check. The C3 only validates/transports the frame; it must not calculate capacity or control the lid.

Actual Uno compilation/upload, serial electrical levels, servo power/angles/button polarity, Grove variants, cross-talk and physical capacity accuracy remain target/hardware checks.
