// MFRC522 RFID reader: cards come from sim.tapCard([0xDE, 0xAD, 0xBE, 0xEF]) / sim_events { card }.

const HEADER = `
#include <SPI.h>
struct MFRC522_Uid {
  byte size;
  byte uidByte[10];
  byte sak;
};
class MFRC522 {
public:
  enum PICC_Type { PICC_TYPE_UNKNOWN, PICC_TYPE_ISO_14443_4, PICC_TYPE_ISO_18092, PICC_TYPE_MIFARE_MINI, PICC_TYPE_MIFARE_1K, PICC_TYPE_MIFARE_4K, PICC_TYPE_MIFARE_UL, PICC_TYPE_MIFARE_PLUS, PICC_TYPE_MIFARE_DESFIRE, PICC_TYPE_TNP3XXX, PICC_TYPE_NOT_COMPLETE = 255 };
  MFRC522();
  MFRC522(byte resetPowerDownPin);
  MFRC522(byte chipSelectPin, byte resetPowerDownPin);
  MFRC522_Uid uid;
  void PCD_Init();
  void PCD_Init(byte chipSelectPin, byte resetPowerDownPin);
  void PCD_Reset();
  void PCD_AntennaOn();
  void PCD_AntennaOff();
  void PCD_SetAntennaGain(byte mask);
  void PCD_DumpVersionToSerial();
  bool PCD_PerformSelfTest();
  bool PICC_IsNewCardPresent();
  bool PICC_ReadCardSerial();
  byte PICC_HaltA();
  void PCD_StopCrypto1();
  PICC_Type PICC_GetType(byte sak);
  String PICC_GetTypeName(PICC_Type type);
  void PICC_DumpToSerial(MFRC522_Uid* uid);
  void PICC_DumpDetailsToSerial(MFRC522_Uid* uid);
};
`;

export class MFRC522 {
  constructor(R, a, b) {
    this.R = R;
    this.ss = b === undefined ? null : a;
    this.rst = b === undefined ? a : b;
    this.uid = { size: 0, uidByte: new Uint8Array(10), sak: 0 };
    this.ready = false;
  }
  PCD_Init() { this.ready = true; this.R.us += 50000; }
  PCD_Reset() {}
  PCD_AntennaOn() {}
  PCD_AntennaOff() {}
  PCD_SetAntennaGain() {}
  PCD_DumpVersionToSerial() { this.R.serial?.printStr("Firmware Version: 0x92 = v2.0\r\n"); }
  PCD_PerformSelfTest() { return 1; }
  PICC_IsNewCardPresent() {
    this.R.us += 1000;
    this.R.progress();
    return this.ready && this.R.card ? 1 : 0;
  }
  PICC_ReadCardSerial() {
    const c = this.R.card;
    if (!this.ready || !c) return 0;
    this.R.card = null;
    this.uid.size = Math.min(10, c.length);
    this.uid.uidByte.fill(0);
    c.slice(0, 10).forEach((b, i) => { this.uid.uidByte[i] = b; });
    this.uid.sak = 0x08;
    return 1;
  }
  PICC_HaltA() { return 0; }
  PCD_StopCrypto1() {}
  PICC_GetType(sak) { return (sak & 0x7f) === 0x08 ? 4 : 0; }
  PICC_GetTypeName(t) { return t === 4 ? "MIFARE 1KB" : "Unknown type"; }
  PICC_DumpToSerial() { this.PICC_DumpDetailsToSerial(); }
  PICC_DumpDetailsToSerial() {
    const hex = Array.from(this.uid.uidByte.slice(0, this.uid.size), (b) => " " + b.toString(16).toUpperCase().padStart(2, "0")).join("");
    this.R.serial?.printStr(`Card UID:${hex}\r\nPICC type: MIFARE 1KB\r\n`);
  }
}

export default {
  headers: { "MFRC522.h": HEADER },
  classes: { MFRC522 },
};
