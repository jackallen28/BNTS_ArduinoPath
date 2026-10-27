// A capacity illustration inside the supplied model's timber body.
// Only the rubbish is drawn here; the original bin/lid image stays the source.
const SOURCE_WIDTH = 400;
const SOURCE_HEIGHT = 613;
export const PAPER_BIN_POINTS = Object.freeze({
  front: [[31,207],[201,300],[201,568],[31,474]],
  side: [[205,300],[369,208],[369,474],[205,568]],
  aperture: [[60,184],[137,143],[274,219],[204,261]],
  farBase: [198,388],
  nearBase: [203,564],
  height: 264,
});

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function polygon(points, sx, sy) {
  const path = new Path2D();
  path.moveTo(points[0][0] * sx, points[0][1] * sy);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i][0] * sx, points[i][1] * sy);
  path.closePath();
  return path;
}

function makeBalls() {
  const next = random(0xB17C0DE);
  const balls = [];
  for (let layer = 0; layer < 8; layer++) {
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 5; column++) {
        const u = clamp((column + .5 + (next() - .5) * .58) / 5, .05, .95);
        const v = clamp((row + .5 + (next() - .5) * .58) / 5, .05, .95);
        const depth = (u + v) / 2;
        const radius = (21 + next() * 5) * (.83 + depth * .22);
        const z = 18 + layer * 32 + (next() - .5) * 4;
        const x = PAPER_BIN_POINTS.farBase[0] - 158 * u + 163 * v;
        const baseY = PAPER_BIN_POINTS.farBase[1] + 85 * u + 91 * v;
        const shape = [];
        for (let vertex = 0; vertex < 9; vertex++) {
          const angle = vertex * Math.PI * 2 / 9;
          const r = .78 + next() * .22;
          shape.push([Math.cos(angle) * r, Math.sin(angle) * r]);
        }
        balls.push({ id: balls.length, layer, x, baseY, z, radius,
          rotation: next() * Math.PI * 2, squash: .82 + next() * .18,
          shade: Math.floor(next() * 11), shape });
      }
    }
  }
  return balls;
}

// A compact fallback while the optional real-paper sprite is loading.
function facetedPaper(ctx, ball) {
  const path = new Path2D();
  for (let i = 0; i < ball.shape.length; i++) {
    const [x,y] = ball.shape[i];
    if (i === 0) path.moveTo(x,y); else path.lineTo(x,y);
  }
  path.closePath();
  ctx.fillStyle = `rgb(${250-ball.shade},${249-ball.shade},${244-ball.shade})`;
  ctx.strokeStyle = 'rgba(114,119,115,.46)';
  ctx.lineWidth = .035;
  ctx.fill(path); ctx.stroke(path);
  ctx.save(); ctx.clip(path);
  const facets = [
    [-.83,-.28,-.10,-.68,.13,.09,'#ffffff'],
    [-.10,-.68,.76,-.36,.13,.09,'#e2e4df'],
    [.76,-.36,.64,.65,.13,.09,'#fdfdf9'],
    [.64,.65,-.40,.78,.13,.09,'#cfd4ce'],
    [-.40,.78,-.83,-.28,.13,.09,'#e8ebe4'],
  ];
  for (const [x1,y1,x2,y2,x3,y3,color] of facets) {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.closePath();
    ctx.fillStyle=color; ctx.globalAlpha *= .76; ctx.fill(); ctx.globalAlpha /= .76;
  }
  ctx.beginPath();
  ctx.moveTo(-.68,-.1);ctx.lineTo(.11,.08);ctx.lineTo(.44,.61);
  ctx.moveTo(.11,.08);ctx.lineTo(.31,-.55);
  ctx.moveTo(-.26,.65);ctx.lineTo(-.13,.17);ctx.lineTo(-.44,-.41);
  ctx.strokeStyle='rgba(112,119,111,.40)';ctx.lineWidth=.022;ctx.stroke();
  ctx.restore();
}

export function createPaperFillRenderer({ width = SOURCE_WIDTH, height = SOURCE_HEIGHT } = {}) {
  const sx = width / SOURCE_WIDTH, sy = height / SOURCE_HEIGHT;
  const frontPath = polygon(PAPER_BIN_POINTS.front,sx,sy);
  const sidePath = polygon(PAPER_BIN_POINTS.side,sx,sy);
  const aperturePath = polygon(PAPER_BIN_POINTS.aperture,sx,sy);
  const bodyPath = new Path2D(); bodyPath.addPath(frontPath); bodyPath.addPath(sidePath);
  const openInteriorPath = new Path2D(); openInteriorPath.addPath(bodyPath);openInteriorPath.addPath(aperturePath);
  const balls = makeBalls();
  const geometry = { frontPath, sidePath, bodyPath, aperturePath, openInteriorPath,
    points: PAPER_BIN_POINTS, width, height, maxPaperCount: balls.length };

  function draw(ctx, percentage, paperImage = null, { includeAperture = false } = {}) {
    const percent = Number.isFinite(percentage) ? clamp(percentage,0,100) : 0;
    const fillHeight = PAPER_BIN_POINTS.height * percent / 100;
    if (percent === 0) return { paperCount:0, visibleCount:0, surfaceY:PAPER_BIN_POINTS.nearBase[1]*sy, fillHeight:0 };
    const visible = [];
    for (const ball of balls) {
      const reveal = clamp((fillHeight - (ball.z - ball.radius * .7)) / ball.radius,0,1);
      if (reveal <= .001) continue;
      const z = Math.min(ball.z,fillHeight - ball.radius * .1);
      visible.push({ ...ball, opacity:reveal, y:ball.baseY-z });
    }
    visible.sort((a,b) => a.y-b.y || a.id-b.id);
    ctx.save();
    ctx.clip(includeAperture ? openInteriorPath : bodyPath);
    ctx.scale(sx,sy);
    // A soft internal floor makes sparse low levels read as depth, not stickers.
    ctx.save();
    ctx.globalAlpha*=.06*Math.min(1,percent/10);
    ctx.fillStyle='#566c62';ctx.beginPath();
    ctx.moveTo(40,474);ctx.lineTo(198,388);ctx.lineTo(364,474);ctx.lineTo(203,564);ctx.closePath();ctx.fill();
    ctx.restore();
    const textured = !!(paperImage && paperImage.complete && paperImage.naturalWidth);
    for (const ball of visible) {
      ctx.save();ctx.translate(ball.x,ball.y);ctx.rotate(ball.rotation);
      ctx.scale(ball.radius,ball.radius*ball.squash);
      ctx.globalAlpha*=ball.opacity;
      ctx.shadowColor='rgba(42,56,45,.22)';ctx.shadowBlur=2/ball.radius;ctx.shadowOffsetY=.07;
      if (textured) ctx.drawImage(paperImage,-1.10,-1.10,2.2,2.2);
      else facetedPaper(ctx,ball);
      ctx.restore();
    }
    ctx.restore();
    return { paperCount:visible.length,visibleCount:visible.length,
      surfaceY:(PAPER_BIN_POINTS.nearBase[1]-fillHeight)*sy,fillHeight:fillHeight*sy };
  }
  return { draw, geometry };
}
