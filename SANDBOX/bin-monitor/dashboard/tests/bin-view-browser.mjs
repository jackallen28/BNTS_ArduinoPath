// Browser-level animation evidence: renders the actual bin view and controls.
// Captured values are simulation inputs, not physical ESP32 sensor readings.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const { chromium } = await import('playwright').catch(() => import('../../BNTS_ArduinoPath/node_modules/playwright/index.mjs'));
const root = fileURLToPath(new URL('..', import.meta.url));
const baseURL = process.env.BIN_MONITOR_URL || 'http://127.0.0.1:8090';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
const output = name => join(root, name);
const framesDir = output('.animation-frames');
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1050 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL);
  await page.getByRole('heading', { name: 'Bin Monitor', exact: true }).waitFor();
  await page.locator('.bin svg').waitFor();
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.textContent = 'Dashboard preview · simulation controls, not physical hardware readings';
    banner.style.cssText = 'padding:12px 20px;margin:0 auto 18px;max-width:1110px;background:#fff1c7;color:#573b00;border:1px solid #dfbe6f;border-radius:6px;font:600 14px Segoe UI,sans-serif;text-align:center';
    document.body.prepend(banner);
    const note = document.createElement('span');
    note.textContent = 'SIMULATION · animated preview';
    note.style.cssText = 'position:absolute;top:42px;left:22px;font:11px Segoe UI,sans-serif;color:#725316;background:#fff4ce;padding:4px 7px;border:1px solid #e2d09a;border-radius:3px;z-index:3';
    document.querySelector('.scene').append(note);
  });
  const lid = page.locator('.lid');
  const transform = () => lid.evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(900);
  const closed = await transform();
  await page.getByRole('button', { name: 'Open lid', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.lid').getAnimations().some(animation => animation.playState === 'running' && animation.currentTime > 0 && animation.currentTime < 650));
  const opening = await transform();
  await page.waitForTimeout(850);
  const open = await transform();
  assert.notEqual(open, closed, 'open and closed lids must have different transforms');
  assert.notEqual(opening, closed, 'the lid must start moving');
  assert.notEqual(opening, open, 'opening is animated, not an instant swap');
  const matrix = text => text.startsWith('matrix(') ? text.slice(7, -1).split(',').map(Number) : null;
  if (matrix(closed) && matrix(open)) {
    // The affine projection changes the lid plane around a fixed hinge.
    assert.ok(Math.abs(matrix(closed)[4] - matrix(open)[4]) < 0.1, 'hinge x stays fixed');
    assert.ok(Math.abs(matrix(closed)[5] - matrix(open)[5]) < 0.1, 'hinge y stays fixed');
  }
  await page.locator('#fill').fill('15');
  await page.waitForTimeout(900);
  const low = await page.locator('.fill').evaluate(el => parseFloat(getComputedStyle(el).height));
  await page.locator('#fill').fill('80');
  await page.waitForTimeout(900);
  const high = await page.locator('.fill').evaluate(el => parseFloat(getComputedStyle(el).height));
  assert.ok(high > low, 'fill indicator follows the simulated level');
  assert.equal(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.screenshot({ path: output('dashboard-open.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close lid', exact: true }).click();
  await page.waitForTimeout(900);
  assert.equal(await transform(), closed, 'closing restores the initial pose');
  await page.screenshot({ path: output('dashboard-closed.png'), fullPage: true });

  // Sample the browser's real CSS transition at known times, pausing each frame.
  // Screenshot overhead must not turn a 750 ms motion into a choppy slow clip.
  await mkdir(framesDir, { recursive: true });
  const frameDurations = [];
  const scene = page.locator('.scene');
  let frame = 0;
  const capture = async duration => {
    await scene.screenshot({ path: join(framesDir, `${String(frame++).padStart(3, '0')}.png`), animations: 'allow' });
    frameDurations.push(duration);
  };
  await capture(600);
  for (const name of ['Open lid', 'Close lid', 'Open lid']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lid').getAnimations().some(animation => animation.playState === 'running'));
    await page.evaluate(() => {
      window.previewTransition = document.querySelector('.lid').getAnimations()[0];
      window.previewTransition.pause();
      window.previewTransition.currentTime = 0;
    });
    for (let i = 0; i <= 12; i++) {
      await page.evaluate(time => { window.previewTransition.currentTime = time; }, i * 62.5);
      await capture(i === 12 ? 600 : 62.5);
    }
    await page.evaluate(() => window.previewTransition.finish());
  }
  await writeFile(join(framesDir, 'durations.json'), JSON.stringify(frameDurations));
  try {
    execFileSync('python3', ['-c', String.raw`
from PIL import Image
from pathlib import Path
import json, sys
folder=Path(sys.argv[1]); target=Path(sys.argv[2])
durations=json.loads((folder/'durations.json').read_text())
images=[Image.open(folder/(str(i).zfill(3)+'.png')).convert('RGB') for i in range(len(durations))]
images[0].save(target,save_all=True,append_images=images[1:],duration=durations,loop=0,optimize=True)
`, framesDir, output('lid-animation.gif')]);
  } catch (error) { throw new Error('Actual-frame GIF export failed: ' + error.message); }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no mobile horizontal overflow');
  const withinScene = await page.evaluate(() => {
    const scene = document.querySelector('.scene').getBoundingClientRect();
    const lid = document.querySelector('.lid').getBoundingClientRect();
    const bin = document.querySelector('.bin').getBoundingClientRect();
    return { bin: bin.left >= scene.left - 1 && bin.right <= scene.right + 1,
      lid: lid.left >= scene.left - 1 && lid.right <= scene.right + 1 && lid.top >= scene.top - 1 && lid.bottom <= scene.bottom + 1 };
  });
  assert.equal(withinScene.bin, true, 'mobile bin fits inside scene');
  assert.equal(withinScene.lid, true, 'raised lid stays visible in mobile scene');
  await page.screenshot({ path: output('dashboard-mobile.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const durations = await lid.evaluate(el => getComputedStyle(el).transitionDuration.split(',').map(parseFloat));
  assert.ok(durations.every(value => value === 0), 'reduced motion disables lid transitions');
  assert.deepEqual(errors, []);
  console.log('PASS: timber-bin open/close/intermediate animation, fixed hinge, fill indicator, mobile fit, reduced motion, school logo; captured real browser screenshots and animated GIF. Simulation only.');
} finally { await browser.close(); }
