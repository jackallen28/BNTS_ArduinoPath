// Servo (and ESP32Servo): write(angle) turns the horn; emits servo {pin, angle}.

const HEADER = `
#define MIN_PULSE_WIDTH 544
#define MAX_PULSE_WIDTH 2400
#define DEFAULT_PULSE_WIDTH 1500
class Servo {
public:
  Servo();
  uint8_t attach(int pin);
  uint8_t attach(int pin, int min, int max);
  void detach();
  void write(int value);
  void writeMicroseconds(int value);
  int read();
  int readMicroseconds();
  bool attached();
  void setPeriodHertz(int hertz);
};
`;

export class Servo {
  constructor(R) {
    this.R = R;
    this.pin = -1;
    this.min = 544;
    this.max = 2400;
    this.us = 1500;
    this.shown = null;
  }
  attach(pin, min = 544, max = 2400) {
    this.pin = pin;
    this.min = min;
    this.max = max;
    this.R.checkPin(pin, "attach()");
    this.show();
    return 1;
  }
  detach() { this.pin = -1; this.shown = null; }
  attached() { return this.pin >= 0 ? 1 : 0; }
  setPeriodHertz() {}
  write(v) {
    if (v < 544) {
      const a = Math.max(0, Math.min(180, v));
      this.us = Math.round(this.min + ((this.max - this.min) * a) / 180);
      this.angle = a;
    } else {
      this.us = Math.max(this.min, Math.min(this.max, v));
      this.angle = null;
    }
    this.show();
  }
  writeMicroseconds(v) { this.write(Math.max(544, v)); }
  read() {
    if (this.angle != null) return this.angle;
    return Math.round(((this.us - this.min) * 180) / (this.max - this.min));
  }
  readMicroseconds() { return this.us; }
  show() {
    const R = this.R;
    R.us += 10;
    if (this.pin < 0) return;
    const angle = this.read();
    if (angle === this.shown) { R.progress(); return; }
    this.shown = angle;
    R.emit("servo", { pin: this.pin, angle });
  }
}

export default {
  headers: { "Servo.h": HEADER, "ESP32Servo.h": HEADER },
  classes: { Servo },
};
