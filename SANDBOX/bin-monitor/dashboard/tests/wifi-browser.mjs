// Protocol-level Wi-Fi browser test. Requests to 192.168.4.1 are intercepted;
// this does not verify a physical access point, RF, firmware upload or sensors.
const { chromium } = await import('playwright').catch(() => import('../../BNTS_ArduinoPath/node_modules/playwright/index.mjs'));
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Decode the exact bytes shipped in the firmware, not source-tree substitutes.
const header = await readFile(resolve(root, 'firmware/esp32_c3_wifi_bridge/dashboard_assets.h'), 'utf8');
const payloads = new Map();
for (const [, symbol, bytes] of header.matchAll(/static const uint8_t (dashboard_asset_\d+)\[\] PROGMEM = \{([\s\S]*?)\};/g)) {
  payloads.set(symbol, Buffer.from([...bytes.matchAll(/0x([0-9a-f]{2})/gi)].map(match => parseInt(match[1], 16))));
}
const assets = new Map();
for (const [, path, contentType, symbol] of header.matchAll(/\{"([^"]+)", "([^"]+)", (dashboard_asset_\d+), sizeof\(\3\)\}/g)) {
  assert.ok(payloads.has(symbol), `asset payload exists for ${path}`);
  assert.ok(!assets.has(path), `asset route is unique: ${path}`);
  assets.set(path, { contentType, body: payloads.get(symbol) });
}
assert.equal(assets.size, 16, 'all embedded dashboard routes are present');
assert.deepEqual(assets.get('/').body, assets.get('/index.html').body, 'both index routes serve the same bytes');
assert.match(assets.get('/app.js').contentType, /javascript/);
assert.match(assets.get('/monitor.css').contentType, /text\/css/);
assert.equal(assets.get('/assets/school-logo.png').contentType, 'image/png');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [], externalRequests = [], missingAssets = [];
  const assetRequests = new Set();
  let reading = { fill: 42, lidOpen: false, sensorOk: true, ageMs: 0 };
  let failRequests = false, malformedResponse = false, telemetryRequests = 0;
  let connected = true, receivedAgeMs = 10, emptyRelay = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.usbRequests = 0;
    window.telemetryCacheModes = [];
    const nativeFetch = window.fetch;
    window.fetch = (input, options) => {
      if (input === '/api/telemetry') window.telemetryCacheModes.push(options?.cache);
      return nativeFetch(input, options);
    };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: {
      requestPort: async () => { window.usbRequests++; throw new Error('USB must not be used by Wi-Fi dashboard'); }
    } });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://192.168.4.1') {
      externalRequests.push(url.href);
      return route.abort('blockedbyclient');
    }
    const pathname = url.pathname;
    if (pathname === '/api/telemetry') {
      telemetryRequests++;
      if (failRequests) return route.abort('connectionfailed');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: malformedResponse ? '{bad json' : JSON.stringify({connected,receivedAgeMs: emptyRelay ? null : receivedAgeMs,telemetry:emptyRelay ? null : {...reading,seq:12,closedSwitch:!reading.lidOpen,lidFault:false,homing:false}}) });
    }
    const asset = assets.get(pathname);
    if (!asset) {
      missingAssets.push(pathname);
      return route.fulfill({ status: 404, body: 'Not found in embedded firmware assets' });
    }
    assetRequests.add(pathname);
    await route.fulfill({ status: 200, contentType: asset.contentType, body: asset.body });
  });
  await page.goto('http://192.168.4.1');
  await page.getByText('Uno · Wi-Fi live', { exact: true }).waitFor();
  assert.equal(await page.locator('#percentage').textContent(), '42%');
  assert.equal(await page.locator('#fill').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.usbRequests), 0);
  const initialHeight = await page.locator('.fill').evaluate(el => parseFloat(getComputedStyle(el).height));
  reading = { fill: 82, lidOpen: true, sensorOk: true, ageMs: 0 };
  await page.waitForFunction(() => document.querySelector('#percentage').textContent === '82%');
  assert.equal(await page.locator('.bin').evaluate(el => el.classList.contains('open')), true);
  await page.waitForTimeout(1000);
  await page.waitForFunction(()=>document.querySelector('.bin').dataset.mediaReady==='true');
  assert.ok(Number(await page.locator('.bin').getAttribute('data-frame')) > 0, 'source animation follows the open command');
  assert.ok(await page.locator('.fill').evaluate(el => parseFloat(getComputedStyle(el).height)) > initialHeight, 'fill graphic follows live telemetry');
  assert.match(await page.locator('.bin').getAttribute('data-source'),/User-supplied/);

  // Failed distance sensor keeps the last valid fill but must still animate lid.
  reading = { fill: 0, lidOpen: false, sensorOk: false, ageMs: 100 };
  await page.waitForFunction(() => !document.querySelector('.bin').classList.contains('open'));
  assert.equal(await page.locator('#percentage').textContent(), '82%');
  assert.notEqual(await page.locator('.badge').textContent(), 'Uno · Wi-Fi live');
  assert.match(await page.locator('.connection').textContent(), /sensor|reading/i);

  reading = { fill: 20, lidOpen: true, sensorOk: true, ageMs: 6000 };
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#percentage').textContent(), '82%');
  assert.notEqual(await page.locator('.badge').textContent(), 'Uno · Wi-Fi live');
  assert.match(await page.locator('.connection').textContent(), /stale|recent|old/i);

  reading = { fill: 72, lidOpen: true, sensorOk: true, ageMs: 0 };
  await page.getByText('Uno · Wi-Fi live', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#percentage').textContent === '72%');
  connected = false; receivedAgeMs = 3000;
  await page.getByText('Uno · relay waiting', {exact:true}).waitFor();
  assert.equal(await page.locator('#percentage').textContent(), '72%');
  assert.equal(await page.locator('#fill').isDisabled(), true);
  assert.match(await page.locator('#controller-status').textContent(), /unknown/i);
  emptyRelay = true;
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#percentage').textContent(), '72%');
  emptyRelay = false; connected = true; receivedAgeMs = 10;
  await page.getByText('Uno · Wi-Fi live', {exact:true}).waitFor();
  malformedResponse = true;
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#percentage').textContent(), '72%');
  assert.notEqual(await page.locator('.badge').textContent(), 'Uno · Wi-Fi live');
  malformedResponse = false;
  await page.getByText('Uno · Wi-Fi live', { exact: true }).waitFor();
  failRequests = true;
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#percentage').textContent(), '72%');
  assert.notEqual(await page.locator('.badge').textContent(), 'Uno · Wi-Fi live');
  assert.notEqual(await page.locator('.badge').textContent(), 'Simulation');
  assert.equal(await page.locator('#fill').isDisabled(), true);

  await page.getByRole('button', { name: 'Return to simulation', exact: true }).click();
  await page.getByText('Simulation', { exact: true }).waitFor();
  assert.equal(await page.locator('#fill').isDisabled(), false);
  failRequests = false;
  await page.getByRole('button', { name: 'Connect via Wi-Fi', exact: true }).click();
  await page.getByText('Uno · Wi-Fi live', { exact: true }).waitFor();
  assert.equal(await page.locator('#percentage').textContent(), '72%');
  assert.equal(await page.evaluate(() => window.usbRequests), 0);
  assert.equal(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.textContent = 'Wi-Fi preview · simulated Uno readings via C3 relay';
    banner.style.cssText = 'padding:12px 20px;margin:0 auto 18px;max-width:1110px;background:#fff1c7;color:#573b00;border:1px solid #dfbe6f;border-radius:6px;font:600 14px Segoe UI,sans-serif;text-align:center';
    document.body.prepend(banner);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${root}/wifi-preview.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${root}/wifi-mobile-preview.png`, fullPage: true });
  assert.ok(await page.evaluate(() => window.telemetryCacheModes.length > 0 && window.telemetryCacheModes.every(mode => mode === 'no-store')), 'polls bypass browser telemetry cache');
  assert.ok(telemetryRequests >= 6, 'live telemetry endpoint was polled repeatedly');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, [], 'dashboard has no external HTTP asset dependencies');
  assert.deepEqual(missingAssets, [], 'all requested dashboard assets exist in embedded route table');
  for (const path of ['/', '/app.js', '/model.js', '/monitor.css', '/vendor/theme.css', '/vendor/js/dom.js', '/vendor/js/widgets/window.js', '/assets/icons.svg', '/assets/school-logo.png']) assert.ok(assetRequests.has(path), `embedded route served: ${path}`);
  console.log('PASS: AP-address dashboard, no USB, live fill/lid animation, failed sensor, stale readings, malformed telemetry, network failure, no-store polling, simulation/reconnect, school logo and mobile layout. Serves actual firmware-embedded assets via intercepted HTTP, not physical hardware.');
} finally { await browser.close(); }
