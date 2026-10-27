import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
// Run after npm ci in ../BNTS_ArduinoPath and npm start in SANDBOX.
const { chromium } = await import('playwright').catch(() => import('../../BNTS_ArduinoPath/node_modules/playwright/index.mjs'));
// Controls sit on the Settings tab: tests press them there while the Bin tab stays on screen.
import assert from 'node:assert/strict';
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BIN_MONITOR_URL || 'http://127.0.0.1:8090');
  await page.getByRole('heading',{name:'Bin Monitor',exact:true}).waitFor();
  assert.equal(await page.locator('#percentage').textContent(),'35%');
  // The Bin tab shows the lid (CLOSED, green) and the fill; Settings holds the controls.
  assert.equal(await page.locator('#lid-state').textContent(),'CLOSED');
  assert.equal(await page.locator('#panel-settings').isHidden(),true);
  await page.getByRole('tab',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Open lid',exact:true}).waitFor();
  assert.equal(await page.locator('#panel-bin').isHidden(),true);
  await page.getByRole('tab',{name:'Bin',exact:true}).click();
  assert.equal(await page.locator('#panel-settings').isHidden(),true);
  const barColour=()=>page.locator('.fill-bar').evaluate(el=>getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number));
  await page.getByRole('button',{name:'Open lid',exact:true,includeHidden:true}).evaluate(b=>b.click());
  assert.equal(await page.locator('.bin').evaluate(el=>el.classList.contains('open')),true);
  await page.waitForFunction(()=>document.querySelector('#lid-state').textContent==='MOVING');
  assert.match(await page.locator('#lid-state').getAttribute('class'),/moving/);
  await page.waitForFunction(()=>document.querySelector('#lid-state').textContent==='OPEN');
  assert.match(await page.locator('#lid-state').getAttribute('class'),/open/);
  await page.locator('#fill').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},'95');
  assert.equal(await page.locator('#percentage').textContent(),'95%');
  await page.getByText('Full — empty the bin',{exact:true}).first().waitFor();
  await page.waitForTimeout(800); // the bar's colour fades
  { const [r,g]=await barColour(); assert.ok(r>g*2,'nearly full is red'); }
  await page.getByRole('button',{name:'Empty bin',exact:true,includeHidden:true}).evaluate(b=>b.click());
  assert.equal(await page.locator('#percentage').textContent(),'0%');
  await page.waitForTimeout(800);
  { const [r,g]=await barColour(); assert.ok(g>r*2,'empty is green'); }
  await page.getByRole('button',{name:'Start auto demo',includeHidden:true}).evaluate(b=>b.click());
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('#percentage').textContent(),'5%');
  await page.getByRole('button',{name:'Stop auto demo',includeHidden:true}).evaluate(b=>b.click());
  // Mock browser serial transport; exercise the same framing/read loop as USB.
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>({
      open:async()=>{},close:async()=>{},
      readable:new ReadableStream({start(controller){window.telemetry=controller;}})
    })}});
  });
  await page.getByRole('button',{name:'Connect Uno via USB',includeHidden:true}).evaluate(b=>b.click());
  await page.evaluate(()=>window.telemetry.enqueue(new TextEncoder().encode('{"fill":82,"lidOpen":true}\n')));
  await page.getByText('Uno · USB live',{exact:true}).waitFor();
  assert.equal(await page.locator('#percentage').textContent(),'82%');
  const {crc16Ccitt} = await import('../model.js');
  const payload = JSON.stringify({fill:63,lidOpen:false,sensorOk:true,ageMs:10,seq:4,closedSwitch:true,lidFault:false,homing:false});
  const frame = '@'+payload+'*'+crc16Ccitt(payload).toString(16).padStart(4,'0')+'\n';
  await page.evaluate(line=>window.telemetry.enqueue(new TextEncoder().encode(line)),frame);
  await page.waitForFunction(()=>document.querySelector('#percentage').textContent==='63%');
  assert.match(await page.locator('#controller-status').textContent(),/pressed/);
  assert.equal(await page.locator('#fill').isDisabled(),true);
  await page.getByRole('button',{name:'Return to simulation',includeHidden:true}).evaluate(b=>b.click());
  await page.getByText('Simulation',{exact:true}).waitFor();
  assert.equal(await page.locator('#fill').isDisabled(),false);
  assert.equal(await page.locator('.brand img').evaluate(img=>img.complete && img.naturalWidth>0),true);
  await page.waitForTimeout(900);
  await page.screenshot({path:`${root}/desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${root}/mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: tabs, lid OPEN/CLOSED/MOVING colours, green-to-red fill bar, simulation, animations, thresholds, auto demo, USB transport, disconnect, logo, mobile layout; no browser errors.');
} finally {await browser.close();}
