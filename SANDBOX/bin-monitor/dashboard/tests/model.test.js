import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTelemetry, fillStatus, splitLines } from '../model.js';
test('accepts and rounds ESP readings including endpoints', () => {
  assert.deepEqual(parseTelemetry('{"fill":45.6,"lidOpen":true}'), {fill:46,lidOpen:true});
  for (const fill of [0,100]) assert.equal(parseTelemetry(JSON.stringify({fill,lidOpen:false})).fill,fill);
});
test('rejects malformed and out-of-range readings', () => {
  for (const line of ['booting','null','{}','{"fill":-1,"lidOpen":true}','{"fill":101,"lidOpen":true}','{"fill":"30","lidOpen":false}','{"fill":30,"lidOpen":1}']) assert.throws(() => parseTelemetry(line));
});
test('thresholds reflect near-full and full transitions', () => {
  assert.equal(fillStatus(69),'Ready for more'); assert.equal(fillStatus(70),'Getting full');
  assert.equal(fillStatus(89),'Getting full'); assert.equal(fillStatus(90),'Full — empty the bin');
});
test('serial framing handles fragmented and batched CRLF readings', () => {
  const a = splitLines('', '{"fill":'); assert.equal(a.lines.length,0);
  const b = splitLines(a.pending,'20,"lidOpen":false}\r\n\n{"fill":30');
  assert.equal(parseTelemetry(b.lines[0]).fill,20); assert.equal(b.pending,'{"fill":30');
  assert.throws(() => splitLines('', 'x'.repeat(4097)));
});

test('Wi-Fi telemetry includes explicit sensor health and reading age', async () => {
  const {parseWifiTelemetry} = await import('../model.js');
  assert.deepEqual(parseWifiTelemetry('{"fill":42,"lidOpen":true,"sensorOk":false,"ageMs":9000}'), {fill:42,lidOpen:true,sensorOk:false,ageMs:9000});
  for (const data of [{fill:42,lidOpen:true}, {fill:42,lidOpen:true,sensorOk:'yes',ageMs:0}, {fill:42,lidOpen:true,sensorOk:true,ageMs:-1}, {fill:42,lidOpen:true,sensorOk:true,ageMs:'0'}]) assert.throws(() => parseWifiTelemetry(JSON.stringify(data)));
});
