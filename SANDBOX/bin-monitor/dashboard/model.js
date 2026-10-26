// Shared telemetry contract: one JSON object per serial line at 115200 baud.
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

export function parseWifiTelemetry(line) {
  const reading = parseTelemetry(line);
  const data = JSON.parse(line);
  if (typeof data.sensorOk !== 'boolean' || typeof data.ageMs !== 'number' || !Number.isFinite(data.ageMs) || data.ageMs < 0) {
    throw new Error('Expected sensorOk boolean and non-negative ageMs');
  }
  return { ...reading, sensorOk: data.sensorOk, ageMs: data.ageMs };
}
