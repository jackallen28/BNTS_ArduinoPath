import { h, loadSprites } from './vendor/js/dom.js';
import { appWindow } from './vendor/js/widgets/window.js';
import { parseSerialTelemetry, parseWifiTelemetry, fillStatus, splitLines } from './model.js';
import { createBinView } from './bin-view.js';

let fill = 35, lidOpen = false, demo = null, port = null, reader = null;
let mode = 'simulation', lastReading = 0, connecting = false;
let wifiTimer = null, wifiAbort = null, wifiGeneration = 0;
let hasLiveFill = false;
const log = h('ol', { 'aria-label': 'Recent events' });
function record(message) {
  log.prepend(h('li', {}, `${new Date().toLocaleTimeString('en-AU')} · ${message}`));
  while (log.children.length > 15) log.lastChild.remove();
}
const percentage = h('strong', { id: 'percentage' });
const fillValue = h('strong', {}), lidValue = h('strong', {});
const status = h('p', { role: 'status', 'aria-live': 'polite' });
const controllerStatus = h('p', { class: 'hint', id: 'controller-status', role: 'status', text: 'Simulation · no controller connected.' });
const source = h('span', { class: 'badge', text: 'Simulation' });
const connection = h('p', { class: 'connection', role: 'status', text: 'Simulation is ready. No board required.' });
const bin = createBinView();
const slider = h('input', { id: 'fill', type: 'range', min: 0, max: 100, value: fill, oninput: e => update(Number(e.target.value), lidOpen) });
const button = (text, onclick) => h('button', { type: 'button', class: 'btn', text, onclick });
const lidButton = button('Open lid', () => { update(fill, !lidOpen); record(lidOpen ? 'Lid opened' : 'Lid closed'); });
const emptyButton = button('Empty bin', () => { update(0, lidOpen); record('Bin emptied'); });
const addButton = button('Add waste +10%', () => update(Math.min(100, fill + 10), lidOpen));
const demoButton = button('Start auto demo', () => {
  if (demo) return stopDemo();
  demoButton.textContent = 'Stop auto demo';
  demo = setInterval(() => update(fill >= 100 ? 0 : fill + 5, !lidOpen), 1500);
  record('Auto demo started');
});
function stopDemo() { if (demo) clearInterval(demo); demo = null; demoButton.textContent = 'Start auto demo'; }
function update(nextFill, nextLid) {
  const previous = fillStatus(fill);
  fill = nextFill; lidOpen = nextLid;
  bin.style.setProperty('--fill', `${fill}%`);
  bin.classList.toggle('open', lidOpen); bin.classList.toggle('full', fill >= 90);
  percentage.textContent = `${fill}%`; fillValue.textContent = `${fill}%`;
  lidValue.textContent = lidOpen ? 'Open' : 'Closed';
  status.textContent = fillStatus(fill); status.classList.toggle('alert', fill >= 90);
  slider.value = fill; lidButton.textContent = lidOpen ? 'Close lid' : 'Open lid';
  lidButton.setAttribute('aria-pressed', String(lidOpen));
  if (previous !== fillStatus(fill)) record(fillStatus(fill));
}
function setMode(next) {
  mode = next;
  for (const control of [slider, lidButton, emptyButton, addButton, demoButton]) control.disabled = mode !== 'simulation';
  connectButton.disabled = mode !== 'simulation' || connecting;
  wifiButton.disabled = mode !== 'simulation' || connecting;
  disconnectButton.disabled = mode === 'simulation';
  source.textContent = mode === 'simulation' ? 'Simulation' : 'Uno · waiting for data';
  controllerStatus.textContent = mode === 'simulation' ? 'Simulation · no controller connected.' : 'Waiting for Uno controller status.';
  controllerStatus.classList.remove('alert');
}
function beginLive(next) {
  stopDemo(); hasLiveFill = false; lastReading = 0; setMode(next);
  percentage.textContent = '—'; fillValue.textContent = 'Waiting'; lidValue.textContent = 'Waiting';
  bin.style.setProperty('--fill', '0%');
  bin.classList.remove('open', 'full');
  status.textContent = 'Waiting for sensor readings';
}
function markUnavailable(message, badge = 'Uno · no recent data') {
  source.textContent = badge;
  connection.textContent = message;
  status.textContent = hasLiveFill ? 'Last known fill · awaiting a valid reading' : 'No valid fill reading yet';
}
function applyReading(reading, transport) {
  if (reading.relayConnected === false || (reading.receivedAgeMs !== undefined && reading.receivedAgeMs > 2000)) {
    markUnavailable('No recent Uno data. Check Uno power, TX signal, divider and common ground.', 'Uno · relay waiting');
    lidValue.textContent = 'Unknown · no Uno link';
    controllerStatus.textContent = 'Closure switch status unknown: no recent Uno link.';
    return;
  }
  lastReading = Date.now(); // Even an invalid capacity reading can carry a fresh lid command.
  const usable = reading.sensorOk !== false && (reading.ageMs === undefined || reading.ageMs <= 5000);
  if (usable) {
    update(reading.fill, reading.lidOpen); hasLiveFill = true;
    source.textContent = transport === 'wifi' ? 'Uno · Wi-Fi live' : 'Uno · USB live';
    connection.textContent = transport === 'wifi' ? 'Receiving Uno readings through the ESP32-C3 Wi-Fi relay.' : 'Receiving Uno readings over USB.';
  } else {
    bin.classList.toggle('open', reading.lidOpen);
    lidValue.textContent = reading.lidOpen ? 'Open' : 'Closed';
    lidOpen = reading.lidOpen;
    const paused = reading.source === 'uno' && reading.sensorOk === false && (reading.lidOpen || reading.lidMoving);
    markUnavailable(paused ? 'Capacity reading paused while the lid opens or closes. Showing the last valid fill.' : reading.sensorOk === false ? 'Capacity sensor unavailable. Lid commands continue; fill shows the last valid reading.' : 'Stale capacity reading from Uno. Check the internal sensor.', 'Uno · capacity warning');
  }
  if (reading.source === 'uno') {
    lidValue.textContent = reading.homing ? 'Homing · commanded' : (reading.lidMoving ? (reading.lidOpen ? 'Opening' : 'Closing') : (reading.lidOpen ? 'Open' : 'Closed')) + ' · commanded';
    controllerStatus.textContent = ('closedSwitch' in reading ? 'Closure switch: ' + (reading.closedSwitch ? 'pressed' : 'released') + '. ' : '') + (reading.lidFault ? 'Uno reports a lid/switch fault. Check the mechanism.' : 'Lid position shown is the Uno command.');
    controllerStatus.classList.toggle('alert', reading.lidFault === true);
    if (reading.lidFault) source.textContent = 'Uno · lid warning';
  }
}
const connectButton = button('Connect Uno via USB', connect);
const wifiButton = button('Connect via Wi-Fi', connectWifi);
const disconnectButton = button('Return to simulation', async () => {
  if (mode === 'wifi') {
    stopWifi(); setMode('simulation'); update(fill, lidOpen);
    connection.textContent = 'Wi-Fi monitoring paused. Simulation controls are available.';
    record('Returned to simulation');
  } else if (reader) {
    try { await reader.cancel(); } catch { /* Read loop handles device disconnects. */ }
  }
});
disconnectButton.disabled = true;
function stopWifi() {
  wifiGeneration++; clearTimeout(wifiTimer); wifiTimer = null;
  if (wifiAbort) wifiAbort.abort(); wifiAbort = null;
}
function connectWifi() {
  if (mode !== 'simulation' || connecting) return;
  if (location.hostname !== '192.168.4.1') {
    connection.textContent = 'Join BNTS-Bin-Monitor in your device Wi-Fi settings, then open http://192.168.4.1. The dashboard connects automatically there.';
    return;
  }
  beginLive('wifi'); const generation = ++wifiGeneration;
  record('Wi-Fi monitoring started');
  const poll = async () => {
    const controller = new AbortController(); wifiAbort = controller;
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch('/api/telemetry', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reading = parseWifiTelemetry(await response.text());
      if (generation !== wifiGeneration) return;
      applyReading(reading, 'wifi');
    } catch {
      if (generation !== wifiGeneration) return;
      markUnavailable('Wi-Fi connection lost or telemetry unavailable. Stay connected to BNTS-Bin-Monitor; retrying automatically.', 'ESP · Wi-Fi unavailable');
    } finally {
      clearTimeout(timeout);
      if (generation === wifiGeneration) {
        wifiAbort = null;
        wifiTimer = setTimeout(poll, 500);
      }
    }
  };
  poll();
}
async function connect() {
  if (connecting || port || mode !== 'simulation') return;
  if (!navigator.serial) { connection.textContent = 'USB serial needs Chrome or Edge on localhost or HTTPS. For wireless access, join BNTS-Bin-Monitor and open http://192.168.4.1.'; return; }
  connecting = true; connectButton.disabled = true; wifiButton.disabled = true;
  try {
    const selected = await navigator.serial.requestPort();
    await selected.open({ baudRate: 115200 });
    port = selected; beginLive('esp');
    connection.textContent = 'USB connected. Waiting for Uno telemetry at 115200 baud…';
    record('Uno USB connected');
    reader = port.readable.getReader();
    const decoder = new TextDecoder(); let pending = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      const result = splitLines(pending, decoder.decode(value, { stream: true })); pending = result.pending;
      for (const line of result.lines) {
        try {
          const reading = parseSerialTelemetry(line);
          applyReading(reading, 'usb');
        } catch { connection.textContent = 'Ignored invalid telemetry. Expected a valid Uno frame/checksum.'; }
      }
    }
  } catch (error) {
    connection.textContent = error.name === 'NotFoundError' ? 'No board selected. Simulation is ready.' : `Uno connection ended: ${error.message}`;
    record('Uno connection unavailable or ended');
  } finally {
    if (reader) { reader.releaseLock(); reader = null; }
    if (port) { try { await port.close(); } catch { /* Device may already be unplugged. */ } port = null; }
    const hadConnection = mode === 'esp'; connecting = false;
    setMode('simulation'); update(fill, lidOpen);
    if (hadConnection) { connection.textContent = 'Uno disconnected. Simulation controls are available.'; record('Returned to simulation'); }
  }
}
setInterval(() => {
  if (mode === 'esp' && (!lastReading || Date.now() - lastReading > 5000)) {
    markUnavailable('No recent telemetry. Check the sketch, USB cable and sensor wiring.');
  }
}, 1000);
const stat = (name, value) => h('div', { class: 'stat' }, h('span', { text: name }), value);
const body = h('main', {},
  h('header', { class: 'brand' }, h('img', { src: 'assets/school-logo.png', alt: 'Banyule Nillumbik Tech School' }), h('div', {}, h('h1', { text: 'Bin Monitor' }), h('p', { text: 'A little smarter. A little less waste.' })), source),
  h('div', { class: 'dashboard' },
    h('section', { class: 'scene', 'aria-label': 'Animated bin' }, h('h2', { text: 'TIMBER BIN / 01' }), bin, h('div', { class: 'scene-output' }, percentage, status)),
    h('div', {},
      h('section', { class: 'panel' }, h('h2', { text: 'Bin at a glance' }), h('div', { class: 'stats' }, stat('Fill level', fillValue), stat('Lid command', lidValue)), controllerStatus),
      h('section', { class: 'panel' }, h('h2', { text: 'Simulation controls' }), h('label', { for: 'fill', text: 'Fill level (%)' }), slider, h('div', { class: 'actions' }, addButton, emptyButton, lidButton, demoButton), h('p', { class: 'hint', text: 'Try filling the bin past 70% and 90%. Live mode takes readings from the Uno and locks these controls.' })),
      h('section', { class: 'panel' }, h('h2', { text: 'Uno + ESP32-C3 relay' }), connection, h('div', { class: 'actions' }, wifiButton, connectButton, disconnectButton), h('p', { class: 'hint' }, 'Wi-Fi: join ', h('strong', { text: 'BNTS-Bin-Monitor' }), ', then open ', h('a', { href: 'http://192.168.4.1', text: 'http://192.168.4.1' }), '. No internet or USB data needed after flashing. ', h('a', { href: 'README.md', text: 'Setup guide' }), ' · ', h('a', { href: 'assets/uno-c3-wiring.svg', text: 'Wiring diagram' }))))),
  h('section', { class: 'log' }, h('h2', { text: 'Activity' }), log));
document.querySelector('#app').append(appWindow({ title: 'Bin Monitor', body, status: ['BNTS · ArduinoPath framework · Uno control · ESP32-C3 Wi-Fi relay'] }));
loadSprites(['assets/icons.svg']); update(fill, lidOpen); record('Simulation ready');
if (location.hostname === '192.168.4.1') connectWifi();
