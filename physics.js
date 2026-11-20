// Neon Drift v0.1.0 — pure simulation core (no DOM, no Three.js).
// The ship auto-flies forward through a neon tunnel; the player steers
// in the tunnel cross-section (x, y) with momentum and banking. Entities
// live at a distance z along the track: blocks, mines, moving barriers,
// boost gates and energy cells. The run ends when the ship reaches the
// track length (complete) or loses all 3 shields (run over).
// Deterministic: every track is built from a fixed seed, and the fixed
// step simulation gives identical results for identical inputs.

export const VERSION = '0.1.0';
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
export const TRACKS = [
  {
    id: 1, name: 'First Light', seed: 101,
    hint: 'Follow the gates. The tunnel teaches; it does not punish.',
    length: 1300, baseSpeed: 13, maxSpeed: 24,
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
    length: 1500, baseSpeed: 14, maxSpeed: 27,
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
    length: 1600, baseSpeed: 15, maxSpeed: 28,
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
    length: 1800, baseSpeed: 16, maxSpeed: 30,
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
    length: 1900, baseSpeed: 17, maxSpeed: 31,
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
    length: 2100, baseSpeed: 18, maxSpeed: 33,
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
      if (i % 2 === 0) out.push({ kind: 'gate', z: z + step * 0.25, x: -side * amp * 0.8, y: rand(-2, 2), r: 2.4 });
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
export function createRun(track) {
  const built = buildTrack(track);
  return {
    track, entities: built.entities,
    z: 0, x: 0, y: 0, vx: 0, vy: 0,
    speed: track.baseSpeed * 0.6, // start slow; the opening teaches
    time: 0, distance: 0,
    shields: SHIELDS, score: 0,
    boost: BOOST_MAX, boosting: false,
    stun: 0, invuln: 0, boostBurst: 0,
    gatesHit: 0, cellsHit: 0, nearMisses: 0, hitsTaken: 0,
    done: false, reason: null, // 'complete' | 'runOver'
    nextEntity: 0,
  };
}

function targetSpeed(run) {
  const ramp = Math.min(run.track.maxSpeed - run.track.baseSpeed,
    run.distance * 0.008);
  let s = run.track.baseSpeed + ramp + run.boostBurst;
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
  else run.boost = Math.min(BOOST_MAX, run.boost + BOOST_REFILL * dt);
  run.boostBurst = Math.max(0, run.boostBurst - 6 * dt);

  // Forward speed eases toward its target (ramps up with distance).
  const ts = targetSpeed(run);
  run.speed += (ts - run.speed) * Math.min(1, 1.6 * dt);

  const prevZ = run.z;
  run.z += run.speed * dt;
  run.distance = run.z;
  run.score = Math.floor(run.distance) + run.gatesHit * GATE_SCORE
    + run.cellsHit * CELL_SCORE + run.nearMisses * NEAR_MISS_SCORE;

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
        events.push({ type: 'collect', x: e.x, y: e.y, z: e.z });
      }
    } else if (e.kind === 'gate') {
      const d = Math.hypot(cx - e.x, cy - e.y);
      if (d < e.r - 0.2) {
        run.gatesHit++;
        run.boost = Math.min(BOOST_MAX, run.boost + GATE_BOOST_REFILL);
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
        run.stun = STUN_SECONDS;
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
export function simulateRun(track, policy, opts = {}) {
  const run = createRun(track);
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
    distance: run.distance, score: run.score,
    shields: run.shields, gatesHit: run.gatesHit, cellsHit: run.cellsHit,
    nearMisses: run.nearMisses, hitsTaken: run.hitsTaken,
    time: run.time, steps,
  };
}

// --- save (localStorage) ---
export function defaultSave() {
  return { version: SAVE_VERSION, best: {}, totalRuns: 0, muted: false, shake: 1 };
}
export function serializeSave(save) { return JSON.stringify(save); }
export function parseSave(text) {
  const d = defaultSave();
  try {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object') return d;
    if (s.best && typeof s.best === 'object') {
      for (const [k, v] of Object.entries(s.best)) {
        if (/^[1-6]$/.test(k) && v && typeof v === 'object'
          && Number.isFinite(v.distance) && Number.isFinite(v.score)) {
          d.best[k] = {
            distance: clamp(v.distance, 0, 10000),
            score: clamp(Math.floor(v.score), 0, 1000000),
          };
        }
      }
    }
    if (Number.isInteger(s.totalRuns)) d.totalRuns = clamp(s.totalRuns, 0, 100000);
    if (typeof s.muted === 'boolean') d.muted = s.muted;
    if (typeof s.shake === 'number' && Number.isFinite(s.shake)) d.shake = clamp(s.shake, 0, 1);
    return d;
  } catch { return d; }
}
export function recordBest(save, trackId, distance, score) {
  const prev = save.best[trackId];
  const best = { distance: Math.max(prev ? prev.distance : 0, Math.floor(distance)), score: Math.max(prev ? prev.score : 0, score) };
  save.best[trackId] = best;
  return best;
}
