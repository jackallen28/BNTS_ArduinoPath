// In-bin paper capacity uses simulation or mocked Uno readings, not physical sensors.
// Controls sit on the Settings tab: tests press them there while the Bin tab stays on screen.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
const {chromium}=await import('playwright').catch(()=>import('../../BNTS_ArduinoPath/node_modules/playwright/index.mjs'));
const root=fileURLToPath(new URL('..',import.meta.url));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:1100}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.BIN_MONITOR_URL||'http://127.0.0.1:8092');
  await page.waitForFunction(()=>document.querySelector('.bin')?.dataset.mediaReady==='true');
  await page.evaluate(()=>{
    const note=document.createElement('div');
    note.textContent='Simulation preview · supplied bin frames with in-bin paper capacity';
    note.style.cssText='padding:12px;background:#fff1c7;text-align:center;margin-bottom:18px;border-radius:6px';
    document.body.prepend(note);
  });
  const bin=page.locator('.bin');
  const level=()=>bin.getAttribute('data-fill-level').then(Number);
  const count=()=>bin.getAttribute('data-paper-count').then(Number);
  const frame=()=>bin.getAttribute('data-frame').then(Number);
  const last=Number(await bin.getAttribute('data-frame-count'))-1;
  const waitLevel=target=>page.waitForFunction(target=>Number(document.querySelector('.bin').dataset.fillLevel)===target,target);
  const bodyHash=()=>page.locator('canvas').evaluate(canvas=>{
    const bytes=canvas.getContext('2d').getImageData(45,300,310,230).data;
    let hash=2166136261;
    for(const byte of bytes) hash=Math.imul(hash^byte,16777619);
    return hash>>>0;
  });
  const sourcePreserved=()=>page.evaluate(async()=>{
    const meta=await(await fetch('assets/bin-source-frames.json')).json();
    const image=new Image();image.src='assets/'+meta.image;await image.decode();
    const frame=Number(document.querySelector('.bin').dataset.frame);
    const expected=document.createElement('canvas');expected.width=meta.width;expected.height=meta.height;
    expected.getContext('2d',{alpha:false}).drawImage(image,(frame%meta.columns)*meta.width,Math.floor(frame/meta.columns)*meta.height,meta.width,meta.height,0,0,meta.width,meta.height);
    // Servo and fixed rear-deck region: only the body gets the transparency/fill overlay.
    const region=[210,110,40,35];
    const wanted=expected.getContext('2d').getImageData(...region).data;
    const actual=document.querySelector('canvas').getContext('2d').getImageData(...region).data;
    return wanted.every((byte,index)=>byte===actual[index]);
  });
  await page.locator('#fill').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},'0');await waitLevel(0);
  assert.equal(await count(),0,'empty bin contains no paper balls');
  const opacity=Number(await bin.getAttribute('data-body-opacity'));
  assert.ok(opacity>0&&opacity<1,'wooden shell is partly transparent');
  const emptyHash=await bodyHash();
  assert.equal(await sourcePreserved(),true,'original servo/deck pixels remain unchanged');
  await page.screenshot({path:join(root,'paper-empty.png'),fullPage:true});
  await page.locator('#fill').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},'50');
  await page.waitForFunction(()=>{const fill=Number(document.querySelector('.bin').dataset.fillLevel);return fill>0&&fill<50;});
  await waitLevel(50);
  const halfCount=await count(),halfHash=await bodyHash();
  assert.ok(halfCount>0,'half-full bin contains paper balls');
  assert.notEqual(halfHash,emptyHash,'paper fill changes rendered bin pixels');
  assert.equal(await sourcePreserved(),true);
  await page.screenshot({path:join(root,'paper-half.png'),fullPage:true});
  await page.locator('#fill').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},'100');await waitLevel(100);
  assert.ok(await count()>halfCount,'higher fill adds visible paper inside the bin');
  assert.notEqual(await bodyHash(),halfHash,'full bin image differs from half-full');
  assert.equal(await sourcePreserved(),true);
  await page.screenshot({path:join(root,'paper-full.png'),fullPage:true});
  const fullCount=await count();
  await page.getByRole('button',{name:'Open lid',exact:true,includeHidden:true}).evaluate(b=>b.click());
  await page.waitForFunction(last=>{const frame=Number(document.querySelector('.bin').dataset.frame);return frame>0&&frame<last;},last);
  await page.waitForFunction(last=>Number(document.querySelector('.bin').dataset.frame)===last,last);
  assert.equal(await level(),100,'lid animation does not change the measured capacity');
  assert.equal(await count(),fullCount,'paper pile persists when lid opens');
  await page.waitForTimeout(200);assert.equal(await frame(),last,'supplied animation holds open');
  await page.screenshot({path:join(root,'dashboard-open.png'),fullPage:true});
  await page.getByRole('button',{name:'Close lid',exact:true,includeHidden:true}).evaluate(b=>b.click());
  await page.waitForFunction(last=>{const frame=Number(document.querySelector('.bin').dataset.frame);return frame>0&&frame<last;},last);
  assert.equal(await bin.getAttribute('data-playback-direction'),'closing');
  await page.waitForFunction(()=>document.querySelector('.bin').dataset.frame==='0');
  assert.equal(await level(),100);assert.equal(await count(),fullCount);
  await page.screenshot({path:join(root,'dashboard-closed.png'),fullPage:true});

  // Capture actual composited renderer frames while the level rises and lid opens.
  const frames=join(root,'.paper-fill-frames');await mkdir(frames,{recursive:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#fill').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},'0');await waitLevel(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  const scene=page.locator('.scene');const bounds=await scene.boundingBox();
  const timings=[];const start=Date.now();
  const capture=async index=>{timings.push(Date.now()-start);await page.screenshot({path:join(frames,`${String(index).padStart(3,'0')}.png`),clip:bounds,animations:'allow'});};
  await capture(0);
  await page.locator('#fill').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},'100');
  for(let i=1;i<=12;i++){await page.waitForTimeout(90);await capture(i);}
  await page.getByRole('button',{name:'Open lid',exact:true,includeHidden:true}).evaluate(b=>b.click());
  for(let i=13;i<=26;i++){await page.waitForTimeout(80);await capture(i);}
  await waitLevel(100);
  await writeFile(join(frames,'timings.json'),JSON.stringify(timings));
  execFileSync('python3',['-c',String.raw`
from PIL import Image
from pathlib import Path
import json,sys
folder=Path(sys.argv[1]);times=json.loads((folder/'timings.json').read_text())
images=[Image.open(p).convert('RGB') for p in sorted(folder.glob('*.png'))]
durations=[max(20,times[i+1]-times[i]) for i in range(len(times)-1)]+[1000]
images[0].save(sys.argv[2],save_all=True,append_images=images[1:],duration=durations,loop=0,optimize=True)
`,frames,join(root,'fill-animation.gif')]);

  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile horizontal overflow');
  assert.equal(await page.evaluate(()=>{
    const scene=document.querySelector('.scene').getBoundingClientRect();
    const canvas=document.querySelector('.source-model').getBoundingClientRect();
    return canvas.left>=scene.left&&canvas.right<=scene.right&&canvas.top>=scene.top&&canvas.bottom<=scene.bottom;
  }),true,'mobile source animation and fill fit in scene');
  await page.screenshot({path:join(root,'dashboard-mobile.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#fill').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},'25');
  await page.waitForFunction(()=>Number(document.querySelector('.bin').dataset.fillLevel)===25,null,{timeout:500});
  // The same in-bin renderer must follow received Uno readings over Wi-Fi.
  const relay=await browser.newPage({viewport:{width:1000,height:1000}});
  relay.on('pageerror',error=>errors.push(error.message));
  let liveFill=0,linkConnected=true,sequence=1;
  const contentTypes={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
  await relay.route('http://192.168.4.1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/telemetry') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:linkConnected,receivedAgeMs:linkConnected?10:3000,telemetry:{fill:liveFill,lidOpen:false,sensorOk:true,ageMs:10,seq:sequence,closedSwitch:true,lidFault:false,homing:false}})});
    const filename=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!filename.startsWith(resolve(root)+'/')) return route.fulfill({status:403,body:'Forbidden'});
    try {await route.fulfill({status:200,contentType:contentTypes[extname(filename)]||'application/octet-stream',body:await readFile(filename)});}
    catch {await route.fulfill({status:404,body:'Missing source asset'});}
  });
  await relay.goto('http://192.168.4.1');
  await relay.waitForFunction(()=>document.querySelector('.bin')?.dataset.mediaReady==='true'&&Number(document.querySelector('.bin').dataset.fillLevel)===0);
  assert.equal(await relay.locator('.bin').getAttribute('data-paper-count'),'0');
  assert.equal(await relay.locator('#fill').isDisabled(),true,'live readings lock simulation controls');
  liveFill=75;sequence++;
  await relay.waitForFunction(()=>Number(document.querySelector('.bin').dataset.fillLevel)===75);
  const liveCount=Number(await relay.locator('.bin').getAttribute('data-paper-count'));
  assert.ok(liveCount>0,'Uno Wi-Fi readings fill paper inside the bin');
  assert.equal(await relay.locator('#percentage').textContent(),'75%');
  linkConnected=false;
  await relay.getByText('Uno · relay waiting',{exact:true}).waitFor();
  assert.equal(Number(await relay.locator('.bin').getAttribute('data-fill-level')),75,'stale UART retains last known level');
  liveFill=15;sequence++;linkConnected=true;
  await relay.waitForFunction(()=>Number(document.querySelector('.bin').dataset.fillLevel)===15);
  assert.ok(Number(await relay.locator('.bin').getAttribute('data-paper-count'))<liveCount,'new lower Uno reading reduces the pile');
  await relay.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: empty/half/full in-bin paper, translucent body, actual canvas changes, source servo/deck preservation, smooth simulation/Wi-Fi fill updates, stale-link retention, supplied forward/reverse lid playback, mobile fit and reduced motion. Captures use simulation data, not real hardware.');
} finally {await browser.close();}
