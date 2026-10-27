// The supplied model's pixels, played forward to open and backward to close.
// No replacement bin geometry or AI-generated model is rendered here.
export function createBinView() {
  const root = document.createElement('div');
  root.className = 'bin source-bin';
  root.setAttribute('aria-hidden', 'true');
  root.dataset.mediaReady = 'false';
  root.innerHTML = `<canvas class="lid source-model" width="400" height="600"></canvas>
    <span class="media-message">Loading your supplied bin animation…</span>
    <div class="bin-level-gauge"><span class="gauge-title">FILL</span>
      <div class="gauge-track"><div class="fill"></div></div>
      <span class="gauge-zero">0</span><span class="gauge-full">100</span>
    </div>`;
  const canvas = root.querySelector('canvas');
  const context = canvas.getContext('2d', {alpha:false});
  const message = root.querySelector('.media-message');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let manifest, image, positions, end = 0, playhead = 0, target = 0, request = null, previous = null;
  context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height);
  function draw() {
    let frame = 0;
    while (frame < manifest.openFrame && positions[frame+1] <= playhead) frame++;
    const x = (frame % manifest.columns)*manifest.width;
    const y = Math.floor(frame/manifest.columns)*manifest.height;
    context.drawImage(image,x,y,manifest.width,manifest.height,0,0,canvas.width,canvas.height);
    root.dataset.frame = String(frame);
  }
  function tick(time) {
    if (previous === null) previous = time;
    const elapsed = time-previous; previous = time;
    playhead += target > playhead ? elapsed : -elapsed;
    if ((target === end && playhead >= end) || (target === 0 && playhead <= 0)) {
      playhead = target; draw(); request = null; previous = null;
      root.dataset.playbackDirection = 'still'; return;
    }
    draw(); request = requestAnimationFrame(tick);
  }
  function followLid() {
    if (!manifest) return;
    target = root.classList.contains('open') ? end : 0;
    if (reducedMotion.matches) {
      if (request !== null) cancelAnimationFrame(request);
      request = null; previous = null; playhead = target; draw();
      root.dataset.playbackDirection = 'still'; return;
    }
    if (playhead === target) return;
    root.dataset.playbackDirection = target > playhead ? 'opening' : 'closing';
    if (request === null) { previous = null; request = requestAnimationFrame(tick); }
  }
  new MutationObserver(followLid).observe(root,{attributes:true,attributeFilter:['class']});
  reducedMotion.addEventListener('change',followLid);
  (async () => {
    const response = await fetch('assets/bin-source-frames.json');
    if (!response.ok) throw new Error('Bin animation manifest missing');
    manifest = await response.json();
    image = new Image(); image.src = 'assets/'+manifest.image; await image.decode();
    canvas.width = manifest.width; canvas.height = manifest.height;
    root.style.aspectRatio = `${manifest.width} / ${manifest.height}`;
    positions = [0];
    for (let i=0;i<manifest.openFrame;i++) positions.push(positions.at(-1)+manifest.durationsMs[i]);
    end = positions.at(-1);
    root.dataset.frameCount = String(manifest.frameCount);
    root.dataset.source = manifest.source;
    root.dataset.mediaReady = 'true';
    message.remove(); draw(); followLid();
  })().catch(() => { message.textContent = 'Supplied bin animation unavailable. Check the local media files.'; root.dataset.mediaReady = 'error'; });
  return root;
}
