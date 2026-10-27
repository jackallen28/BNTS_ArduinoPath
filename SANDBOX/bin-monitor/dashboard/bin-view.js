// Original model frames provide the bin/lid. Only the interior rubbish is drawn.
import {createPaperFillRenderer} from './paper-fill.js';
const SHELL_OPACITY=.24;
const FILL_TRANSITION_MS=700;
export function createBinView() {
  const root=document.createElement('div');
  root.className='bin source-bin';root.setAttribute('aria-hidden','true');
  root.dataset.mediaReady='false';root.dataset.bodyOpacity=String(SHELL_OPACITY);
  root.innerHTML='<canvas class="lid source-model" width="400" height="600"></canvas><span class="media-message">Loading your supplied bin animation…</span>';
  const canvas=root.querySelector('canvas');
  const context=canvas.getContext('2d',{alpha:false});
  const message=root.querySelector('.media-message');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let manifest,image,paperImage,papers,positions,end=0,playhead=0,target=0,request=null,previous=null,ready=false;
  let fill=0,fillTarget=0,fillFrom=0,fillStarted=0;
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  const requestedFill=()=>Math.max(0,Math.min(100,parseFloat(root.style.getPropertyValue('--fill'))||0));
  function draw() {
    let frame=0;
    while(frame<manifest.openFrame&&positions[frame+1]<=playhead)frame++;
    const x=(frame%manifest.columns)*manifest.width;
    const y=Math.floor(frame/manifest.columns)*manifest.height;
    const source=()=>context.drawImage(image,x,y,manifest.width,manifest.height,0,0,canvas.width,canvas.height);
    source();
    // Light passes through the timber panels, while the source frame/lid stay opaque.
    context.save();context.clip(papers.geometry.bodyPath);
    context.fillStyle='rgba(255,255,255,.52)';context.fillRect(0,0,canvas.width,canvas.height);
    context.restore();
    const stats=papers.draw(context,fill,paperImage);
    context.save();context.clip(papers.geometry.bodyPath);context.globalAlpha=SHELL_OPACITY;source();context.restore();
    // The aperture is exposed only late in the supplied opening sequence, so
    // rubbish never paints over the moving wooden flap or the fixed rear servo.
    const apertureOpacity=Math.max(0,Math.min(1,(frame/manifest.openFrame-.6)/.4));
    if(apertureOpacity>0){
      context.save();context.clip(papers.geometry.aperturePath);context.globalAlpha=apertureOpacity;
      papers.draw(context,fill,paperImage,{includeAperture:true});context.restore();
    }
    root.dataset.frame=String(frame);
    root.dataset.fillLevel=String(fill);
    root.dataset.paperCount=String(stats.paperCount);
    root.dataset.surfaceY=String(stats.surfaceY);
    root.dataset.playbackDirection=playhead===target?'still':target>playhead?'opening':'closing';
  }
  function schedule(){if(request===null){previous=null;request=requestAnimationFrame(tick);}}
  function tick(time){
    if(previous===null)previous=time;
    const elapsed=time-previous;previous=time;
    if(playhead!==target){
      playhead=target>playhead?Math.min(target,playhead+elapsed):Math.max(target,playhead-elapsed);
    }
    if(fill!==fillTarget){
      const progress=Math.min(1,Math.max(0,(time-fillStarted)/FILL_TRANSITION_MS));
      fill=progress===1?fillTarget:fillFrom+(fillTarget-fillFrom)*(1-(1-progress)**3);
    }
    draw();
    if(playhead!==target||fill!==fillTarget)request=requestAnimationFrame(tick);
    else{request=null;previous=null;}
  }
  function followState(){
    if(!ready)return;
    target=root.classList.contains('open')?end:0;
    const next=requestedFill();
    if(next!==fillTarget){fillFrom=fill;fillTarget=next;fillStarted=performance.now();}
    if(reducedMotion.matches){
      if(request!==null)cancelAnimationFrame(request);
      request=null;previous=null;playhead=target;fill=fillTarget;draw();return;
    }
    if(playhead!==target||fill!==fillTarget)schedule();
  }
  new MutationObserver(followState).observe(root,{attributes:true,attributeFilter:['class','style']});
  reducedMotion.addEventListener('change',followState);
  (async()=>{
    const response=await fetch('assets/bin-source-frames.json');
    if(!response.ok)throw new Error('Bin animation manifest missing');
    manifest=await response.json();
    image=new Image();image.src='assets/'+manifest.image;
    paperImage=new Image();paperImage.src='assets/crumpled-paper.webp';
    await Promise.all([image.decode(),paperImage.decode()]);
    canvas.width=manifest.width;canvas.height=manifest.height;
    papers=createPaperFillRenderer({width:canvas.width,height:canvas.height});
    root.style.aspectRatio=`${manifest.width} / ${manifest.height}`;
    positions=[0];
    for(let i=0;i<manifest.openFrame;i++)positions.push(positions.at(-1)+manifest.durationsMs[i]);
    end=positions.at(-1);fill=fillTarget=requestedFill();
    root.dataset.frameCount=String(manifest.frameCount);root.dataset.source=manifest.source;
    ready=true;root.dataset.mediaReady='true';message.remove();draw();followState();
  })().catch(()=>{message.textContent='Supplied bin animation unavailable. Check the local media files.';root.dataset.mediaReady='error';});
  return root;
}
