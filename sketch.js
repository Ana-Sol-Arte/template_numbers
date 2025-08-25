// ===== Numbers: Zen Digit Dissolve (p5.js single-file, fixed) =====
// - Monochrome. The displayed number comes from ?num=... (default 131).
// - Slow "breathe": form → dissolve → reform using text-sampled particles.
// - Robust: no textBounds; samples entire offscreen buffer; no reserved-name conflicts.
//
// URL params:
//   ?num=137        -> number/string to display
//   ?dur=600        -> run time in seconds (shows tiny countdown HUD); omit to run indefinitely
//   ?breath=8       -> seconds for one inhale OR one exhale (default 6)

let DISPLAY_TEXT = "56";
let RUN_SECONDS = null;   // null = run indefinitely
let BREATH_SECONDS = 8;

let pg;                   // offscreen buffer to rasterize text
let particles = [];
let lastBuildKey = "";
let startMillis = 0;

const BG = 0;             // background: black
const FG = 255;           // foreground: white
const SAMPLE_STEP = 6;    // pixel step (bigger = fewer particles, faster)
const TARGET_SCALE = 0.78;// fraction of min(width,height) for text height
const MARGIN_FRAC = 0.12; // canvas margin around text box

// Motion tuning
const EXHALE_SPREAD = 28;          // max outward drift distance
const EXHALE_JITTER = 0.9;         // per-particle spread randomness
const INHALE_TIGHTNESS = 0.18;     // 0..1 tighten toward home on inhale
const DRIFT_NOISE_SCALE = 0.002;   // perlin field scale
const DRIFT_NOISE_STRENGTH = 0.9;  // field push on exhale

// HUD
const HUD_FADE = 140;

function getParams() {
  const u = new URL(window.location.href);
  const n = u.searchParams.get("num");
  if (n !== null && n.trim() !== "") DISPLAY_TEXT = n.trim();
  const d = u.searchParams.get("dur");
  if (d !== null) {
    const sec = parseInt(d, 10);
    if (Number.isFinite(sec) && sec > 0) RUN_SECONDS = sec;
  }
  const b = u.searchParams.get("breath");
  if (b !== null) {
    const sec = parseFloat(b);
    if (Number.isFinite(sec) && sec > 0.5) BREATH_SECONDS = sec;
  }
}

function setup() {
  getParams();
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);     // predictable sampling
  startMillis = millis();
  buildTextParticles();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildTextParticles();
}

function draw() {
  background(BG);

  // Rebuild on size/text change
  const buildKey = DISPLAY_TEXT + "|" + width + "x" + height;
  if (buildKey !== lastBuildKey) buildTextParticles();

  // Triangle-wave breath: tri goes 0..1..0 over a full inhale+exhale
  const t = millis() / 1000.0;
  const period = BREATH_SECONDS * 2;
  const phase = (t % period) / period;                 // 0..1
  const tri = phase < 0.5 ? (phase * 2.0) : (2.0 - phase * 2.0); // 0..1..0
  const exhale = 1.0 - tri;                            // 1 at most dissolved

  noStroke();
  for (let p of particles) {
    // Outward drift direction seeded by per-particle theta and noise
    const n = noise(p.home.x * DRIFT_NOISE_SCALE, p.home.y * DRIFT_NOISE_SCALE, t * 0.15);
    const ang = p.theta + n * TWO_PI;
    const spread = EXHALE_SPREAD * (0.4 + EXHALE_JITTER * p.rand); // <-- renamed from 'mag'
    const drift = createVector(cos(ang), sin(ang)).mult(spread * exhale);

    // Flow field push during exhale
    const f = flowForce(p.home.x, p.home.y, t).mult(DRIFT_NOISE_STRENGTH * exhale);
    drift.add(f);

    // Target = home + drift
    const target = p5.Vector.add(p.home, drift);

    // Ease toward target (looser on exhale, tighter on inhale)
    const easing = lerp(1.0 - INHALE_TIGHTNESS, 0.08, exhale);
    p.pos.x = lerp(p.pos.x, target.x, easing);
    p.pos.y = lerp(p.pos.y, target.y, easing);

    // Slightly brighter when formed
    const alpha = 200 + 55 * tri;
    fill(FG, alpha);
    circle(p.pos.x, p.pos.y, p.size);
  }

  if (RUN_SECONDS !== null) {
    const remaining = Math.max(0, RUN_SECONDS - (millis() - startMillis) / 1000);
    drawCountdown(remaining);
  }
}

function flowForce(x, y, t) {
  const s = 0.0013;
  const nx = noise(x * s, y * s, t * 0.07);
  const ny = noise((x + 999) * s, (y - 777) * s, t * 0.07);
  const ang = map(nx, 0, 1, -PI, PI);
  const magnitude = map(ny, 0, 1, 0.2, 1.0); // <-- renamed from 'mag'
  return createVector(cos(ang), sin(ang)).mult(magnitude);
}

function drawCountdown(remainingSec) {
  const mm = floor(remainingSec / 60);
  const ss = floor(remainingSec % 60);
  const txt = nf(mm, 2) + ":" + nf(ss, 2);
  push();
  textAlign(RIGHT, BOTTOM);
  textSize(14);
  fill(FG, HUD_FADE);
  noStroke();
  text(txt, width - 14, height - 12);
  pop();
}

function buildTextParticles() {
  // Layout: fit text height to TARGET_SCALE of min dimension, respecting margins.
  const minDim = min(width, height);
  const margin = minDim * MARGIN_FRAC;
  const targetH = minDim * TARGET_SCALE;

  // Create offscreen buffer and draw centered white text on black
  pg = createGraphics(width, height);
  pg.pixelDensity(1);
  pg.background(0);
  pg.fill(255);
  pg.noStroke();
  pg.textAlign(CENTER, CENTER);

  // Start with height target
  let ts = max(12, targetH);
  pg.textSize(ts);

  // If too wide for available width, shrink proportionally
  const availW = width - margin * 2;
  let wText = pg.textWidth(DISPLAY_TEXT);
  if (wText > availW) {
    ts = ts * (availW / wText);
    ts = max(12, ts);
    pg.textSize(ts);
  }

  // Draw the text centered
  pg.text(DISPLAY_TEXT, width / 2, height / 2);

  // Sample entire buffer (simple + robust)
  pg.loadPixels();
  particles = [];
  const pw = pg.width;
  const ph = pg.height;

  // Threshold for white pixels
  for (let y = 0; y < ph; y += SAMPLE_STEP) {
    for (let x = 0; x < pw; x += SAMPLE_STEP) {
      const idx = 4 * (y * pw + x);
      const r = pg.pixels[idx + 0];
      const g = pg.pixels[idx + 1];
      const b = pg.pixels[idx + 2];
      const a = pg.pixels[idx + 3];
      if (a > 10 && (r + g + b) > 500) {
        particles.push(makeParticle(x, y));
      }
    }
  }

  lastBuildKey = DISPLAY_TEXT + "|" + width + "x" + height;
}

function makeParticle(x, y) {
  const jitter = random(-2, 2);
  return {
    home: createVector(x, y),
    pos: createVector(x + jitter, y + jitter),
    size: random(1.6, 2.4),
    theta: random(TWO_PI),
    rand: random()
  };
}

// Quick test: press 'r' to swap in a random number
function keyTyped() {
  if (key === 'r') {
    DISPLAY_TEXT = String(floor(random(1, 9999)));
    buildTextParticles();
  }
}