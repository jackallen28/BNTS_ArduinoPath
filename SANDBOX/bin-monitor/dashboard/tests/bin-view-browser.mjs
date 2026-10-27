// Verify playback of the user's supplied image frames, not a replacement model.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium} = await import('playwright').catch(()=>import('../../BNTS_ArduinoPath/node_modules/playwright/index.mjs'));
const root=fileURLToPath(new URL('..',import.meta.url));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:1100}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BIN_MONITOR_URL||'http://127.0.0.1:8090');
  await page.waitForFunction(()=>document.querySelector('.bin')?.dataset.mediaReady==='true');
  const frame=()=>page.locator('.bin').getAttribute('data-frame').then(Number);
  const last=Number(await page.locator('.bin').getAttribute('data-frame-count'))-1;
  assert.equal(await frame(),0);
  const closed=await page.locator('canvas').evaluate(c=>c.toDataURL());
  await page.getByRole('button',{name:'Open lid',exact:true}).click();
  await page.waitForFunction(last=>{const n=Number(document.querySelector('.bin').dataset.frame);return n>0&&n<last;},last);
  assert.equal(await page.locator('.bin').getAttribute('data-playback-direction'),'opening');
  await page.waitForFunction(last=>Number(document.querySelector('.bin').dataset.frame)===last,last);
  assert.notEqual(await page.locator('canvas').evaluate(c=>c.toDataURL()),closed);
  await page.waitForTimeout(300);assert.equal(await frame(),last,'holds open without looping');
  // The canvas must exactly match its selected source-atlas frame.
  assert.equal(await page.evaluate(async()=>{
    const meta=await(await fetch('assets/bin-source-frames.json')).json();
    const image=new Image();image.src='assets/'+meta.image;await image.decode();
    const expected=document.createElement('canvas');expected.width=meta.width;expected.height=meta.height;
    expected.getContext('2d',{alpha:false}).drawImage(image,(meta.openFrame%meta.columns)*meta.width,Math.floor(meta.openFrame/meta.columns)*meta.height,meta.width,meta.height,0,0,meta.width,meta.height);
    return expected.toDataURL()===document.querySelector('canvas').toDataURL();
  }),true,'displays original supplied pixels, not a redraw');
  await page.locator('#fill').fill('80');
  await page.evaluate(()=>{
    const note=document.createElement('div');note.textContent='Simulation preview · your supplied animation frames';note.style.cssText='padding:12px;background:#fff1c7;text-align:center;margin-bottom:18px;border-radius:6px';document.body.prepend(note);
  });
  await page.screenshot({path:root+'/dashboard-open.png',fullPage:true});
  await page.getByRole('button',{name:'Close lid',exact:true}).click();
  await page.waitForFunction(last=>{const n=Number(document.querySelector('.bin').dataset.frame);return n>0&&n<last;},last);
  assert.equal(await page.locator('.bin').getAttribute('data-playback-direction'),'closing');
  await page.waitForFunction(()=>document.querySelector('.bin').dataset.frame==='0');
  assert.equal(await page.locator('canvas').evaluate(c=>c.toDataURL()),closed);
  await page.waitForTimeout(200);assert.equal(await frame(),0,'holds closed without looping');
  await page.screenshot({path:root+'/dashboard-closed.png',fullPage:true});
  // A changed target reverses the same frames while an opening is underway.
  await page.getByRole('button',{name:'Open lid',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('.bin').dataset.frame)>3);
  await page.getByRole('button',{name:'Close lid',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.bin').dataset.frame==='0');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'Open lid',exact:true}).click();
  assert.equal(await frame(),last,'reduced motion jumps to supplied final image');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:root+'/dashboard-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: supplied-source pixels, forward opening, reverse closing, hold endpoints, mid-motion reversal, reduced motion, mobile fit. No replacement model generated.');
}finally{await browser.close();}
