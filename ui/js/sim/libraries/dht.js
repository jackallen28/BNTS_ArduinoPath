// DHT11 / DHT22: readings come from inputs.dht[pin] = { t, h }; NaN with no sensor.

const HEADER = `
#define DHT11 11
#define DHT12 12
#define DHT21 21
#define DHT22 22
#define AM2301 21
class DHT {
public:
  DHT(uint8_t pin, uint8_t type, uint8_t count = 6);
  void begin(uint8_t usec = 55);
  float readTemperature(bool S = false, bool force = false);
  float convertCtoF(float c);
  float convertFtoC(float f);
  float computeHeatIndex(bool isFahrenheit = true);
  float computeHeatIndex(float temperature, float percentHumidity, bool isFahrenheit = true);
  float readHumidity(bool force = false);
  bool read(bool force = false);
};
`;

export class DHT {
  constructor(R, pin, type) {
    this.R = R;
    this.pin = pin;
    this.type = type;
  }
  begin() { this.R.checkPin(this.pin, "begin()"); }
  reading() {
    const R = this.R;
    R.us += 5000;
    R.progress();
    const v = R.inputs.dht[this.pin];
    if (!v) return null;
    if (this.type === 11) return { t: Math.round(v.t), h: Math.round(v.h) };
    return { t: Math.round(v.t * 10) / 10, h: Math.round(v.h * 10) / 10 };
  }
  read() { return this.reading() ? 1 : 0; }
  readTemperature(f = 0) {
    const v = this.reading();
    if (!v) return NaN;
    return Math.fround(f ? v.t * 1.8 + 32 : v.t);
  }
  readHumidity() {
    const v = this.reading();
    return v ? Math.fround(v.h) : NaN;
  }
  convertCtoF(c) { return Math.fround(c * 1.8 + 32); }
  convertFtoC(f) { return Math.fround((f - 32) * 0.55555); }
  computeHeatIndex(a, b, c) {
    let t, h, isF;
    if (b === undefined) {
      isF = a === undefined ? 1 : a;
      t = this.readTemperature(isF);
      h = this.readHumidity();
    } else { t = a; h = b; isF = c === undefined ? 1 : c; }
    let temperature = isF ? t : t * 1.8 + 32;
    let hi = 0.5 * (temperature + 61.0 + (temperature - 68.0) * 1.2 + h * 0.094);
    if (hi > 79) {
      hi = -42.379 + 2.04901523 * temperature + 10.14333127 * h - 0.22475541 * temperature * h -
        0.00683783 * temperature ** 2 - 0.05481717 * h ** 2 + 0.00122874 * temperature ** 2 * h +
        0.00085282 * temperature * h ** 2 - 0.00000199 * temperature ** 2 * h ** 2;
      if (h < 13 && temperature >= 80 && temperature <= 112) hi -= ((13 - h) * 0.25) * Math.sqrt((17 - Math.abs(temperature - 95)) * 0.05882);
      else if (h > 85 && temperature >= 80 && temperature <= 87) hi += ((h - 85) * 0.1) * ((87 - temperature) * 0.2);
    }
    void temperature;
    return Math.fround(isF ? hi : (hi - 32) * 0.55555);
  }
}

export default {
  headers: { "DHT.h": HEADER, "DHT_U.h": HEADER, "Adafruit_Sensor.h": "" },
  classes: { DHT },
};
