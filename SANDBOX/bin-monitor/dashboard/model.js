// Presentation and transport validation only. Sensor/control decisions stay on Uno.
export function parseTelemetry(line) {
  const data = JSON.parse(line);
  if (!data || typeof data.fill !== 'number' || !Number.isFinite(data.fill) || data.fill < 0 || data.fill > 100 || typeof data.lidOpen !== 'boolean') {
    throw new Error('Expected {"fill":0..100,"lidOpen":true|false}');
  }
  return { fill: Math.round(data.fill), lidOpen: data.lidOpen };
}
export function fillStatus(fill) {
  return fill >= 90 ? 'Full — empty the bin' : fill >= 70 ? 'Getting full' : 'Ready for more';
}
export function splitLines(buffer, chunk) {
  const lines = (buffer + chunk).split(/\r?\n/);
  const pending = lines.pop();
  if (pending.length > 4096) throw new Error('Serial line too long');
  return { lines: lines.filter(Boolean), pending };
}
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
function sensorReading(data) {
  const reading = parseTelemetry(JSON.stringify(data));
  if (typeof data.sensorOk !== 'boolean' || !uint32(data.ageMs)) throw new Error('Expected sensorOk boolean and unsigned ageMs');
  const result = { ...reading, sensorOk: data.sensorOk, ageMs: data.ageMs };
  for (const field of ['lidMoving', 'approachOk', 'closedSwitch', 'lidFault', 'homing']) {
    if (field in data) {
      if (typeof data[field] !== 'boolean') throw new Error(`Invalid ${field}`);
      result[field] = data[field];
    }
  }
  if ('seq' in data) {
    if (!uint32(data.seq)) throw new Error('Invalid sequence');
    result.seq = data.seq;
  }
  return result;
}
export function parseWifiTelemetry(line) {
  const data = JSON.parse(line);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid telemetry object');
  // The C3 only envelopes the original Uno JSON with UART transport health.
  if ('connected' in data || 'telemetry' in data) {
    if (typeof data.connected !== 'boolean' || !(data.receivedAgeMs === null || uint32(data.receivedAgeMs))) throw new Error('Invalid relay health');
    if (data.telemetry === null) {
      if (data.connected || data.receivedAgeMs !== null) throw new Error('Connected relay has no data');
      return { relayConnected: false, receivedAgeMs: null, source: 'uno' };
    }
    if (data.receivedAgeMs === null) throw new Error('Missing relay reading age');
    return { ...sensorReading(data.telemetry), relayConnected: data.connected, receivedAgeMs: data.receivedAgeMs, source: 'uno' };
  }
  return sensorReading(data); // Retains compatibility with earlier single-board demo.
}
export function crc16Ccitt(text) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}
export function parseSerialTelemetry(line) {
  if (line.startsWith('@')) {
    const match = /^@([^\r\n]+)\*([0-9A-Fa-f]{4})$/.exec(line);
    if (!match || new TextEncoder().encode(match[1]).length > 192 || crc16Ccitt(match[1]) !== parseInt(match[2], 16)) throw new Error('Bad Uno serial checksum/frame');
    const result = sensorReading(JSON.parse(match[1]));
    if (!uint32(result.seq)) throw new Error('Missing Uno sequence');
    return { ...result, source: 'uno' };
  }
  const data = JSON.parse(line);
  return ('sensorOk' in data || 'ageMs' in data) ? sensorReading(data) : parseTelemetry(line);
}
