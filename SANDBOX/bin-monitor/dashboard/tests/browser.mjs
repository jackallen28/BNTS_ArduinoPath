import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
// Run after npm ci in ../BNTS_ArduinoPath and npm start in SANDBOX.
const { chromium } = await import('playwright').catch(() => import('../../BNTS_ArduinoPath/node_modules/playwright/index.mjs'));
import assert from 'node:assert/strict';
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BIN_MONITOR_URL || 'http://127.0.0.1:8090');
  await page.getByRole('heading',{name:'Bin Monitor',exact:true}).waitFor();
  assert.equal(await page.locator('#percentage').textContent(),'35%');
  await page.getByRole('button',{name:'Open lid',exact:true}).click();
  assert.equal(await page.locator('.bin').evaluate(el=>el.classList.contains('open')),true);
  await page.locator('#fill').fill('95');
  assert.equal(await page.locator('#percentage').textContent(),'95%');
  await page.getByText('Full — empty the bin',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Empty bin',exact:true}).click();
  assert.equal(await page.locator('#percentage').textContent(),'0%');
  await page.getByRole('button',{name:'Start auto demo'}).click();
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('#percentage').textContent(),'5%');
  await page.getByRole('button',{name:'Stop auto demo'}).click();
  // Mock browser serial transport; exercise the same framing/read loop as USB.
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>({
      open:async()=>{},close:async()=>{},
      readable:new ReadableStream({start(controller){window.telemetry=controller;}})
    })}});
  });
  await page.getByRole('button',{name:'Connect ESP via USB'}).click();
  await page.evaluate(()=>window.telemetry.enqueue(new TextEncoder().encode('{"fill":82,"lidOpen":true}\n')));
  await page.getByText('ESP · live',{exact:true}).waitFor();
  assert.equal(await page.locator('#percentage').textContent(),'82%');
  assert.equal(await page.locator('#fill').isDisabled(),true);
  await page.getByRole('button',{name:'Return to simulation'}).click();
  await page.getByText('Simulation',{exact:true}).waitFor();
  assert.equal(await page.locator('#fill').isDisabled(),false);
  assert.equal(await page.locator('.brand img').evaluate(img=>img.complete && img.naturalWidth>0),true);
  await page.waitForTimeout(900);
  await page.screenshot({path:`${root}/desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${root}/mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: simulation, animations, thresholds, auto demo, USB transport, disconnect, logo, mobile layout; no browser errors.');
} finally {await browser.close();}
