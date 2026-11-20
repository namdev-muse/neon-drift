// Neon Drift v0.3.0 — 3D neon tunnel racer (Three.js 0.160.0, no build step).
// The ship auto-flies forward through a neon tunnel; the player steers in
// the cross-section with momentum and banking. Dodge blocks, mines and
// moving barrier walls; thread magenta boost gates; collect gold energy
// cells. 3 shields — a hit costs one and stuns; lose all three and the
// run ends. Score from distance + gates + cells; best distance saved per
// track. No assist of any kind: no auto-steer, no oracle, no line that
// plays for you — steering is the skill.
import * as THREE from 'three';
import {
  VERSION, TRACKS, trackById, buildTrack, barrierGapAt, createRun, stepRun,
  greedyPolicy, clamp, TUNNEL_RADIUS, SHIP_RADIUS, SHIELDS, BOOST_MAX,
  FEEDBACK, DT, defaultSave, serializeSave, parseSave, recordBest,
} from './physics.js';

const SAVE_KEY = 'neon-drift-save-v1';
const $ = (id) => document.getElementById(id);

// --- save ---
let save = defaultSave();
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) save = parseSave(raw);
} catch { /* private mode: play without saving */ }
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, serializeSave(save)); } catch { /* ignore */ }
}

// --- settings (from save + defaults) ---
let volume = 0.6;
let musicOn = true, sfxOn = true, reduceFlashing = false;
let shakeStrength = save.shake ?? 1;
let muted = save.muted ?? false;

// --- three.js setup ---
const container = $('game-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070818);
scene.fog = new THREE.FogExp2(0x070818, 0.0035);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 1.2, -8.5);

scene.add(new THREE.HemisphereLight(0x8ecbff, 0x1a0b2e, 0.9));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(4, 8, -6);
scene.add(dirLight);
const shipLight = new THREE.PointLight(0x22d3ee, 1.6, 18);
shipLight.position.set(0, 0, -2);
scene.add(shipLight);

// --- shared geometries / materials ---
const GEO = {
  ring: new THREE.TorusGeometry(TUNNEL_RADIUS, 0.09, 8, 64),
  block: new THREE.BoxGeometry(1, 1, 1.4),
  mine: new THREE.SphereGeometry(1.1, 20, 14),
  mineSpike: new THREE.ConeGeometry(0.28, 0.9, 6),
  barrier: new THREE.RingGeometry(1, TUNNEL_RADIUS, 48),
  barrierRim: new THREE.TorusGeometry(1, 0.14, 8, 48),
  gate: new THREE.TorusGeometry(2.4, 0.18, 10, 40),
  cell: new THREE.OctahedronGeometry(0.8),
  shipCone: new THREE.ConeGeometry(0.55, 1.9, 6),
  shipWing: new THREE.BoxGeometry(1.9, 0.08, 0.7),
  shipFin: new THREE.BoxGeometry(0.08, 0.9, 0.7),
  shipGlow: new THREE.SphereGeometry(0.3, 12, 10),
};

// Tunnel rings (recycled, streaming past the camera).
const RING_COUNT = 36, RING_SPACING = 7;
const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 });
const rings = [];
for (let i = 0; i < RING_COUNT; i++) {
  const m = new THREE.Mesh(GEO.ring, ringMat);
  scene.add(m);
  rings.push(m);
}
// Faint wireframe tunnel wall for depth.
const wallGeo = new THREE.CylinderGeometry(TUNNEL_RADIUS, TUNNEL_RADIUS, 280, 24, 1, true);
const wallMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.12, side: THREE.BackSide });
const wall = new THREE.Mesh(wallGeo, wallMat);
wall.rotation.x = Math.PI / 2;
wall.position.z = 120;
scene.add(wall);

// Starfield (parallax: drifts slower than the tunnel).
const STAR_COUNT = 700;
const starGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 14 + Math.random() * 55;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r;
    pos[i * 3 + 2] = -20 + Math.random() * 420;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xbfe9ff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.8 });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// Nebula glow sprites (canvas radial gradient, additive).
function nebulaTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const nebulaTex = nebulaTexture('rgba(124, 58, 237, 0.55)', 'rgba(7, 8, 24, 0)');
const nebulaMat = new THREE.SpriteMaterial({ map: nebulaTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const nebula = new THREE.Sprite(nebulaMat);
nebula.scale.set(320, 320, 1);
nebula.position.set(0, 0, 200);
scene.add(nebula);
const nebula2 = new THREE.Sprite(nebulaMat.clone());
nebula2.scale.set(180, 180, 1);
nebula2.position.set(-40, 30, 260);
scene.add(nebula2);

// --- the ship ---
const ship = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0e7490, emissive: 0x22d3ee, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.3 });
  const cone = new THREE.Mesh(GEO.shipCone, bodyMat);
  cone.rotation.x = Math.PI / 2; // point forward (+z)
  ship.add(cone);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x155e75, emissive: 0x0891b2, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.35 });
  const wing = new THREE.Mesh(GEO.shipWing, wingMat);
  wing.position.z = -0.5;
  ship.add(wing);
  const fin = new THREE.Mesh(GEO.shipFin, wingMat);
  fin.position.z = -0.5;
  ship.add(fin);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
  const glow = new THREE.Mesh(GEO.shipGlow, glowMat);
  glow.position.z = -1.0;
  ship.add(glow);
  // M3: the ship reads as a glowing form from the chase view — give it
  // a canopy and twin engine glows so it has a silhouette, not just a
  // cone. The engine glows pulse with speed/boost (see updateScene).
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, emissive: 0xfbbf24, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.2 });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), canopyMat);
  canopy.scale.set(1, 0.7, 1.6);
  canopy.position.set(0, 0.28, 0.35);
  ship.add(canopy);
  const engineGlowMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 });
  const engineL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), engineGlowMat);
  engineL.position.set(-0.55, 0, -0.95);
  ship.add(engineL);
  const engineR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), engineGlowMat);
  engineR.position.set(0.55, 0, -0.95);
  ship.add(engineR);
  ship.userData.engineGlows = [engineL, engineR];
  ship.userData.engineMat = engineGlowMat;
  ship.userData.canopyMat = canopyMat;
}
scene.add(ship);

// Ship trail: a fading line of recent positions.
const TRAIL_LEN = 30;
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL_LEN * 3);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
const trailMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.7 });
const trail = new THREE.Line(trailGeo, trailMat);
trail.frustumCulled = false;
scene.add(trail);
const trailHist = [];

// --- pooled particles (round soft sparks, not squares) ---
const P_COUNT = 300;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(P_COUNT * 3);
const pCol = new Float32Array(P_COUNT * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
// A soft circular sprite: the default PointsMaterial quad renders as a
// hard square, which read as beige debris floating in the tunnel.
function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const pMat = new THREE.PointsMaterial({ size: 0.9, map: sparkTexture(), vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const points = new THREE.Points(pGeo, pMat);
points.frustumCulled = false;
scene.add(points);
const particles = [];
for (let i = 0; i < P_COUNT; i++) {
  particles.push({ life: 0, max: 1, x: 0, y: 0, z: -999, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 });
  pPos[i * 3 + 2] = -999;
}
let pCursor = 0;
function spawnParticles(x, y, z, colorHex, n, speed, life = 0.7) {
  const c = new THREE.Color(colorHex);
  for (let k = 0; k < n; k++) {
    const p = particles[pCursor];
    pCursor = (pCursor + 1) % P_COUNT;
    p.life = p.max = life * (0.6 + Math.random() * 0.8);
    p.x = x; p.y = y; p.z = z;
    const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
    const s = speed * (0.4 + Math.random() * 0.8);
    p.vx = Math.cos(a) * Math.cos(b) * s;
    p.vy = Math.sin(a) * Math.cos(b) * s;
    p.vz = Math.sin(b) * s - 2;
    p.r = c.r; p.g = c.g; p.b = c.b;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < P_COUNT; i++) {
    const p = particles[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { pPos[i * 3 + 2] = -999; continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vx *= 0.98; p.vy *= 0.98; p.vz *= 0.98;
    const fade = p.life / p.max;
    pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
    pCol[i * 3] = p.r * fade; pCol[i * 3 + 1] = p.g * fade; pCol[i * 3 + 2] = p.b * fade;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

// --- audio (Web Audio synth SFX + ambient pad) ---
let audioCtx = null, masterGain = null, musicGain = null, sfxGain = null;
let boostOsc = null, boostGain = null, musicNodes = null;
function ensureAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : volume;
    masterGain.connect(audioCtx.destination);
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = sfxOn ? 1 : 0;
    sfxGain.connect(masterGain);
    musicGain = audioCtx.createGain();
    musicGain.gain.value = musicOn ? 0.5 : 0;
    musicGain.connect(masterGain);
    startMusic();
    startMusicSequencer();
    // Boost hum: a quiet sawtooth whose gain follows the boost state.
    boostOsc = audioCtx.createOscillator();
    boostOsc.type = 'sawtooth';
    boostOsc.frequency.value = 90;
    boostGain = audioCtx.createGain();
    boostGain.gain.value = 0;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    boostOsc.connect(lp); lp.connect(boostGain); boostGain.connect(sfxGain);
    boostOsc.start();
  } catch { audioCtx = null; }
}
function startMusic() {
  if (!audioCtx || musicNodes) return;
  const o1 = audioCtx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
  const o2 = audioCtx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 82.5;
  const o3 = audioCtx.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 110.3;
  const g = audioCtx.createGain(); g.gain.value = 0.06;
  const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
  const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 140;
  lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
  o1.connect(lp); o2.connect(lp); o3.connect(lp); lp.connect(g); g.connect(musicGain);
  o1.start(); o2.start(); o3.start(); lfo.start();
  musicNodes = { o1, o2, o3, lfo };
}
function tone(freq, dur, type = 'sine', vol = 0.25, slideTo = null) {
  if (!audioCtx || !sfxGain || muted) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(sfxGain);
  o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(dur, vol, freq = 800) {
  if (!audioCtx || !sfxGain || muted) return;
  const t = audioCtx.currentTime;
  const len = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = audioCtx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(sfxGain);
  src.start(t);
}
// M3: a filtered noise sweep — the whoosh for near-miss and boost.
// The filter sweeps up (whoosh past) instead of a flat burst, so it
// reads as motion, not static.
function whoosh(dur = 0.35, vol = 0.22, from = 300, to = 2400) {
  if (!audioCtx || !sfxGain || muted) return;
  const t = audioCtx.currentTime;
  const len = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const f = audioCtx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(sfxGain);
  src.start(t);
}
// M3: the same tone never plays twice at exactly the same pitch —
// a ±5% detune keeps repeated gates/cells from machine-gunning.
function detune(freq) { return freq * (0.95 + Math.random() * 0.1); }
const sfx = {
  tick() { tone(1200, 0.05, 'square', 0.06); },
  gate() { tone(detune(880), 0.12, 'sine', 0.22); setTimeout(() => tone(detune(1320), 0.16, 'sine', 0.2), 70); },
  collect() { tone(detune(660), 0.09, 'sine', 0.2, detune(990)); },
  nearMiss() { whoosh(0.3, 0.2, 400, 2600); tone(detune(440), 0.14, 'sine', 0.1, 330); },
  boostStart() { whoosh(0.45, 0.25, 200, 1800); },
  hit() { noiseBurst(0.25, 0.4, 600); tone(110, 0.3, 'square', 0.25, 55); },
  complete() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'sine', 0.2), i * 90)); },
  runOver() { tone(220, 0.5, 'sawtooth', 0.25, 55); noiseBurst(0.4, 0.3, 400); },
  launch() { tone(220, 0.25, 'sine', 0.18, 660); },
};

// --- music: generative synthwave sequencer (M3) ---
// The M1 pad was a static drone. Now a lookahead scheduler plays a
// bass line (A minor) plus a sparse pentatonic arpeggio over the pad,
// at ~104 BPM. The arpeggio doubles in density as the ship speeds up,
// so the music follows the run — quiet in the menu, driving at full
// speed. It starts on the first user gesture (ensureAudio) and stops
// cleanly when the music toggle goes off; every node is created once
// and reused, so there is no per-note allocation churn.
const MUSIC_BPM = 104;
const MUSIC_BASS = [55, 55, 65.41, 49, 55, 55, 82.41, 73.42]; // A1 A1 C2 G1 A1 A1 E2 D2
const MUSIC_ARP = [220, 261.63, 329.63, 392, 440, 523.25, 659.25]; // A3 C4 E4 G4 A4 C5 E5
let musicTimer = null, musicNextBeat = 0, musicStep = 0;
function musicNote(freq, when, dur, vol, type = 'sine') {
  if (!audioCtx || !musicGain) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  const f = audioCtx.createBiquadFilter();
  o.type = type; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.value = 1400;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  o.connect(f); f.connect(g); g.connect(musicGain);
  o.start(when); o.stop(when + dur + 0.02);
}
function scheduleMusic() {
  if (!audioCtx || !musicGain) return;
  const beatLen = 60 / MUSIC_BPM;
  // Schedule ~200ms ahead so timing stays tight even at low fps.
  while (musicNextBeat < audioCtx.currentTime + 0.2) {
    const step = musicStep % 8;
    const when = musicNextBeat;
    // Bass on every beat (quiet, sawtooth through the pad filter).
    musicNote(MUSIC_BASS[step], when, beatLen * 0.9, 0.16, 'triangle');
    // Arpeggio: one note per beat at low speed, two per beat when the
    // ship is flying fast — the music accelerates with the run.
    const speedNorm = phase === 'run' && run ? clamp((run.speed - 12) / 22, 0, 1) : 0;
    const arpNotes = speedNorm > 0.55 ? 2 : 1;
    for (let k = 0; k < arpNotes; k++) {
      const idx = (step * 2 + k * 3 + Math.floor(musicStep / 8)) % MUSIC_ARP.length;
      musicNote(MUSIC_ARP[idx], when + (k * beatLen) / arpNotes, beatLen * 0.45, 0.05);
    }
    musicNextBeat += beatLen;
    musicStep++;
  }
}
function startMusicSequencer() {
  if (!audioCtx || musicTimer) return;
  musicNextBeat = audioCtx.currentTime + 0.1;
  musicStep = 0;
  musicTimer = setInterval(scheduleMusic, 100);
}
function stopMusicSequencer() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

// --- game state ---
let phase = 'menu'; // menu | run | paused | complete | runover
let selectedTrackId = 1;
let track = TRACKS[0];
let run = null;
let demoRun = null; // attract-mode flight behind the menu
let entityMeshes = []; // { entity, mesh, spin? }
let trackMats = []; // per-track materials, disposed on unload
let trauma = 0;
let hitStopUntil = 0; // real time (performance.now ms)
let slowMoUntil = 0;
let timeScale = 1;
let accumulator = 0;
let lastFrame = performance.now();
let fovCurrent = 72;
let fovPulse = 0; // M3: extra FOV kick, decays to 0 (rest = 72)
let knockback = 0; // M3: camera z push on hits, decays to 0 (rest = -8.5)
let shipSquash = 0; // M3: ship scale pop on hits, decays to 0 (rest = 1)
let glowPulse = 0; // M3: engine glow pulse on gate/collect, decays to 0
let camRoll = 0; // M3: roll applied to the camera each frame (rest = 0)
let toastTimer = null;
let autoPilot = false;
let hookSteer = null; // { sx, sy } | null — test/bot hook
let steerTarget = null; // { x, y } | null — steer toward a point
const keys = new Set();
const screenStack = []; // overlay ids, top = current

// Drag steering (relative: drag delta -> steering input).
let dragging = false, dragStartX = 0, dragStartY = 0, dragX = 0, dragY = 0;

// --- track meshes ---
function loadTrackMeshes(t) {
  unloadTrackMeshes();
  track = t;
  const built = buildTrack(t);
  const theme = t.theme;
  ringMat.color.set(theme.ring);
  wallMat.color.set(theme.ring);
  scene.fog.color.set(theme.disc);
  scene.background.set(theme.disc);
  nebulaMat.color.set(theme.tint);
  nebula2.material.color.set(theme.accent);

  const blockMat = new THREE.MeshStandardMaterial({ color: 0x4c1d95, emissive: 0x7c3aed, emissiveIntensity: 0.85, metalness: 0.4, roughness: 0.4 });
  const mineMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, emissive: 0xef4444, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.3 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xef4444, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.4 });
  const barrierMat = new THREE.MeshBasicMaterial({ color: theme.ring, transparent: true, opacity: 0.34, side: THREE.DoubleSide });
  const barrierRimMat = new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.9 });
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x9d174d, emissive: 0xf472b6, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.3 });
  const cellMat = new THREE.MeshStandardMaterial({ color: 0x92400e, emissive: 0xfbbf24, emissiveIntensity: 1.6, metalness: 0.5, roughness: 0.25 });
  trackMats = [blockMat, mineMat, spikeMat, barrierMat, barrierRimMat, gateMat, cellMat];

  for (const e of built.entities) {
    let mesh = null, spin = false;
    if (e.kind === 'block') {
      mesh = new THREE.Mesh(GEO.block, blockMat);
      mesh.scale.set(e.hw * 2, e.hh * 2, 1);
    } else if (e.kind === 'mine') {
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(GEO.mine, mineMat));
      for (let s = 0; s < 6; s++) {
        const spike = new THREE.Mesh(GEO.mineSpike, spikeMat);
        const a = (s / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0);
        spike.rotation.z = a - Math.PI / 2;
        mesh.add(spike);
      }
      spin = true;
    } else if (e.kind === 'barrier') {
      mesh = new THREE.Group();
      const wallMesh = new THREE.Mesh(GEO.barrier, barrierMat);
      wallMesh.scale.set(e.gapR, e.gapR, 1);
      // The ring geometry spans 1..TUNNEL_RADIUS; scale the hole by
      // drawing the ring with inner radius gapR: rebuild per barrier.
      const ringGeo = new THREE.RingGeometry(e.gapR, TUNNEL_RADIUS, 48);
      wallMesh.geometry = ringGeo;
      mesh.add(wallMesh);
      const rim = new THREE.Mesh(GEO.barrierRim, barrierRimMat);
      rim.scale.set(e.gapR, e.gapR, 1);
      mesh.add(rim);
      mesh.userData.ringGeo = ringGeo;
    } else if (e.kind === 'gate') {
      mesh = new THREE.Mesh(GEO.gate, gateMat);
      spin = true;
    } else if (e.kind === 'cell') {
      mesh = new THREE.Mesh(GEO.cell, cellMat);
      spin = true;
    }
    if (!mesh) continue;
    mesh.position.set(e.x, e.y, e.z);
    mesh.visible = false;
    scene.add(mesh);
    entityMeshes.push({ entity: e, mesh, spin });
  }
}
function unloadTrackMeshes() {
  for (const { mesh } of entityMeshes) {
    scene.remove(mesh);
    if (mesh.userData.ringGeo) mesh.userData.ringGeo.dispose();
  }
  entityMeshes = [];
  for (const m of trackMats) m.dispose();
  trackMats = [];
}

// --- screens (stack, not boolean soup) ---
const OVERLAYS = ['menu', 'howto', 'settings', 'complete', 'runover', 'pause'];
function showOverlay(id) {
  for (const o of OVERLAYS) $(o).classList.add('hidden');
  if (id) {
    $(id).classList.remove('hidden');
    const primary = $(id).querySelector('.btn.primary');
    if (primary) primary.focus();
  }
}
function pushScreen(id) {
  screenStack.push(id);
  showOverlay(id);
}
function popScreen() {
  screenStack.pop();
  const top = screenStack[screenStack.length - 1] || null;
  showOverlay(top);
  return top;
}
function resetScreens(id) {
  screenStack.length = 0;
  if (id) screenStack.push(id);
  showOverlay(id);
}
function announce(text) {
  $('sr-status').textContent = text;
}

// --- HUD ---
function updateHUD() {
  if (!run) return;
  $('hud-track').textContent = `Track ${track.id} — ${track.name}`;
  let shields = '';
  for (let i = 0; i < SHIELDS; i++) {
    shields += `<span class="${i < run.shields ? '' : 'shield-lost'}">◆</span>`;
  }
  $('hud-shields').innerHTML = shields;
  $('hud-score').textContent = `Score ${run.score}`;
  $('hud-distance').textContent = `${Math.floor(run.distance)} m / ${track.length} m`;
  $('hud-speed').textContent = `${Math.floor(run.speed)} u/s`;
  $('boost-fill').style.width = `${Math.round((run.boost / BOOST_MAX) * 100)}%`;
}
function showToast(text, cls = '') {
  const el = $('hud-toast');
  el.textContent = text;
  el.className = `hud-toast show ${cls}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 900);
}

// --- floating score pops (M3, game-feel: number pops) ---
// A small pool of divs, reused so a burst of gates never allocates.
// Each pop sits at the event's projected screen position — the gate or
// cell the ship just threaded — with an overshoot pop + rise + fade
// (CSS .pop / pop-rise). A pop never blocks input: the layer is
// pointer-events none.
const POP_POOL = 8;
const popEls = [];
let popCursor = 0;
let lastPop = null; // { text, at } — the render check asserts pops fire
function spawnPop(text, wx, wy, cls = '') {
  // The pop rides just above the event (+1.2 world units): the event
  // position is where the ship is at the crossing, so a pop at the
  // exact spot would sit on top of the ship itself.
  const sp = new THREE.Vector3(wx, wy + 1.2, 0).project(camera);
  if (sp.z > 1) return; // event behind the camera — nothing to show
  const idx = popCursor;
  popCursor = (popCursor + 1) % POP_POOL;
  let node = popEls[idx];
  if (!node) {
    node = document.createElement('div');
    $('pops').appendChild(node);
    popEls[idx] = node;
  }
  node.className = `pop ${cls}`;
  node.textContent = text;
  node.style.left = `${((sp.x + 1) / 2) * window.innerWidth}px`;
  node.style.top = `${((1 - sp.y) / 2) * window.innerHeight}px`;
  // Restart the CSS animation on the reused node: clear it, force a
  // reflow, then let the class animation apply again.
  node.style.animation = 'none';
  void node.offsetWidth;
  node.style.animation = '';
  lastPop = { text, at: performance.now() };
}

// --- feedback (game-feel tiers + layers) ---
// One call per event; the tier decides intensity (physics.js
// FEEDBACK_LAYERS is the contract: 5-8 layers per event, all firing
// within ~100ms of the event). Juice is transient — every layer
// decays back to its exact rest value (see animate + updateScene).
function applyFeedback(kind) {
  const f = FEEDBACK[kind];
  if (!f) return;
  trauma = Math.min(1, trauma + f.trauma);
  if (f.hitStop > 0) {
    const now = performance.now();
    hitStopUntil = Math.max(hitStopUntil, now + f.hitStop * 1000);
  }
}
function handleEvent(ev) {
  if (!run) return;
  if (ev.type === 'gate') {
    applyFeedback('gate');
    sfx.gate();
    spawnParticles(ev.x, ev.y, 0, 0xf472b6, 26, 7);
    spawnPop('+250', ev.x, ev.y, 'pop-gate');
    fovPulse = Math.min(1, fovPulse + 0.5);
    glowPulse = Math.min(1, glowPulse + 0.6);
    // Ring pulse: the gate the ship just threaded flashes wider.
    const rec = entityMeshes.find((r) => r.entity.kind === 'gate' && r.entity.z === ev.z);
    if (rec) rec.pulse = 1;
  } else if (ev.type === 'collect') {
    applyFeedback('collect');
    sfx.collect();
    spawnParticles(ev.x, ev.y, 0, 0xfbbf24, 18, 6);
    spawnPop('+100', ev.x, ev.y, 'pop-cell');
    glowPulse = Math.min(1, glowPulse + 0.4);
  } else if (ev.type === 'nearMiss') {
    applyFeedback('nearMiss');
    sfx.nearMiss();
    slowMoUntil = Math.max(slowMoUntil, performance.now() + 450);
    spawnParticles(ev.x, ev.y, 0, 0xffffff, 10, 5, 0.4);
    spawnPop('+25', ev.x, ev.y, 'pop-near');
  } else if (ev.type === 'boostStart') {
    applyFeedback('boost');
    sfx.boostStart();
    fovPulse = Math.min(1, fovPulse + 0.6);
    spawnParticles(run.x, run.y, -1.2, 0x22d3ee, 16, 6, 0.5);
  } else if (ev.type === 'hit') {
    applyFeedback('hit');
    sfx.hit();
    spawnParticles(ev.x, ev.y, 0, 0xa78bfa, 40, 11, 0.9);
    knockback = 1;
    shipSquash = 1;
    if (!reduceFlashing) {
      $('hit-flash').classList.add('show');
      setTimeout(() => $('hit-flash').classList.remove('show'), 120);
    }
    showToast(run.shields > 0 ? `SHIELD DOWN — ${run.shields} LEFT` : 'SHIP DOWN', 'toast-hit');
    announce(run.shields > 0 ? `Shield lost. ${run.shields} shields left.` : 'Ship down.');
  } else if (ev.type === 'complete') {
    applyFeedback('complete');
    sfx.complete();
    spawnParticles(run.x, run.y, 0, 0xfbbf24, 60, 12, 1.2);
    fovPulse = Math.min(1, fovPulse + 0.8);
    spawnPop(`+${run.score}`, run.x, run.y, 'pop-big');
    finishRun(true);
  } else if (ev.type === 'runOver') {
    applyFeedback('runOver');
    sfx.runOver();
    spawnParticles(run.x, run.y, 0, 0xf87171, 60, 13, 1.2);
    knockback = 1;
    shipSquash = 1;
    finishRun(false);
  }
}

function finishRun(completed) {
  if (!run) return;
  save.totalRuns++;
  const best = recordBest(save, track.id, run.distance, run.score);
  persistSave();
  phase = completed ? 'complete' : 'runover';
  $('hud').classList.add('hidden');
  $('btn-boost').classList.add('hidden');
  if (completed) {
    $('complete-score').textContent = `Score ${run.score}`;
    $('complete-detail').textContent =
      `${track.name} cleared in ${run.time.toFixed(1)}s — ${run.gatesHit} gates, ${run.cellsHit} cells, ${run.nearMisses} near-misses, ${run.hitsTaken} hit${run.hitsTaken === 1 ? '' : 's'}.`;
    $('complete-best').textContent = `Best distance: ${Math.floor(best.distance)} m · Best score: ${best.score}`;
    $('btn-next').textContent = track.id < TRACKS.length ? 'Next Track' : 'Back to Track 1';
    resetScreens('complete');
    announce(`Track complete. Score ${run.score}.`);
  } else {
    $('runover-text').textContent = `The tunnel wins this time — ${Math.floor(run.distance)} m of ${track.length} m.`;
    $('runover-stats').textContent =
      `Score ${run.score} · ${run.gatesHit} gates · ${run.cellsHit} cells · ${run.nearMisses} near-misses`;
    $('runover-best').textContent = `Best distance: ${Math.floor(best.distance)} m · Best score: ${best.score}`;
    resetScreens('runover');
    announce(`Ship down at ${Math.floor(run.distance)} metres.`);
  }
  refreshTrackSelect();
}

// --- run control ---
function startRun(trackId) {
  const t = trackById(trackId) || TRACKS[0];
  selectedTrackId = t.id;
  loadTrackMeshes(t);
  run = createRun(t);
  demoRun = null;
  autoPilot = false;
  hookSteer = null;
  steerTarget = null;
  phase = 'run';
  resetScreens(null);
  $('hud').classList.remove('hidden');
  // The touch Boost button appears only once a real touch has been
  // used (a coarse-pointer media query also matches headless browsers
  // with touch enabled, which would show it on desktop captures).
  if (touchSeen) $('btn-boost').classList.remove('hidden');
  trailHist.length = 0;
  sfx.launch();
  applyFeedback('launch');
  fovPulse = Math.min(1, fovPulse + 0.6);
  glowPulse = 1;
  spawnParticles(0, 0, -1.2, 0x22d3ee, 20, 6, 0.6);
  updateHUD();
  refreshTrackSelect();
  announce(`Track ${t.id}, ${t.name}. Steer with drag or arrow keys.`);
}
function restartRun() {
  if (track) startRun(track.id);
}
function pauseGame() {
  if (phase !== 'run') return;
  phase = 'paused';
  resetScreens('pause');
  announce('Paused.');
}
function resumeGame() {
  if (phase !== 'paused') return;
  phase = 'run';
  resetScreens(null);
  announce('Resumed.');
}
function quitToMenu() {
  phase = 'menu';
  run = null;
  demoRun = createRun(TRACKS[0]);
  loadTrackMeshes(TRACKS[0]);
  $('hud').classList.add('hidden');
  $('btn-boost').classList.add('hidden');
  refreshTrackSelect();
  resetScreens('menu');
  announce('Main menu.');
}

// --- input ---
function currentSteerInput() {
  if (phase !== 'run' || !run) return { sx: 0, sy: 0, boost: false };
  if (autoPilot) return greedyPolicy(run);
  if (hookSteer) return { sx: hookSteer.sx, sy: hookSteer.sy, boost: !!hookSteer.boost };
  if (steerTarget) {
    const dx = steerTarget.x - run.x, dy = steerTarget.y - run.y;
    const d = Math.hypot(dx, dy) || 1;
    const mag = clamp(d / 3, 0, 1);
    return { sx: (dx / d) * mag, sy: (dy / d) * mag, boost: false };
  }
  // HUMAN input (keyboard / drag) — screen space, not world space.
  // The chase camera sits at z=-8.5 and looks toward +z, so its right
  // vector is world -x: the view is mirrored left-right, and world +x
  // appears on the LEFT of the screen. A player pressing ArrowLeft
  // expects the ship to move screen-left, which is world +x — so the
  // lateral component of human input is negated here. (This was a
  // live-site find in v0.2.0: every steering test before it measured
  // world x only, so the mirror went unnoticed from M1 onward.)
  // Autopilot / hookSteer / steerTarget above are NOT negated: they
  // drive the simulation in world coordinates by contract (the bot
  // harness, the render check and the playtest probes all use them).
  let sx = 0, sy = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) sx += 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) sx -= 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) sy += 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) sy -= 1;
  if (dragging) {
    sx -= clamp(dragX / 110, -1, 1);
    sy += clamp(-dragY / 110, -1, 1);
  }
  const boost = keys.has('Space') || boostHeld;
  return { sx: clamp(sx, -1, 1), sy: clamp(sy, -1, 1), boost };
}
let boostHeld = false;
let touchSeen = false;
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') {
    touchSeen = true;
    if (phase === 'run') $('btn-boost').classList.remove('hidden');
  }
}, { passive: true });

window.addEventListener('keydown', (e) => {
  ensureAudio();
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'KeyP') {
    if (phase === 'run') pauseGame();
    else if (phase === 'paused') resumeGame();
    return;
  }
  if (e.code === 'KeyR') {
    if (phase === 'run' || phase === 'paused' || phase === 'complete' || phase === 'runover') restartRun();
    return;
  }
  if (e.code === 'Escape') {
    if (phase === 'run') { pauseGame(); return; }
    if (phase === 'paused') { resumeGame(); return; }
    if (screenStack.length > 1) { popScreen(); return; }
    if (phase === 'menu' && screenStack.length === 1 && screenStack[0] !== 'menu') popScreen();
    return;
  }
  if (e.code === 'Enter') {
    if (phase === 'menu' && screenStack[screenStack.length - 1] === 'menu') { startRun(selectedTrackId); return; }
    if (phase === 'complete') { nextTrack(); return; }
    if (phase === 'runover') { restartRun(); return; }
    if (phase === 'paused') { resumeGame(); return; }
  }
  if (e.code === 'Space') e.preventDefault(); // no page scroll while boosting
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); dragging = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'run') pauseGame();
});

// Pointer drag steering on the canvas.
renderer.domElement.addEventListener('pointerdown', (e) => {
  ensureAudio();
  dragging = true;
  dragStartX = e.clientX; dragStartY = e.clientY;
  dragX = 0; dragY = 0;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  dragX = e.clientX - dragStartX;
  dragY = e.clientY - dragStartY;
});
function endDrag() { dragging = false; dragX = 0; dragY = 0; }
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

// Touch boost button.
const boostBtn = $('btn-boost');
boostBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); boostHeld = true; });
boostBtn.addEventListener('pointerup', () => { boostHeld = false; });
boostBtn.addEventListener('pointerleave', () => { boostHeld = false; });

// --- menu: track select ---
function refreshTrackSelect() {
  const el = $('track-select');
  el.innerHTML = '';
  for (const t of TRACKS) {
    const best = save.best[t.id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `track-card${t.id === selectedTrackId ? ' selected' : ''}`;
    card.style.setProperty('--tc', t.theme.ring);
    card.innerHTML = `<div class="track-name">${t.id}. ${t.name}</div>`
      + `<div class="track-meta">${t.length} m · top speed ${t.maxSpeed} u/s</div>`
      + `<div class="track-best">${best ? `Best ${Math.floor(best.distance)} m · ${best.score} pts` : 'Not flown yet'}</div>`;
    card.addEventListener('click', () => {
      selectedTrackId = t.id;
      $('track-hint').textContent = t.hint;
      refreshTrackSelect();
    });
    card.addEventListener('mouseenter', () => { if (audioCtx) sfx.tick(); });
    el.appendChild(card);
  }
  const t = trackById(selectedTrackId);
  $('track-hint').textContent = t ? t.hint : '';
  const flown = Object.keys(save.best).length;
  $('menu-best').textContent = flown
    ? `Flown ${flown} of ${TRACKS.length} tracks · ${save.totalRuns} run${save.totalRuns === 1 ? '' : 's'}`
    : '';
}

// --- mute / settings ---
function applyMute() {
  if (masterGain) masterGain.gain.value = muted ? 0 : volume;
  const label = muted ? 'Sound: Off' : 'Sound: On';
  for (const id of ['btn-mute-menu', 'btn-mute-hud', 'btn-mute-pause']) {
    const b = $(id);
    if (b) b.textContent = label;
  }
}
function toggleMute() {
  ensureAudio();
  muted = !muted;
  save.muted = muted;
  persistSave();
  applyMute();
}
function applySettingsToUI() {
  $('volume-range').value = Math.round(volume * 100);
  $('volume-value').textContent = `${Math.round(volume * 100)}%`;
  $('shake-range').value = Math.round(shakeStrength * 100);
  $('shake-value').textContent = `${Math.round(shakeStrength * 100)}%`;
  $('shake-range-pause').value = Math.round(shakeStrength * 100);
  $('shake-value-pause').textContent = `${Math.round(shakeStrength * 100)}%`;
  $('music-toggle').checked = musicOn;
  $('sfx-toggle').checked = sfxOn;
  $('reduce-flashing').checked = reduceFlashing;
  applyMute();
}
$('volume-range').addEventListener('input', (e) => {
  volume = e.target.value / 100;
  $('volume-value').textContent = `${e.target.value}%`;
  if (masterGain) masterGain.gain.value = muted ? 0 : volume;
});
function bindShake(inputId, labelId) {
  $(inputId).addEventListener('input', (e) => {
    shakeStrength = e.target.value / 100;
    save.shake = shakeStrength;
    persistSave();
    $(labelId).textContent = `${e.target.value}%`;
    if (inputId === 'shake-range') {
      $('shake-range-pause').value = e.target.value;
      $('shake-value-pause').textContent = `${e.target.value}%`;
    } else {
      $('shake-range').value = e.target.value;
      $('shake-value').textContent = `${e.target.value}%`;
    }
  });
}
bindShake('shake-range', 'shake-value');
bindShake('shake-range-pause', 'shake-value-pause');
$('music-toggle').addEventListener('change', (e) => {
  musicOn = e.target.checked;
  if (musicGain) musicGain.gain.value = musicOn ? 0.5 : 0;
  if (musicOn) { ensureAudio(); startMusicSequencer(); }
  else stopMusicSequencer();
});
$('sfx-toggle').addEventListener('change', (e) => {
  sfxOn = e.target.checked;
  if (sfxGain) sfxGain.gain.value = sfxOn ? 1 : 0;
});
$('reduce-flashing').addEventListener('change', (e) => { reduceFlashing = e.target.checked; });

// --- buttons (hover tick + press feedback are CSS; the tick is here) ---
function wireButton(id, fn) {
  const b = $(id);
  if (!b) return;
  b.addEventListener('click', () => { ensureAudio(); fn(); });
  b.addEventListener('mouseenter', () => { if (audioCtx && sfxOn) sfx.tick(); });
}
function nextTrack() {
  const next = track.id < TRACKS.length ? track.id + 1 : 1;
  startRun(next);
}
wireButton('btn-play', () => startRun(selectedTrackId));
wireButton('btn-howto', () => pushScreen('howto'));
wireButton('btn-howto-close', () => popScreen());
wireButton('btn-settings', () => pushScreen('settings'));
wireButton('btn-settings-close', () => popScreen());
wireButton('btn-mute-menu', toggleMute);
wireButton('btn-mute-hud', toggleMute);
wireButton('btn-mute-pause', toggleMute);
wireButton('btn-pause', pauseGame);
wireButton('btn-resume', resumeGame);
wireButton('btn-restart', restartRun);
wireButton('btn-quit', quitToMenu);
wireButton('btn-next', nextTrack);
wireButton('btn-replay', restartRun);
wireButton('btn-retry', restartRun);
wireButton('btn-menu-complete', quitToMenu);
wireButton('btn-menu-runover', quitToMenu);

// --- per-frame scene update ---
function updateScene(dt, now) {
  const activeRun = phase === 'menu' ? demoRun : run;
  const dist = activeRun ? activeRun.z : 0;
  const time = activeRun ? activeRun.time : now / 1000;
  // Speed 0..1 across the track's speed band — drives the FOV kick,
  // the camera pull-back and the engine glow (M3 camera polish).
  const speedNorm = activeRun ? clamp((activeRun.speed - 12) / 22, 0, 1) : 0;

  // Tunnel rings stream past: they live AHEAD of the camera (positive
  // z, the ship flies toward +z) and recycle from far to near as the
  // ship advances. (Earlier they sat behind the camera and the tunnel
  // was invisible — the scene read as a bare starfield.)
  for (let i = 0; i < RING_COUNT; i++) {
    const z = 7 + (((i * RING_SPACING - dist) % (RING_COUNT * RING_SPACING)) + RING_COUNT * RING_SPACING) % (RING_COUNT * RING_SPACING);
    rings[i].position.set(0, 0, z);
    rings[i].visible = true;
  }
  wall.position.z = 120;
  stars.position.z = -(dist % 120);
  nebula.position.z = 200 - (dist % 60) * 0.2;

  if (activeRun) {
    // Ship follows the run state (demo run flies itself in the menu).
    const px = activeRun.x, py = activeRun.y;
    ship.position.set(px, py, 0);
    ship.rotation.z = -activeRun.vx * 0.045;
    ship.rotation.x = activeRun.vy * 0.03;
    // M3: hit squash — the ship squashes on impact, then springs back
    // to its exact rest scale (volume-conserving: wider, flatter).
    const sq = shipSquash;
    ship.scale.set(1 + sq * 0.3, 1 - sq * 0.2, 1 + sq * 0.3);
    // M3: engine glows breathe with speed and pulse on gate/collect.
    const eg = 1 + glowPulse * 0.9 + speedNorm * 0.4 + (phase === 'run' && run.boosting ? 0.5 : 0);
    for (const g of ship.userData.engineGlows) g.scale.setScalar(eg);
    shipLight.intensity = 1.6 + speedNorm * 0.8 + glowPulse * 1.2;
    shipLight.position.set(px, py, -2);
    ship.visible = true;
    trailHist.unshift({ x: px, y: py, t: now });
    // The trail is time-based (0.35s), not frame-count-based: at 5fps
    // under swiftshader 30 frames is 6 seconds of flight and the trail
    // stretches across the whole screen as a stray diagonal line.
    while (trailHist.length && now - trailHist[trailHist.length - 1].t > 350) trailHist.pop();
    if (trailHist.length > TRAIL_LEN) trailHist.length = TRAIL_LEN;
    for (let i = 0; i < TRAIL_LEN; i++) {
      const h = trailHist[Math.min(i, trailHist.length - 1)] || { x: px, y: py };
      // The trail streams behind the ship toward the camera, but must
      // stop short of the camera plane (z=-8.5): points past it project
      // across the whole screen as a stray diagonal line.
      trailPos[i * 3] = h.x; trailPos[i * 3 + 1] = h.y; trailPos[i * 3 + 2] = -i * 0.2;
    }
    trailGeo.attributes.position.needsUpdate = true;
    // Trail particles while boosting / moving fast.
    if (phase === 'run' && (run.boosting || run.speed > 24) && Math.random() < 0.6) {
      spawnParticles(px + (Math.random() - 0.5) * 0.4, py + (Math.random() - 0.5) * 0.4, -1.2, 0x22d3ee, 1, 1.5, 0.4);
    }
    // Entity meshes ride toward the camera as distance grows. They
    // hide the moment they pass the ship (z < 1): between the ship and
    // the camera they would fill the screen as giant clipped shapes.
    for (const rec of entityMeshes) {
      const { entity: e, mesh, spin } = rec;
      const z = e.z - dist;
      mesh.visible = z > 1 && z < 260;
      if (!mesh.visible) continue;
      mesh.position.z = z;
      if (e.kind === 'barrier') {
        const gap = barrierGapAt(e, time);
        mesh.position.x = gap.x;
        mesh.position.y = gap.y;
      }
      if (spin) {
        mesh.rotation.z += dt * (e.kind === 'cell' ? 2.2 : e.kind === 'gate' ? 0.6 : 1.2);
        if (e.kind === 'cell') mesh.position.y += Math.sin(now / 300 + e.z) * 0.002;
      }
      // M3: gate ring pulse — a threaded gate flashes wider, then
      // settles back to its exact rest scale.
      if (e.kind === 'gate') {
        rec.pulse = Math.max(0, (rec.pulse || 0) - dt * 3);
        mesh.scale.setScalar(1 + 0.35 * rec.pulse);
      }
    }
    // Invulnerability blink.
    ship.visible = !(phase === 'run' && run.invuln > 0 && Math.floor(now / 90) % 2 === 0);
    if (boostOsc && boostGain) {
      boostGain.gain.value = phase === 'run' && run.boosting ? 0.05 : 0;
      boostOsc.frequency.value = 80 + run.speed * 2;
    }
  } else {
    ship.visible = false;
    trail.visible = false;
  }

  // Camera: chase the ship with depth, trauma shake on a visual pivot.
  const cx = activeRun ? activeRun.x * 0.45 : Math.sin(now / 4000) * 1.5;
  const cy = activeRun ? activeRun.y * 0.45 + 1.2 : 1.2 + Math.cos(now / 5000) * 0.8;
  const shakeAmp = trauma * trauma * shakeStrength;
  const shX = shakeAmp * (Math.sin(now * 0.09) * 0.6 + Math.sin(now * 0.031) * 0.4);
  const shY = shakeAmp * (Math.cos(now * 0.077) * 0.6 + Math.sin(now * 0.043) * 0.4);
  // M3: speed pull-back + hit knockback on the camera z (visual only —
  // never the physics body). Rest is exactly -8.5.
  const camZ = -8.5 - speedNorm * 1.1 - knockback * 1.4;
  camera.position.set(cx + shX, cy + shY, camZ);
  camera.lookAt(
    (activeRun ? activeRun.x * 0.8 : 0) + shX * 0.5,
    (activeRun ? activeRun.y * 0.8 : 0) + shY * 0.5,
    14,
  );
  // M3: roll with the bank — the camera leans into the turn with the
  // ship, then returns to exactly level when the ship flies straight.
  // (Tracked in camRoll, not read off camera.rotation.z: lookAt flips
  // the camera to face +z, so the Euler z reads ~pi, not the roll.)
  camRoll = activeRun ? -activeRun.vx * 0.006 : 0;
  camera.rotateZ(camRoll);
  // FOV kick with speed + boost + pulse (M3: the pulse is the gate/
  // boost "whoosh" you feel in your chest).
  const targetFov = 72 + speedNorm * 10 + (phase === 'run' && run.boosting ? 5 : 0) + fovPulse * 4;
  if (Math.abs(targetFov - fovCurrent) > 0.05) {
    fovCurrent += (targetFov - fovCurrent) * Math.min(1, 4 * dt);
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }
  updateParticles(dt);
}

// --- main loop ---
function animate(now) {
  requestAnimationFrame(animate);
  const realDt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  // Hit-stop (real-time) and slow-mo own the time scale.
  if (now < hitStopUntil) timeScale = 0;
  else if (now < slowMoUntil) timeScale = 0.35;
  else timeScale = 1;
  // Trauma decays in real time so shake settles during hit-stop.
  trauma = Math.max(0, trauma - realDt * 1.8);
  // M3: every juice layer decays in real time too, so each one
  // returns to its exact rest value (FOV 72, camera z -8.5, roll 0,
  // ship scale 1, glow 1) and never leaves the game in a wrong state.
  fovPulse = Math.max(0, fovPulse - realDt * 2.2);
  knockback = Math.max(0, knockback - realDt * 2.0);
  shipSquash = Math.max(0, shipSquash - realDt * 3.0);
  glowPulse = Math.max(0, glowPulse - realDt * 2.0);

  const dt = realDt * timeScale;
  if (phase === 'run' && run && !run.done) {
    accumulator += dt;
    let guard = 0;
    while (accumulator >= DT && guard < 5) {
      const events = stepRun(run, currentSteerInput(), DT);
      for (const ev of events) handleEvent(ev);
      accumulator -= DT;
      guard++;
      if (run.done) { accumulator = 0; break; }
    }
    if (guard >= 5) accumulator = 0;
    updateHUD();
  } else if (phase === 'menu' && demoRun) {
    accumulator += dt;
    let guard = 0;
    while (accumulator >= DT && guard < 5) {
      stepRun(demoRun, greedyPolicy(demoRun), DT);
      accumulator -= DT;
      guard++;
      if (demoRun.done) { demoRun = createRun(TRACKS[0]); accumulator = 0; break; }
    }
    if (guard >= 5) accumulator = 0;
  }

  updateScene(dt, now);
  renderer.render(scene, camera);
}

// --- resize / context loss ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (phase === 'run') pauseGame();
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- boot ---
refreshTrackSelect();
applySettingsToUI();
loadTrackMeshes(TRACKS[0]);
demoRun = createRun(TRACKS[0]);
resetScreens('menu');
requestAnimationFrame(animate);

// --- public hooks (bot harness + render check drive the game through these) ---
window.__drift = {
  get version() { return VERSION; },
  get state() {
    return {
      phase,
      trackId: track ? track.id : null,
      selectedTrackId,
      shields: run ? run.shields : null,
      score: run ? run.score : null,
      distance: run ? run.distance : null,
      done: run ? run.done : null,
      reason: run ? run.reason : null,
    };
  },
  tracks() {
    return TRACKS.map((t) => ({
      id: t.id, name: t.name, length: t.length,
      best: save.best[t.id] || null,
    }));
  },
  info() {
    if (!run) return null;
    const upcoming = run.entities.slice(run.nextEntity, run.nextEntity + 12).map((e) => {
      const o = { kind: e.kind, x: e.x, y: e.y, z: e.z };
      if (e.kind === 'block') { o.hw = e.hw; o.hh = e.hh; }
      if (e.kind === 'mine') o.r = e.r;
      if (e.kind === 'barrier') { o.gapR = e.gapR; o.gap = barrierGapAt(e, run.time); }
      if (e.kind === 'gate') o.r = e.r;
      return o;
    });
    return {
      trackId: track.id, trackName: track.name, length: track.length,
      shields: run.shields, score: run.score, distance: run.distance,
      speed: run.speed, boost: run.boost, boosting: run.boosting,
      time: run.time, gatesHit: run.gatesHit, cellsHit: run.cellsHit,
      nearMisses: run.nearMisses, hitsTaken: run.hitsTaken,
      ship: { x: run.x, y: run.y, vx: run.vx, vy: run.vy },
      // Screen position of the ship (pixels) — the chase camera looks
      // along +z, so the view is mirrored left-right and world x is
      // NOT screen x. Tests assert steering direction in screen space
      // through this (v0.2.0: the mirror went unnoticed while tests
      // only read world x).
      screen: (() => {
        const sp = new THREE.Vector3(run.x, run.y, 0).project(camera);
        return { x: (sp.x + 1) / 2 * window.innerWidth, y: (1 - sp.y) / 2 * window.innerHeight };
      })(),
      done: run.done, reason: run.reason, upcoming,
      // M3: juice state, for the render check + playtest probes.
      // Every value has an exact rest value (fov 72, trauma 0,
      // timeScale 1, camZ -8.5, camRoll 0) — the check asserts the
      // game returns to rest after each event settles.
      fov: fovCurrent, trauma, timeScale,
      camZ: camera.position.z, camRoll,
      fovPulse, knockback, lastPop,
      // The actual shake amplitude driving the camera (trauma^2 *
      // shake strength): with the shake toggle at 0 this stays 0
      // even when an event adds trauma — the toggle's real effect.
      shakeAmp: trauma * trauma * shakeStrength,
      audio: audioCtx
        ? { state: audioCtx.state, music: !!musicTimer, musicStep, sfxOn, musicOn }
        : null,
    };
  },
  runState() {
    const s = window.__drift.state;
    const i = window.__drift.info();
    return { ...s, ...(i ? { gatesHit: i.gatesHit, cellsHit: i.cellsHit, shields: i.shields } : {}) };
  },
  selectTrack(id) { selectedTrackId = id; refreshTrackSelect(); },
  start(trackId) { startRun(trackId ?? selectedTrackId); },
  restart() { restartRun(); },
  pause() { pauseGame(); },
  resume() { resumeGame(); },
  quitToMenu() { quitToMenu(); },
  setSteer(sx, sy, boost = false) { hookSteer = { sx, sy, boost }; },
  clearSteer() { hookSteer = null; },
  steerTo(x, y) { steerTarget = { x, y }; hookSteer = null; },
  clearTarget() { steerTarget = null; },
  autopilot(on) { autoPilot = !!on; },
  // M3: accessibility toggles as test hooks (the settings UI drives
  // the same state; the render check uses these to prove the toggles
  // actually change what the player sees).
  setShake(v) { shakeStrength = clamp(v, 0, 1); save.shake = shakeStrength; persistSave(); applySettingsToUI(); },
  setReduceFlashing(b) { reduceFlashing = !!b; applySettingsToUI(); },
  get shake() { return shakeStrength; },
  get reduceFlashing() { return reduceFlashing; },
  save() { return JSON.parse(JSON.stringify(save)); },
};
