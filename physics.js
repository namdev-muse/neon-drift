// Neon Drift v0.4.0 — pure simulation core (no DOM, no Three.js).
// The ship auto-flies forward through a neon tunnel; the player steers
// in the tunnel cross-section (x, y) with momentum and banking. Entities
// live at a distance z along the track: blocks, mines, moving barriers,
// boost gates and energy cells. The run ends when the ship reaches the
// track length (complete) or loses all 3 shields (run over).
// Deterministic: every track is built from a fixed seed, and the fixed
// step simulation gives identical results for identical inputs.
//
// M4 — progression & depth: an energy economy (cells +2, gates +3,
// distance gates +10, banked at run end), ship upgrades bought with
// banked energy (Thrusters / Plating / Boost Tank, 3 tiers each), a
// best-distance unlock chain (track N+1 opens at 50% best distance on
// track N), and Time Trial mode (race the par time for medals).
//
// M5 — polish & robustness: accessibility settings (text size,
// high contrast, reduce-flashing persisted + prefers-reduced-motion
// default), an FPS guard that steps the pixel ratio and particle
// budget down under sustained low frame rates and back up on
// recovery (PERF_LEVELS is the contract), and the save schema carries
// the new settings so an old save migrates cleanly.

export const VERSION = '1.0.0';
export const TUNNEL_RADIUS = 10;
export const SHIP_RADIUS = 0.55;
export const SHIELDS = 3;
export const DT = 1 / 60;
export const STEER_ACCEL = 58; // lateral accel at full input
export const STEER_DAMPING = 2.1; // lateral velocity damping /s
export const MAX_LATERAL = 17;
export const BOOST_MAX = 100;
export const BOOST_DRAIN = 42; // per second while boosting
export const BOOST_REFILL = 7; // per second, passive
export const BOOST_MULT = 1.45;
export const GATE_SCORE = 250;
export const CELL_SCORE = 100;
export const NEAR_MISS_SCORE = 25;
export const GATE_BOOST_REFILL = 30;
export const STUN_SECONDS = 0.6;
export const INVULN_SECONDS = 1.5;
export const SAVE_VERSION = 1;

// --- seeded RNG (mulberry32) ---
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// --- feedback tiers (game-feel skill: small 0.10-0.20 / no stop,
// medium 0.30-0.50 / 0.04-0.06s, large 0.70-1.00 / 0.10-0.15s) ---
export const FEEDBACK_TIERS = {
  small: { traumaMin: 0.10, traumaMax: 0.20, stopMin: 0, stopMax: 0 },
  medium: { traumaMin: 0.30, traumaMax: 0.50, stopMin: 0.04, stopMax: 0.06 },
  large: { traumaMin: 0.70, traumaMax: 1.00, stopMin: 0.10, stopMax: 0.15 },
};
export const FEEDBACK = {
  launch: { tier: 'small', trauma: 0.12, hitStop: 0 },
  collect: { tier: 'small', trauma: 0.12, hitStop: 0 },
  gate: { tier: 'small', trauma: 0.15, hitStop: 0 },
  nearMiss: { tier: 'small', trauma: 0.10, hitStop: 0 },
  boost: { tier: 'small', trauma: 0.10, hitStop: 0 },
  hit: { tier: 'medium', trauma: 0.45, hitStop: 0.05 },
  complete: { tier: 'medium', trauma: 0.40, hitStop: 0.05 },
  runOver: { tier: 'large', trauma: 0.90, hitStop: 0.12 },
};

// --- feedback layers (game-feel skill: one satisfying event is 5-8
// tiny responses firing together within ~100ms: sound, particles,
// shake, flash, knockback, hit-stop, slow-mo, FOV pulse, number pop.
// This is the contract game.js implements per event; the smoke test
// asserts every event carries at least 5 layers, and the render check
// asserts the layers actually fire in the browser. Layers are named
// so a layer missing from the implementation is a failing test, not
// a silent gap. ---
export const FEEDBACK_LAYERS = {
  launch: ['sound', 'shake', 'fovPulse', 'particles', 'glowPulse'],
  collect: ['sound', 'particles', 'shake', 'pop', 'glowPulse'],
  gate: ['sound', 'particles', 'shake', 'pop', 'fovPulse', 'ringPulse'],
  nearMiss: ['sound', 'slowMo', 'shake', 'pop', 'particles'],
  boost: ['sound', 'fovPulse', 'particles', 'shake', 'glowPulse'],
  hit: ['sound', 'particles', 'shake', 'hitStop', 'flash', 'knockback', 'squash', 'toast'],
  complete: ['sound', 'particles', 'shake', 'hitStop', 'fovPulse', 'pop', 'toast'],
  runOver: ['sound', 'particles', 'shake', 'hitStop', 'flash', 'knockback', 'squash', 'toast'],
};

// --- M4: progression & depth ---
// Energy economy: cells and gates pay energy, banked at run end and
// spent on ship upgrades. Distance gates pay too — reaching 25/50/75/
// 100% of a track is worth energy every run, so pushing further on a
// track you have not finished is always worth something.
// A typical clean run banks ~50 energy: tier-1 upgrades cost 25-30
// (about one good run), a full line costs 175-210, all three lines 595 —
// a full campaign playthrough earns roughly that, so upgrades feel
// earned, not ground out.
export const ENERGY_CELL = 2;
export const ENERGY_GATE = 3;
export const ENERGY_DIST_GATE = 10;
export const DIST_GATE_FRACTIONS = [0.25, 0.5, 0.75, 1.0];

// Ship upgrades: three lines, three tiers each. One clear effect per
// line, visible in play (faster ship, shorter stun, bigger boost tank).
// Costs rise so the third tier is a real decision, not a purchase.
export const UPGRADE_DEFS = {
  thrusters: {
    name: 'Thrusters', maxLevel: 3, costs: [30, 60, 120],
    desc: '+1 base speed and +2 top speed per level — the ship is simply faster.',
  },
  plating: {
    name: 'Plating', maxLevel: 3, costs: [30, 60, 120],
    desc: 'Stun after a hit is 15% shorter per level; level 3 adds a 4th shield.',
  },
  tank: {
    name: 'Boost Tank', maxLevel: 3, costs: [25, 50, 100],
    desc: '+25 boost capacity per level — burn boost longer, and gates refill more.',
  },
};
export function upgradeEffect(upgrades) {
  const u = upgrades || {};
  const thr = clamp(Math.floor(u.thrusters || 0), 0, 3);
  const pla = clamp(Math.floor(u.plating || 0), 0, 3);
  const tan = clamp(Math.floor(u.tank || 0), 0, 3);
  return {
    baseSpeedBonus: thr * 1,
    maxSpeedBonus: thr * 2,
    stunMult: Math.pow(0.85, pla),
    extraShields: pla >= 3 ? 1 : 0,
    boostMax: BOOST_MAX + tan * 25,
  };
}
// Buy one level of an upgrade with banked energy. Pure: returns
// { ok, reason } and mutates the save only on success.
export function buyUpgrade(save, id) {
  const def = UPGRADE_DEFS[id];
  if (!def) return { ok: false, reason: 'unknown upgrade' };
  const level = save.upgrades[id] || 0;
  if (level >= def.maxLevel) return { ok: false, reason: 'max level' };
  const cost = def.costs[level];
  if (save.energy < cost) return { ok: false, reason: `need ${cost} energy` };
  save.energy -= cost;
  save.upgrades[id] = level + 1;
  return { ok: true, cost, level: level + 1 };
}

// Best-distance gates (unlock chain): track 1 is always open. Track
// N opens when the best distance on track N-1 reaches half its length
// — pushing halfway down a track earns the next one. A track with any
// recorded best was flown before the chain existed, so it stays open
// (grandfathered): old saves never lose a track.
export const UNLOCK_FRACTION = 0.5;
export function isTrackUnlocked(save, trackId) {
  if (trackId <= 1) return true;
  const prev = trackById(trackId - 1);
  if (!prev) return false;
  if (save.best[trackId]) return true; // grandfathered: flown before
  const best = save.best[trackId - 1];
  return !!best && best.distance >= prev.length * UNLOCK_FRACTION;
}

// Time Trial medals: par is the greedy bot's completion time for the
// track (see the par values on each track). Gold means out-flying the
// bot — a clean run with smart boost use; silver and bronze are
// reachable on a good first attempt. Upgrades help: a faster ship
// earns faster times, so the economy and the mode feed each other.
export const MEDAL_MULT = { gold: 0.98, silver: 1.15, bronze: 1.35 };
export function medalForTime(track, seconds) {
  if (!track || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds <= track.par * MEDAL_MULT.gold) return 'gold';
  if (seconds <= track.par * MEDAL_MULT.silver) return 'silver';
  if (seconds <= track.par * MEDAL_MULT.bronze) return 'bronze';
  return null;
}

// --- tracks ---
// A track is hand-authored as a list of segments. Each segment expands
// deterministically into entities, so the track is dense by construction
// and identical on every run. Segment types:
//   slalom  — blocks alternating sides, forcing S-steering, gates between
//   gates   — a weaving line of boost gates with cells riding the line
//   mines   — a minefield with a guaranteed clear corridor
//   barrier — moving barrier walls; the gap slides, time the pass
//   weave   — blocks top/bottom with cells in the gaps
//   gauntlet— dense mixed blocks + mines, no free centre line
//   spiral  — gates orbit the centre on a widening circle, the ship must
//             orbit with them; a mine guards the hub so the centre is
//             never free (new in M2, the signature rhythm of tracks 7+)
export const TRACKS = [
  {
    id: 1, name: 'First Light', seed: 101,
    hint: 'Follow the gates. The tunnel teaches; it does not punish.',
    length: 1300, par: 68, baseSpeed: 13, maxSpeed: 24,
    theme: { ring: '#22d3ee', glow: '#0e7490', accent: '#f472b6', disc: '#0b1030', tint: '#67e8f9' },
    segments: [
      { at: 60, len: 140, type: 'gates', count: 3, amp: 3 },
      { at: 220, len: 180, type: 'slalom', count: 4, amp: 4 },
      { at: 430, len: 160, type: 'gates', count: 3, amp: 4 },
      { at: 620, len: 200, type: 'mines', rows: 4, amp: 3 },
      { at: 850, len: 120, type: 'barrier', count: 1, amp: 4 },
      { at: 1000, len: 160, type: 'weave', count: 4, amp: 4 },
      { at: 1180, len: 120, type: 'gates', count: 2, amp: 3 },
    ],
  },
  {
    id: 2, name: 'Violet Spiral', seed: 202,
    hint: 'The spiral tightens. Bank early, cut the corners late.',
    length: 1500, par: 72, baseSpeed: 14, maxSpeed: 27,
    theme: { ring: '#a78bfa', glow: '#6d28d9', accent: '#f472b6', disc: '#150b30', tint: '#c4b5fd' },
    segments: [
      { at: 60, len: 140, type: 'gates', count: 3, amp: 3.5 },
      { at: 220, len: 220, type: 'slalom', count: 5, amp: 5 },
      { at: 470, len: 120, type: 'barrier', count: 1, amp: 4.5 },
      { at: 620, len: 200, type: 'mines', rows: 5, amp: 4 },
      { at: 850, len: 180, type: 'gates', count: 4, amp: 5 },
      { at: 1060, len: 160, type: 'weave', count: 4, amp: 5 },
      { at: 1250, len: 120, type: 'barrier', count: 1, amp: 5 },
      { at: 1400, len: 100, type: 'gates', count: 2, amp: 4 },
    ],
  },
  {
    id: 3, name: 'Gold Rush', seed: 303,
    hint: 'Cells pay for the run. Chase the gold line, not the centre.',
    length: 1600, par: 71, baseSpeed: 15, maxSpeed: 28,
    theme: { ring: '#fbbf24', glow: '#b45309', accent: '#22d3ee', disc: '#1c1206', tint: '#fde68a' },
    segments: [
      { at: 60, len: 160, type: 'gates', count: 4, amp: 4 },
      { at: 250, len: 200, type: 'weave', count: 5, amp: 5 },
      { at: 480, len: 200, type: 'mines', rows: 5, amp: 4 },
      { at: 710, len: 180, type: 'gates', count: 4, amp: 5 },
      { at: 920, len: 220, type: 'slalom', count: 5, amp: 5.5 },
      { at: 1170, len: 120, type: 'barrier', count: 1, amp: 5 },
      { at: 1320, len: 160, type: 'weave', count: 4, amp: 5 },
      { at: 1500, len: 100, type: 'gates', count: 2, amp: 4 },
    ],
  },
  {
    id: 4, name: 'Crimson Gauntlet', seed: 404,
    hint: 'No free centre line here. Pick a lane and commit to it.',
    length: 1800, par: 76, baseSpeed: 16, maxSpeed: 30,
    theme: { ring: '#f87171', glow: '#b91c1c', accent: '#f472b6', disc: '#260808', tint: '#fca5a5' },
    segments: [
      { at: 60, len: 140, type: 'gates', count: 3, amp: 4 },
      { at: 220, len: 240, type: 'gauntlet', count: 6, amp: 5 },
      { at: 490, len: 120, type: 'barrier', count: 1, amp: 5 },
      { at: 640, len: 220, type: 'mines', rows: 6, amp: 4.5 },
      { at: 890, len: 200, type: 'slalom', count: 5, amp: 5.5 },
      { at: 1120, len: 120, type: 'barrier', count: 1, amp: 5.5 },
      { at: 1270, len: 240, type: 'gauntlet', count: 6, amp: 5 },
      { at: 1540, len: 140, type: 'gates', count: 3, amp: 5 },
      { at: 1700, len: 100, type: 'barrier', count: 1, amp: 5 },
    ],
  },
  {
    id: 5, name: 'Nebula Weave', seed: 505,
    hint: 'The walls move. Watch the gap, not the wall.',
    length: 1900, par: 75, baseSpeed: 17, maxSpeed: 31,
    theme: { ring: '#2dd4bf', glow: '#0f766e', accent: '#a78bfa', disc: '#06231f', tint: '#99f6e4' },
    segments: [
      { at: 60, len: 160, type: 'gates', count: 4, amp: 4.5 },
      { at: 250, len: 200, type: 'weave', count: 5, amp: 5.5 },
      { at: 480, len: 140, type: 'barrier', count: 2, amp: 5 },
      { at: 650, len: 220, type: 'mines', rows: 6, amp: 5 },
      { at: 900, len: 200, type: 'slalom', count: 5, amp: 6 },
      { at: 1130, len: 140, type: 'barrier', count: 2, amp: 5.5 },
      { at: 1300, len: 220, type: 'gauntlet', count: 5, amp: 5.5 },
      { at: 1550, len: 180, type: 'gates', count: 4, amp: 5.5 },
      { at: 1760, len: 140, type: 'barrier', count: 1, amp: 6 },
    ],
  },
  {
    id: 6, name: 'Event Horizon', seed: 606,
    hint: 'Everything you learned, at full speed. There is no centre.',
    length: 2100, par: 79, baseSpeed: 18, maxSpeed: 33,
    theme: { ring: '#f8fafc', glow: '#7c3aed', accent: '#fbbf24', disc: '#12081f', tint: '#e9d5ff' },
    segments: [
      { at: 60, len: 160, type: 'gates', count: 4, amp: 5 },
      { at: 250, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 520, len: 140, type: 'barrier', count: 2, amp: 5.5 },
      { at: 690, len: 240, type: 'mines', rows: 6, amp: 5 },
      { at: 960, len: 220, type: 'slalom', count: 5, amp: 6 },
      { at: 1210, len: 140, type: 'barrier', count: 2, amp: 6 },
      { at: 1380, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 1650, len: 200, type: 'weave', count: 5, amp: 6 },
      { at: 1880, len: 120, type: 'barrier', count: 1, amp: 6 },
      { at: 2020, len: 80, type: 'gates', count: 2, amp: 5 },
    ],
  },
  {
    id: 7, name: 'Solar Flare', seed: 707,
    hint: 'The gates start to orbit. Fly the circle, not the line.',
    length: 2300, par: 79, baseSpeed: 19, maxSpeed: 34,
    theme: { ring: '#fb923c', glow: '#c2410c', accent: '#facc15', disc: '#1f0d02', tint: '#fed7aa' },
    segments: [
      { at: 60, len: 160, type: 'gates', count: 4, amp: 4 },
      { at: 250, len: 200, type: 'spiral', count: 5, amp: 5 },
      { at: 480, len: 220, type: 'slalom', count: 5, amp: 5.5 },
      { at: 730, len: 220, type: 'mines', rows: 5, amp: 4.5 },
      { at: 980, len: 140, type: 'barrier', count: 2, amp: 5 },
      { at: 1150, len: 200, type: 'weave', count: 5, amp: 5.5 },
      { at: 1380, len: 200, type: 'spiral', count: 5, amp: 5.5 },
      { at: 1610, len: 220, type: 'gauntlet', count: 5, amp: 5 },
      { at: 1860, len: 140, type: 'barrier', count: 1, amp: 5.5 },
      { at: 2030, len: 180, type: 'gates', count: 4, amp: 5 },
    ],
  },
  {
    id: 8, name: 'Emerald Rush', seed: 808,
    hint: 'Walls everywhere. Watch the gap slide, then commit.',
    length: 2500, par: 81, baseSpeed: 20, maxSpeed: 35,
    theme: { ring: '#4ade80', glow: '#15803d', accent: '#22d3ee', disc: '#04170c', tint: '#bbf7d0' },
    segments: [
      { at: 60, len: 160, type: 'gates', count: 4, amp: 4.5 },
      { at: 250, len: 160, type: 'barrier', count: 2, amp: 5 },
      { at: 440, len: 200, type: 'weave', count: 5, amp: 5.5 },
      { at: 670, len: 220, type: 'mines', rows: 5, amp: 4.5 },
      { at: 920, len: 160, type: 'barrier', count: 2, amp: 5.5 },
      { at: 1110, len: 220, type: 'slalom', count: 5, amp: 6 },
      { at: 1360, len: 180, type: 'gates', count: 4, amp: 5 },
      { at: 1570, len: 160, type: 'barrier', count: 2, amp: 5.5 },
      { at: 1760, len: 200, type: 'weave', count: 5, amp: 6 },
      { at: 1990, len: 220, type: 'mines', rows: 6, amp: 5 },
      { at: 2240, len: 160, type: 'gates', count: 3, amp: 5 },
    ],
  },
  {
    id: 9, name: 'Rose Nebula', seed: 909,
    hint: 'Minefields with a corridor — find it, then orbit out.',
    length: 2700, par: 84, baseSpeed: 21, maxSpeed: 36,
    theme: { ring: '#f9a8d4', glow: '#be185d', accent: '#a78bfa', disc: '#22081a', tint: '#fbcfe8' },
    segments: [
      { at: 60, len: 160, type: 'gates', count: 4, amp: 4.5 },
      { at: 250, len: 240, type: 'mines', rows: 6, amp: 5 },
      { at: 520, len: 220, type: 'spiral', count: 6, amp: 5.5 },
      { at: 770, len: 240, type: 'mines', rows: 6, amp: 5 },
      { at: 1040, len: 200, type: 'weave', count: 5, amp: 6 },
      { at: 1270, len: 200, type: 'barrier', count: 2, amp: 4.5 },
      { at: 1460, len: 240, type: 'mines', rows: 6, amp: 5 },
      { at: 1730, len: 220, type: 'slalom', count: 5, amp: 6 },
      { at: 1980, len: 220, type: 'spiral', count: 6, amp: 6 },
      { at: 2230, len: 200, type: 'gates', count: 4, amp: 5.5 },
      { at: 2460, len: 140, type: 'barrier', count: 1, amp: 6 },
    ],
  },
  {
    id: 10, name: 'Azure Deep', seed: 1010,
    hint: 'Gauntlets back to back. There is no breather here.',
    length: 2900, par: 88, baseSpeed: 22, maxSpeed: 37,
    theme: { ring: '#60a5fa', glow: '#1d4ed8', accent: '#f472b6', disc: '#061224', tint: '#bfdbfe' },
    segments: [
      { at: 60, len: 160, type: 'gates', count: 4, amp: 5 },
      { at: 250, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 520, len: 200, type: 'weave', count: 5, amp: 6 },
      { at: 750, len: 160, type: 'barrier', count: 2, amp: 5.5 },
      { at: 940, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 1210, len: 240, type: 'mines', rows: 6, amp: 5 },
      { at: 1480, len: 220, type: 'slalom', count: 5, amp: 6 },
      { at: 1730, len: 160, type: 'barrier', count: 2, amp: 6 },
      { at: 1920, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 2190, len: 220, type: 'spiral', count: 6, amp: 6 },
      { at: 2440, len: 200, type: 'gates', count: 4, amp: 5.5 },
      { at: 2670, len: 140, type: 'barrier', count: 1, amp: 6 },
    ],
  },
  {
    id: 11, name: 'Acid Rain', seed: 1111,
    hint: 'Orbit, slalom, orbit. The tunnel never flies straight.',
    length: 3100, par: 90, baseSpeed: 23, maxSpeed: 38,
    theme: { ring: '#a3e635', glow: '#4d7c0f', accent: '#f472b6', disc: '#101a04', tint: '#d9f99d' },
    segments: [
      { at: 60, len: 200, type: 'spiral', count: 5, amp: 5 },
      { at: 290, len: 220, type: 'slalom', count: 5, amp: 5.5 },
      { at: 540, len: 220, type: 'spiral', count: 6, amp: 5.5 },
      { at: 790, len: 240, type: 'mines', rows: 6, amp: 5 },
      { at: 1060, len: 160, type: 'barrier', count: 2, amp: 6 },
      { at: 1250, len: 240, type: 'gauntlet', count: 5, amp: 5 },
      { at: 1520, len: 200, type: 'weave', count: 5, amp: 6 },
      { at: 1750, len: 220, type: 'spiral', count: 6, amp: 6 },
      { at: 2000, len: 220, type: 'slalom', count: 5, amp: 6 },
      { at: 2250, len: 160, type: 'barrier', count: 2, amp: 6 },
      { at: 2440, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 2710, len: 200, type: 'gates', count: 4, amp: 6 },
      { at: 2940, len: 140, type: 'barrier', count: 1, amp: 6 },
    ],
  },
  {
    id: 12, name: 'Void Crown', seed: 1212,
    hint: 'Everything you learned, at full speed. Earn the crown.',
    length: 3300, par: 91, baseSpeed: 24, maxSpeed: 39,
    theme: { ring: '#e879f9', glow: '#a21caf', accent: '#fbbf24', disc: '#1e0424', tint: '#f5d0fe' },
    segments: [
      { at: 60, len: 180, type: 'gates', count: 4, amp: 5 },
      { at: 270, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 540, len: 220, type: 'spiral', count: 6, amp: 6 },
      { at: 790, len: 200, type: 'barrier', count: 2, amp: 5 },
      { at: 980, len: 240, type: 'mines', rows: 6, amp: 5 },
      { at: 1250, len: 220, type: 'slalom', count: 5, amp: 6 },
      { at: 1500, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 1770, len: 200, type: 'weave', count: 5, amp: 6 },
      { at: 2000, len: 200, type: 'barrier', count: 2, amp: 5 },
      { at: 2190, len: 220, type: 'spiral', count: 6, amp: 6 },
      { at: 2440, len: 240, type: 'mines', rows: 6, amp: 5 },
      { at: 2710, len: 240, type: 'gauntlet', count: 6, amp: 5.5 },
      { at: 2980, len: 180, type: 'gates', count: 4, amp: 6 },
      { at: 3180, len: 100, type: 'barrier', count: 1, amp: 6 },
    ],
  },
];

export function trackById(id) {
  return TRACKS.find((t) => t.id === id) || null;
}

// --- track building (deterministic expansion) ---
// Entities: { kind, z, x, y, ... } where (x, y) is the cross-section
// position. Blocks: { hw, hh } half-extents. Mines: { r }. Barriers:
// { gapR, axis: 'x'|'y', amp, speed, phase } — the gap centre slides
// sinusoidally with run time. Gates: { r }. Cells: { r: 0.8 }.
function pushEntities(out, track, seg, rng) {
  const { type, at, len, count = 4, amp = 4 } = seg;
  const step = len / Math.max(1, count);
  const rand = (lo, hi) => lo + rng() * (hi - lo);
  for (let i = 0; i < count; i++) {
    const z = at + step * (i + 0.5);
    const s = Math.sin((i / Math.max(1, count)) * Math.PI * 2);
    if (type === 'gates') {
      const x = clamp(s * amp, -7, 7);
      const y = clamp(Math.cos(i * 1.3) * amp * 0.7, -6, 6);
      out.push({ kind: 'gate', z, x, y, r: 2.4 });
      out.push({ kind: 'cell', z: z + step * 0.45, x: clamp(-x * 0.7, -7, 7), y: clamp(-y * 0.7, -6, 6), r: 0.8 });
    } else if (type === 'slalom') {
      const side = i % 2 === 0 ? 1 : -1;
      out.push({ kind: 'block', z, x: side * amp, y: rand(-2, 2), hw: 2.6, hh: 2.6 });
      // The opposite side is open, but a mine guards the centre line
      // so holding centre is never free.
      out.push({ kind: 'mine', z: z + step * 0.5, x: rand(-1.2, 1.2), y: rand(-1.2, 1.2), r: 1.1 });
      // The gate rides AFTER the mine (z + 0.75 step), not before it.
      // M2 fairness fix: with the gate before the mine, the swing from
      // the gate to the next block's safe side crossed the mine's line
      // 11u later — a trap even a good line could not thread at speed.
      // Now the mine is met while the ship is still on the open side,
      // and the gate-to-next-block swing has no obstacle in the way.
      if (i % 2 === 0) out.push({ kind: 'gate', z: z + step * 0.75, x: -side * amp * 0.8, y: rand(-2, 2), r: 2.4 });
    } else if (type === 'mines') {
      const rows = seg.rows || 4;
      // One clear corridor per row: corridor centre wanders, mines keep
      // 2.8 units clear of it so a line always exists — but never the
      // centre line for two rows in a row.
      const corridor = clamp(Math.sin(i * 1.7 + track.seed) * 5, -6, 6);
      const corridorY = clamp(Math.cos(i * 1.1) * 4, -5, 5);
      const n = 3 + Math.floor(rng() * 2);
      for (let m = 0; m < n; m++) {
        let mx = rand(-8, 8), my = rand(-7, 7);
        if (Math.hypot(mx - corridor, my - corridorY) < 3.2) { mx = corridor + 4.5 * (mx < corridor ? -1 : 1); my = corridorY + 3.5 * (my < corridorY ? -1 : 1); }
        mx = clamp(mx, -8.5, 8.5); my = clamp(my, -7.5, 7.5);
        // Keep the mine centre inside the tunnel (radial clamp).
        const mr = Math.hypot(mx, my);
        if (mr > 8.5) { mx *= 8.5 / mr; my *= 8.5 / mr; }
        out.push({ kind: 'mine', z: z + rand(-6, 6), x: mx, y: my, r: 1.1 });
      }
      out.push({ kind: 'cell', z, x: corridor, y: corridorY, r: 0.8 });
      void rows;
    } else if (type === 'barrier') {
      out.push({
        kind: 'barrier', z, x: 0, y: 0, gapR: 3.1,
        axis: i % 2 === 0 ? 'x' : 'y', amp: amp + 1.5,
        speed: 0.9 + rng() * 0.5, phase: rng() * Math.PI * 2,
      });
      out.push({ kind: 'cell', z: z + step * 0.5, x: rand(-3, 3), y: rand(-3, 3), r: 0.8 });
    } else if (type === 'weave') {
      const top = i % 2 === 0;
      out.push({ kind: 'block', z, x: rand(-2, 2), y: top ? 5.5 : -5.5, hw: 4.5, hh: 2.2 });
      out.push({ kind: 'block', z: z + step * 0.5, x: rand(-2, 2), y: top ? -5.5 : 5.5, hw: 4.5, hh: 2.2 });
      out.push({ kind: 'cell', z: z + step * 0.25, x: rand(-3, 3), y: 0, r: 0.8 });
      // A centre mine on every other row: the middle is never free.
      if (i % 2 === 0) out.push({ kind: 'mine', z: z + step * 0.75, x: rand(-1, 1), y: rand(-1, 1), r: 1.1 });
    } else if (type === 'gauntlet') {
      out.push({ kind: 'block', z, x: rand(-4, 4), y: rand(-3, 3), hw: 2.4, hh: 2.4 });
      out.push({ kind: 'mine', z: z + step * 0.33, x: rand(-6, 6), y: rand(-5, 5), r: 1.1 });
      out.push({ kind: 'block', z: z + step * 0.66, x: rand(-4, 4), y: rand(-3, 3), hw: 2.4, hh: 2.4 });
      // Centre is always guarded in the gauntlet.
      out.push({ kind: 'mine', z: z + step * 0.85, x: rand(-1.5, 1.5), y: rand(-1.5, 1.5), r: 1.1 });
      if (i % 2 === 1) out.push({ kind: 'gate', z: z + step * 0.5, x: rand(-5, 5), y: rand(-4, 4), r: 2.4 });
    } else if (type === 'spiral') {
      // Gates orbit the centre: 1.5 turns across the segment, so the
      // ship must fly a circle, not a line. Cells ride the orbit
      // halfway between gates; a mine guards the hub on every other
      // step so holding centre is never free.
      const turns = 1.5;
      const ang = (i / Math.max(1, count)) * Math.PI * 2 * turns + (track.seed % 7);
      const gx = clamp(Math.cos(ang) * amp * 0.85, -7, 7);
      const gy = clamp(Math.sin(ang) * amp * 0.7, -6, 6);
      out.push({ kind: 'gate', z, x: gx, y: gy, r: 2.4 });
      const ang2 = ang + (Math.PI * turns) / Math.max(1, count);
      out.push({ kind: 'cell', z: z + step * 0.5, x: clamp(Math.cos(ang2) * amp * 0.6, -7, 7), y: clamp(Math.sin(ang2) * amp * 0.5, -6, 6), r: 0.8 });
      if (i % 2 === 0) out.push({ kind: 'mine', z: z + step * 0.25, x: rand(-1, 1), y: rand(-1, 1), r: 1.1 });
    }
  }
}

export function buildTrack(track) {
  const rng = mulberry32(track.seed);
  const entities = [];
  for (const seg of track.segments) pushEntities(entities, track, seg, rng);
  entities.sort((a, b) => a.z - b.z);
  return { track, entities };
}

// Barrier gap centre at run time t.
export function barrierGapAt(entity, t) {
  const off = Math.sin(t * entity.speed + entity.phase) * entity.amp;
  return entity.axis === 'x' ? { x: off, y: 0 } : { x: 0, y: off };
}

// --- run state ---
// opts: { mode: 'campaign' | 'timetrial', upgrades: { thrusters, plating, tank } }.
// Upgrades apply to the run's speeds, stun and boost tank; Time Trial
// is the same flight with the clock as the score — the run ends the
// same way, but a finish records a time and a medal.
export function createRun(track, opts = {}) {
  const built = buildTrack(track);
  const eff = upgradeEffect(opts.upgrades);
  const mode = opts.mode === 'timetrial' ? 'timetrial' : 'campaign';
  return {
    track, entities: built.entities,
    mode, upgrades: opts.upgrades || { thrusters: 0, plating: 0, tank: 0 },
    eff,
    z: 0, x: 0, y: 0, vx: 0, vy: 0,
    speed: (track.baseSpeed + eff.baseSpeedBonus) * 0.6, // start slow; the opening teaches
    time: 0, distance: 0,
    shields: SHIELDS + eff.extraShields, maxShields: SHIELDS + eff.extraShields,
    score: 0, energy: 0, distGates: [false, false, false, false],
    boost: eff.boostMax, boostMax: eff.boostMax, boosting: false,
    stun: 0, stunSeconds: STUN_SECONDS * eff.stunMult, invuln: 0, boostBurst: 0,
    gatesHit: 0, cellsHit: 0, nearMisses: 0, hitsTaken: 0,
    done: false, reason: null, // 'complete' | 'runOver'
    nextEntity: 0,
  };
}

function targetSpeed(run) {
  const ramp = Math.min(run.track.maxSpeed + run.eff.maxSpeedBonus - (run.track.baseSpeed + run.eff.baseSpeedBonus),
    run.distance * 0.008);
  let s = run.track.baseSpeed + run.eff.baseSpeedBonus + ramp + run.boostBurst;
  if (run.boosting) s *= BOOST_MULT;
  return s;
}

// One fixed step. input: { sx, sy } in [-1, 1], { boost } boolean.
// Returns the events fired this step (for juice / audio / particles).
export function stepRun(run, input, dt = DT) {
  const events = [];
  if (run.done) return events;
  run.time += dt;

  // Steering with momentum; stun locks the controls out.
  const sx = run.stun > 0 ? 0 : clamp(input.sx || 0, -1, 1);
  const sy = run.stun > 0 ? 0 : clamp(input.sy || 0, -1, 1);
  run.vx += sx * STEER_ACCEL * dt;
  run.vy += sy * STEER_ACCEL * dt;
  const damp = Math.exp(-STEER_DAMPING * dt);
  run.vx *= damp; run.vy *= damp;
  const lv = Math.hypot(run.vx, run.vy);
  if (lv > MAX_LATERAL) { run.vx *= MAX_LATERAL / lv; run.vy *= MAX_LATERAL / lv; }
  run.x += run.vx * dt;
  run.y += run.vy * dt;
  // Tunnel wall: soft clamp, the ship slides along the wall.
  const r = Math.hypot(run.x, run.y);
  const maxR = TUNNEL_RADIUS - SHIP_RADIUS - 0.4;
  if (r > maxR) {
    run.x *= maxR / r; run.y *= maxR / r;
    const nx = run.x / maxR, ny = run.y / maxR;
    const dot = run.vx * nx + run.vy * ny;
    if (dot > 0) { run.vx -= dot * nx; run.vy -= dot * ny; }
  }

  // Boost meter.
  const wantBoost = !!input.boost && run.boost > 0 && run.stun <= 0;
  if (wantBoost && !run.boosting) events.push({ type: 'boostStart' });
  run.boosting = wantBoost;
  if (wantBoost) run.boost = Math.max(0, run.boost - BOOST_DRAIN * dt);
  else run.boost = Math.min(run.boostMax, run.boost + BOOST_REFILL * dt);
  run.boostBurst = Math.max(0, run.boostBurst - 6 * dt);

  // Forward speed eases toward its target (ramps up with distance).
  const ts = targetSpeed(run);
  run.speed += (ts - run.speed) * Math.min(1, 1.6 * dt);

  const prevZ = run.z;
  run.z += run.speed * dt;
  run.distance = run.z;
  run.score = Math.floor(run.distance) + run.gatesHit * GATE_SCORE
    + run.cellsHit * CELL_SCORE + run.nearMisses * NEAR_MISS_SCORE;

  // Distance gates: crossing 25/50/75/100% of the track banks energy.
  // The 100% gate fires just before the completion event below.
  for (let g = 0; g < DIST_GATE_FRACTIONS.length; g++) {
    if (!run.distGates[g] && run.z >= run.track.length * DIST_GATE_FRACTIONS[g]) {
      run.distGates[g] = true;
      run.energy += ENERGY_DIST_GATE;
      events.push({ type: 'distGate', fraction: DIST_GATE_FRACTIONS[g], energy: ENERGY_DIST_GATE });
    }
  }

  if (run.stun > 0) run.stun -= dt;
  if (run.invuln > 0) run.invuln -= dt;

  // Entity crossings in this step.
  while (run.nextEntity < run.entities.length
    && run.entities[run.nextEntity].z <= run.z) {
    const e = run.entities[run.nextEntity];
    run.nextEntity++;
    if (e.z < prevZ) continue; // already passed (should not happen)
    // Ship position at the crossing, interpolated.
    const f = (e.z - prevZ) / Math.max(1e-9, run.z - prevZ);
    const cx = run.x; // lateral position barely changes across one step; use current
    const cy = run.y;
    void f;
    if (e.kind === 'cell') {
      if (Math.hypot(cx - e.x, cy - e.y) < e.r + SHIP_RADIUS + 0.5) {
        run.cellsHit++;
        run.energy += ENERGY_CELL;
        events.push({ type: 'collect', x: e.x, y: e.y, z: e.z });
      }
    } else if (e.kind === 'gate') {
      const d = Math.hypot(cx - e.x, cy - e.y);
      if (d < e.r - 0.2) {
        run.gatesHit++;
        run.energy += ENERGY_GATE;
        run.boost = Math.min(run.boostMax, run.boost + GATE_BOOST_REFILL);
        run.boostBurst = Math.min(6, run.boostBurst + 3.5);
        events.push({ type: 'gate', x: e.x, y: e.y, z: e.z });
      } else if (d < e.r + 1.4) {
        run.nearMisses++;
        events.push({ type: 'nearMiss', x: e.x, y: e.y, z: e.z, kind: 'gate' });
      }
    } else {
      // Obstacles: blocks, mines, barriers.
      let hit = false, clearance = Infinity, ox = e.x, oy = e.y;
      if (e.kind === 'block') {
        const dx = Math.max(Math.abs(cx - e.x) - e.hw, 0);
        const dy = Math.max(Math.abs(cy - e.y) - e.hh, 0);
        const d = Math.hypot(dx, dy);
        clearance = d;
        hit = d < SHIP_RADIUS;
      } else if (e.kind === 'mine') {
        const d = Math.hypot(cx - e.x, cy - e.y) - e.r;
        clearance = d;
        hit = d < SHIP_RADIUS;
      } else if (e.kind === 'barrier') {
        const gap = barrierGapAt(e, run.time);
        ox = gap.x; oy = gap.y;
        const d = Math.hypot(cx - gap.x, cy - gap.y) - e.gapR;
        // Near-miss = passing close to the wall edge, on either side.
        clearance = Math.abs(d);
        // The wall fills everything outside the gap circle.
        hit = d > -SHIP_RADIUS && Math.hypot(cx, cy) < TUNNEL_RADIUS;
      }
      if (hit && run.invuln <= 0) {
        run.shields--;
        run.hitsTaken++;
        run.stun = run.stunSeconds;
        run.invuln = INVULN_SECONDS;
        run.speed *= 0.55;
        run.boostBurst = 0;
        events.push({ type: 'hit', x: ox, y: oy, z: e.z, kind: e.kind, shields: run.shields });
        if (run.shields <= 0) {
          run.done = true; run.reason = 'runOver';
          events.push({ type: 'runOver', distance: run.distance, score: run.score });
        }
      } else if (!hit && clearance < SHIP_RADIUS + 1.5) {
        run.nearMisses++;
        events.push({ type: 'nearMiss', x: ox, y: oy, z: e.z, kind: e.kind });
      }
    }
  }

  if (!run.done && run.z >= run.track.length) {
    run.done = true; run.reason = 'complete';
    events.push({ type: 'complete', distance: run.distance, score: run.score });
  }
  return events;
}

// --- policies (the bot plays through the same stepRun + inputs) ---
export function centrePolicy() {
  return { sx: 0, sy: 0, boost: false };
}

// Greedy steering bot: samples candidate target points in the
// cross-section, scores each by clearance from upcoming obstacles and
// closeness to the next gate/cell, and steers toward the best one.
// It reads the same public state the player sees — no cheating, and it
// still has to make a real steering decision every step.
export function greedyPolicy(run) {
  const lookZ = run.z + 70;
  const upcoming = [];
  for (let i = run.nextEntity; i < run.entities.length; i++) {
    const e = run.entities[i];
    if (e.z > lookZ) break;
    upcoming.push(e);
  }
  // Next rewarding target (gate or cell) within reach.
  let reward = null;
  for (const e of upcoming) {
    if ((e.kind === 'gate' || e.kind === 'cell') && e.z > run.z + 4) { reward = e; break; }
  }
  let best = null, bestScore = -Infinity;
  for (let gx = -8; gx <= 8; gx += 2) {
    for (let gy = -7; gy <= 7; gy += 2) {
      if (Math.hypot(gx, gy) > 8.6) continue;
      let score = 0;
      // Clearance from every upcoming obstacle.
      let minClear = Infinity;
      for (const e of upcoming) {
        const w = clamp(1 - (e.z - run.z) / 70, 0.25, 1); // nearer = heavier
        let d;
        if (e.kind === 'block') {
          const dx = Math.max(Math.abs(gx - e.x) - e.hw, 0);
          const dy = Math.max(Math.abs(gy - e.y) - e.hh, 0);
          d = Math.hypot(dx, dy);
        } else if (e.kind === 'mine') {
          d = Math.hypot(gx - e.x, gy - e.y) - e.r;
        } else if (e.kind === 'barrier') {
          const gap = barrierGapAt(e, run.time + (e.z - run.z) / Math.max(1, run.speed));
          // Clearance inside the gap circle; negative = in the wall.
          d = e.gapR - Math.hypot(gx - gap.x, gy - gap.y);
        } else continue;
        const c = d - SHIP_RADIUS;
        minClear = Math.min(minClear, c);
        score += w * Math.min(c, 6);
        // Steep penalty for flying close to an obstacle: a human gives
        // a mine or block a wide berth, but the old linear term scored
        // a 0.4-clearance pass almost as well as a 2-clearance one, so
        // the bot flew into centre mines while chasing gates. (M2: the
        // harder tracks exposed this — the bot, not the tracks, was
        // the weak link.)
        if (c < 2) score -= w * (2 - c) * 5;
      }
      if (minClear < 0.4) continue; // would hit something — not a candidate
      // Reward: chase the next gate/cell if it is reachable safely.
      if (reward) {
        const rd = Math.hypot(gx - reward.x, gy - reward.y);
        score -= rd * 0.9;
      }
      // Mild pull to centre so the ship does not hug the wall.
      score -= Math.hypot(gx, gy) * 0.12;
      if (score > bestScore) { bestScore = score; best = { x: gx, y: gy }; }
    }
  }
  if (!best) best = { x: 0, y: 0 };
  const dx = best.x - run.x, dy = best.y - run.y;
  const d = Math.hypot(dx, dy) || 1;
  const mag = clamp(d / 3, 0, 1);
  const boost = run.boost > 50 && !upcoming.some((e) => (e.kind === 'block' || e.kind === 'mine' || e.kind === 'barrier') && e.z < run.z + 60);
  return { sx: clamp((dx / d) * mag, -1, 1), sy: clamp((dy / d) * mag, -1, 1), boost };
}

// Simulate a whole run with a policy function. Returns the outcome.
// opts passes through to createRun (mode, upgrades) — the bot plays
// upgraded runs the same way, through the same public hooks.
export function simulateRun(track, policy, opts = {}) {
  const run = createRun(track, opts);
  const maxSteps = Math.ceil((track.length / track.baseSpeed + 60) / DT);
  let steps = 0;
  const events = [];
  while (!run.done && steps < maxSteps) {
    const input = policy(run);
    const evs = stepRun(run, input, DT);
    events.push(...evs);
    steps++;
  }
  return {
    completed: run.done && run.reason === 'complete',
    reason: run.reason || (steps >= maxSteps ? 'timeout' : 'running'),
    distance: run.distance, score: run.score, energy: run.energy,
    shields: run.shields, gatesHit: run.gatesHit, cellsHit: run.cellsHit,
    nearMisses: run.nearMisses, hitsTaken: run.hitsTaken,
    time: run.time, steps,
  };
}

// --- M5: FPS guard levels (the contract — game.js applies them) ---
// Level 0 is full quality; each step down trades pixels and particle
// count for frame rate. The guard steps down after ~3 s below 28 fps
// and back up after ~8 s above 50 fps. Particle scale never zeroes a
// burst: spawnParticles clamps every burst to at least 1 particle.
export const PERF_LEVELS = [
  { pixelRatio: 2, particleScale: 1 },
  { pixelRatio: 1.5, particleScale: 0.7 },
  { pixelRatio: 1, particleScale: 0.4 },
];
export const PERF_LOW_FPS = 28;   // below this, sustained, step down
export const PERF_HIGH_FPS = 50;  // above this, sustained, step up
export const PERF_LOW_SECS = 3;   // sustained-low window before stepping down
export const PERF_HIGH_SECS = 8;  // sustained-high window before stepping up

// --- save (localStorage) ---
export function defaultSave() {
  return {
    version: SAVE_VERSION, best: {}, bestTime: {},
    energy: 0, upgrades: { thrusters: 0, plating: 0, tank: 0 },
    totalRuns: 0, muted: false, shake: 1,
    // M5: reduceFlashing null = never chosen — the game follows the
    // OS prefers-reduced-motion setting until the player picks.
    reduceFlashing: null, textSize: 'normal', highContrast: false,
  };
}
export function serializeSave(save) { return JSON.stringify(save); }
export function parseSave(text) {
  const d = defaultSave();
  try {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object') return d;
    if (s.best && typeof s.best === 'object') {
      for (const [k, v] of Object.entries(s.best)) {
        if (/^(?:[1-9]|1[0-2])$/.test(k) && v && typeof v === 'object'
          && Number.isFinite(v.distance) && Number.isFinite(v.score)) {
          d.best[k] = {
            distance: clamp(v.distance, 0, 10000),
            score: clamp(Math.floor(v.score), 0, 1000000),
          };
        }
      }
    }
    // M4: best Time Trial times (seconds, one decimal kept).
    if (s.bestTime && typeof s.bestTime === 'object') {
      for (const [k, v] of Object.entries(s.bestTime)) {
        if (/^(?:[1-9]|1[0-2])$/.test(k) && Number.isFinite(v)) {
          d.bestTime[k] = clamp(v, 0, 10000);
        }
      }
    }
    if (Number.isInteger(s.energy)) d.energy = clamp(s.energy, 0, 1000000);
    if (s.upgrades && typeof s.upgrades === 'object') {
      for (const id of Object.keys(UPGRADE_DEFS)) {
        if (Number.isInteger(s.upgrades[id])) {
          d.upgrades[id] = clamp(s.upgrades[id], 0, UPGRADE_DEFS[id].maxLevel);
        }
      }
    }
    if (Number.isInteger(s.totalRuns)) d.totalRuns = clamp(s.totalRuns, 0, 100000);
    if (typeof s.muted === 'boolean') d.muted = s.muted;
    if (typeof s.shake === 'number' && Number.isFinite(s.shake)) d.shake = clamp(s.shake, 0, 1);
    // M5: accessibility settings — invalid values fall back to the
    // defaults (reduceFlashing null = follow the OS setting).
    if (s.reduceFlashing === null || typeof s.reduceFlashing === 'boolean') d.reduceFlashing = s.reduceFlashing;
    if (['normal', 'large', 'xlarge'].includes(s.textSize)) d.textSize = s.textSize;
    if (typeof s.highContrast === 'boolean') d.highContrast = s.highContrast;
    return d;
  } catch { return d; }
}
export function recordBest(save, trackId, distance, score) {
  const prev = save.best[trackId];
  const best = { distance: Math.max(prev ? prev.distance : 0, Math.floor(distance)), score: Math.max(prev ? prev.score : 0, score) };
  save.best[trackId] = best;
  return best;
}
// Time Trial: keep the fastest finish per track. Returns the best time
// and whether this run set it.
export function recordBestTime(save, trackId, seconds) {
  const prev = save.bestTime[trackId];
  const isBest = prev === undefined || seconds < prev;
  if (isBest) save.bestTime[trackId] = Math.round(seconds * 10) / 10;
  return { time: save.bestTime[trackId], isBest };
}
