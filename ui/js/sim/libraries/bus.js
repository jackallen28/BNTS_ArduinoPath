// Wire (I2C) and SPI. Devices the sketch creates (OLED, LCD) answer on
// their I2C address, so an I2C scanner finds them.

const WIRE = `
class TwoWire : public Stream {
public:
  void begin();
  void begin(uint8_t address);
#ifndef __AVR__
  void begin(int sda, int scl);
#endif
  void end();
  void setClock(uint32_t clock);
  void beginTransmission(uint8_t address);
  uint8_t endTransmission(bool sendStop = true);
  uint8_t requestFrom(uint8_t address, uint8_t quantity);
  size_t write(uint8_t data);
  int available();
  int read();
};
extern TwoWire Wire;
`;

const SPI = `
#define SPI_MODE0 0x00
#define SPI_MODE1 0x04
#define SPI_MODE2 0x08
#define SPI_MODE3 0x0C
#define SPI_CLOCK_DIV2 0x04
#define SPI_CLOCK_DIV4 0x00
#define SPI_CLOCK_DIV8 0x05
#define SPI_CLOCK_DIV16 0x01
class SPISettings {
public:
  SPISettings();
  SPISettings(uint32_t clock, uint8_t bitOrder, uint8_t dataMode);
};
class SPIClass {
public:
  void begin();
  void end();
  void setBitOrder(uint8_t order);
  void setDataMode(uint8_t mode);
  void setClockDivider(uint8_t div);
  uint8_t transfer(uint8_t data);
  void beginTransaction(SPISettings settings);
  void endTransaction();
};
extern SPIClass SPI;
`;

export class TwoWire {
  constructor(R) { this.R = R; this.addr = 0; }
  begin() {}
  end() {}
  setClock() {}
  beginTransmission(a) { this.addr = a; }
  endTransmission() {
    this.R.us += 100;
    this.R.progress();
    return (this.R.i2cDevices || []).includes(this.addr) ? 0 : 2;
  }
  requestFrom() { return 0; }
  write() { return 1; }
  available() { return 0; }
  read() { return -1; }
  printStr() {}
}

export class SPISettings {
  constructor() {}
}

export class SPIClass {
  constructor(R) { this.R = R; }
  begin() {}
  end() {}
  setBitOrder() {}
  setDataMode() {}
  setClockDivider() {}
  transfer() { return 0; }
  beginTransaction() {}
  endTransaction() {}
}

export default {
  headers: { "Wire.h": WIRE, "SPI.h": SPI },
  classes: { TwoWire, SPIClass, SPISettings },
  objects: { Wire: (R) => new TwoWire(R), SPI: (R) => new SPIClass(R) },
};
