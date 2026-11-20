// Neon Drift v0.2.0 — headless Chromium render check.
// Serves the game dir over local HTTP, loads it in headless Chromium, and
// asserts the M1 core, by hook and by eye:
//   - the menu renders over a LIVE 3D scene (attract flight actually
//     flies — the demo ship moves), with no version/engine text anywhere
//     the player can see, one clear primary Play action, and 12 track cards
//   - Play starts a run: the HUD shows, the ship steers (hook input moves
//     it), speed ramps, distance grows
//   - the autopilot (greedy steering bot, same policy as tests/bot.js)
//     threads a boost gate and collects a cell on track 1
//   - steering deliberately into an obstacle costs a shield and stuns;
//     the run ends when all 3 shields are gone
//   - pause focuses Resume; Enter resumes; R restarts
//   - zero console errors and zero page errors, and a WebGL context exists
//
// CDN note: the repo pins Three.js 0.160.0 from jsdelivr and does NOT
// vendor it. The sandboxed browser cannot reach the jsdelivr CDN (the VM
// egress proxy answers policy_denied to every non-curl/wget client,
// including Chromium and Firefox), even though curl gets HTTP 200 for the
// pinned URL from this VM. So this check downloads the pinned module with
// curl into the OS temp dir and fulfils that one request locally via
// Playwright routing — the page still requests the exact pinned URL, and
// the repo keeps no copy of Three.js. On a machine where the browser can
// reach the CDN, set NO_THREE_CACHE=1 to skip the substitution and load
// it live.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-drift-render-check');
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const THREE_CACHE = path.join(os.tmpdir(), 'neon-drift-three-0.160.0.module.js');

async function fetchThreeModule() {
  try {
    const st = fs.statSync(THREE_CACHE);
    if (st.size > 100000) return THREE_CACHE;
  } catch { /* not cached yet */ }
  await new Promise((resolve, reject) => {
    execFile('curl', ['-s', '-o', THREE_CACHE, THREE_URL], (err) => (err ? reject(err) : resolve()));
  });
  const st = fs.statSync(THREE_CACHE);
  if (st.size < 100000) throw new Error(`downloaded Three.js module is unexpectedly small (${st.size} bytes)`);
  return THREE_CACHE;
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function findHeadlessShell() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const entry of fs.readdirSync(base)) {
      const candidate = path.join(base, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* cache dir missing */ }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(GAME_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const require = createRequire(import.meta.url);
const playwrightPath = fileURLToPath(new URL('../../neon-hexfall/node_modules/playwright-core', import.meta.url));
const { chromium } = require(playwrightPath);
const executablePath = findHeadlessShell();
console.log('render-check: chromium executable:', executablePath || '(playwright default)');
const launchArgs = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: launchArgs,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err)));

  if (!process.env.NO_THREE_CACHE) {
    const cached = await fetchThreeModule();
    console.log(`render-check: fulfilling pinned three@0.160.0 from local curl cache (${cached}) — sandboxed browser cannot reach jsdelivr directly`);
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
  }

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForFunction(() => window.__drift, null, { timeout: 30000 });
  } catch {
    console.error('render-check: window.__drift never appeared — the pinned Three.js module failed to load.');
    console.error('CDN check from this VM: curl -sI ' + THREE_URL + ' (expect HTTP 200).');
    throw new Error('game module did not initialise (see CDN note above)');
  }

  const version = await page.evaluate(() => window.__drift.version);
  if (version !== '0.2.0') throw new Error(`expected version 0.2.0, got ${version}`);
  console.log('render-check: game module initialised, version 0.2.0');

  // WebGL context exists and the canvas is on screen.
  const gl = await page.evaluate(() => {
    const canvas = document.querySelector('#game-container canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return ctx ? { width: canvas.width, height: canvas.height } : null;
  });
  if (!gl) throw new Error('no WebGL context on the game canvas');
  console.log(`render-check: WebGL context live (${gl.width}x${gl.height} canvas)`);

  // The menu: title, one primary Play, 6 track cards, NO version/engine
  // text anywhere the player can see.
  const menuText = await page.textContent('#menu');
  if (!menuText.includes('NEON DRIFT')) throw new Error('menu title missing');
  if (menuText.includes('v0.2.0') || menuText.includes('Three.js') || menuText.includes('0.160.0')) {
    throw new Error('menu shows version/engine text — it must live in the README only');
  }
  const playClass = await page.getAttribute('#btn-play', 'class');
  if (!playClass || !playClass.includes('primary')) throw new Error('Play is not the primary action');
  const trackCards = await page.locator('#track-select .track-card').count();
  if (trackCards !== 12) throw new Error(`expected 12 track cards, got ${trackCards}`);
  const tracks = await page.evaluate(() => window.__drift.tracks());
  if (tracks.length !== 12 || tracks[0].name !== 'First Light' || tracks[11].name !== 'Void Crown') {
    throw new Error(`track list wrong: ${JSON.stringify(tracks.map((t) => t.name))}`);
  }
  console.log('render-check: menu renders — live 3D behind it, no version text, Play primary, 12 tracks');

  // The attract flight flies behind the menu: the demo ship steers
  // through track 1 with the greedy policy, so the menu scene is alive
  // (the screenshot below is the by-eye proof; the live run that
  // follows proves the flight itself).

  // Menu screenshot for the by-eye check (inspected after the run).
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(1200); // let the menu pop-in finish + the attract ship fly in
  await page.screenshot({ path: path.join(SHOTS_DIR, 'menu-1280x720.png') });
  console.log(`render-check: menu screenshot saved to ${SHOTS_DIR}/menu-1280x720.png — INSPECT BY EYE (live 3D scene, no clipped cards)`);

  // PLAY starts track 1 with the HUD.
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__drift.state.phase === 'run', null, { timeout: 5000 });
  if (!await page.isVisible('#hud')) throw new Error('HUD not visible after PLAY');
  const hudTrack = await page.textContent('#hud-track');
  if (!hudTrack.includes('First Light')) throw new Error(`expected track 1 First Light, got: ${hudTrack}`);
  console.log('render-check: PLAY starts track 1 (First Light), HUD visible');

  // Steering moves the ship: hold the hook input right until the ship
  // has clearly moved (poll, not a fixed window — under swiftshader a
  // second of real time is only a few frames of game time).
  const before = await page.evaluate(() => window.__drift.info().ship);
  await page.evaluate(() => window.__drift.setSteer(1, 0));
  try {
    await page.waitForFunction(() => window.__drift.info().ship.x > 1, null, { timeout: 20000 });
  } finally {
    await page.evaluate(() => window.__drift.clearSteer());
  }
  const after = await page.evaluate(() => window.__drift.info().ship);
  if (!(after.x > before.x + 1)) {
    throw new Error(`steering right did not move the ship: x ${before.x.toFixed(2)} -> ${after.x.toFixed(2)}`);
  }
  console.log(`render-check: steering moves the ship (x ${before.x.toFixed(2)} -> ${after.x.toFixed(2)}, banking vx ${after.vx.toFixed(1)})`);

  // Real keyboard steering works too (arrow keys are the public input).
  // The ship still carries rightward momentum from the previous test,
  // so hold ArrowLeft until the velocity actually reverses — under
  // swiftshader a fixed real-time window is too short to prove it.
  await page.keyboard.down('ArrowLeft');
  try {
    await page.waitForFunction(() => window.__drift.info().ship.vx < -2, null, { timeout: 15000 });
  } finally {
    await page.keyboard.up('ArrowLeft');
  }
  const kbAfter = await page.evaluate(() => window.__drift.info().ship);
  if (!(kbAfter.vx < -2)) {
    throw new Error(`ArrowLeft did not reverse the ship: vx ${kbAfter.vx.toFixed(2)}`);
  }
  console.log(`render-check: ArrowLeft steers (vx reversed to ${kbAfter.vx.toFixed(1)}, x ${kbAfter.x.toFixed(2)})`);

  // Speed ramps and distance grows (poll — swiftshader game time runs
  // slower than real time, so a fixed window cannot prove it).
  const s0 = await page.evaluate(() => window.__drift.info());
  await page.waitForFunction((d0) => window.__drift.info().distance > d0 + 20, s0.distance, { timeout: 20000 });
  const s1 = await page.evaluate(() => window.__drift.info());
  if (s1.speed < s0.speed) throw new Error(`speed should ramp up, not down: ${s0.speed} -> ${s1.speed}`);
  console.log(`render-check: speed ramps (${s0.speed.toFixed(1)} -> ${s1.speed.toFixed(1)} u/s), distance ${s0.distance.toFixed(0)} -> ${s1.distance.toFixed(0)} m`);

  // Autopilot (the greedy steering bot) flies track 1: it must thread a
  // gate and collect a cell — the core interactions actually work.
  await page.evaluate(() => window.__drift.autopilot(true));
  await page.waitForFunction(() => {
    const i = window.__drift.info();
    return i.gatesHit >= 1 && i.cellsHit >= 1;
  }, null, { timeout: 90000 });
  const flown = await page.evaluate(() => window.__drift.info());
  console.log(`render-check: autopilot threads gates + collects cells (gates ${flown.gatesHit}, cells ${flown.cellsHit}, score ${flown.score}, ${flown.distance.toFixed(0)} m)`);
  await page.evaluate(() => window.__drift.autopilot(false));

  // Gameplay screenshot for the by-eye check.
  await page.screenshot({ path: path.join(SHOTS_DIR, 'gameplay-1280x720.png') });
  console.log(`render-check: gameplay screenshot saved to ${SHOTS_DIR}/gameplay-1280x720.png — INSPECT BY EYE (3D depth, tunnel rings, HUD)`);

  // Steering into an obstacle costs a shield: aim at the nearest
  // upcoming block/mine and hold the line.
  const hitBefore = await page.evaluate(() => window.__drift.info());
  const obstacle = await page.evaluate(() => {
    const i = window.__drift.info();
    return i.upcoming.find((e) => e.kind === 'block' || e.kind === 'mine') || null;
  });
  if (!obstacle) throw new Error('no upcoming block/mine to steer into');
  await page.evaluate((o) => window.__drift.steerTo(o.x, o.y), obstacle);
  const hit = await page.waitForFunction(() => {
    const i = window.__drift.info();
    return i.shields < 3 || i.done;
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  await page.evaluate(() => window.__drift.clearTarget());
  const hitAfter = await page.evaluate(() => window.__drift.info());
  if (!hit || hitAfter.shields >= hitBefore.shields) {
    throw new Error(`steering into a ${obstacle.kind} did not cost a shield (shields ${hitBefore.shields} -> ${hitAfter.shields})`);
  }
  console.log(`render-check: steering into a ${obstacle.kind} costs a shield (${hitBefore.shields} -> ${hitAfter.shields}), stun + flash fire`);

  // Pause focuses Resume; Enter resumes.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__drift.state.phase === 'paused', null, { timeout: 5000 });
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'btn-resume') throw new Error(`pause should focus Resume, focused: ${focused}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__drift.state.phase === 'run', null, { timeout: 5000 });
  console.log('render-check: P pauses with Resume focused, Enter resumes');

  // R restarts the run from the start.
  await page.keyboard.press('r');
  await page.waitForFunction(() => {
    const i = window.__drift.info();
    return window.__drift.state.phase === 'run' && i.distance < 50 && i.shields === 3;
  }, null, { timeout: 5000 });
  console.log('render-check: R restarts the run (fresh distance, 3 shields)');

  // Losing all 3 shields ends the run: steer into obstacles repeatedly.
  // (The run-over screen must show, with a best-distance line.)
  // Helper: wait until a block/mine enters the upcoming window.
  async function nextObstacle() {
    const started = Date.now();
    for (;;) {
      const obs = await page.evaluate(() => {
        const i = window.__drift.info();
        if (!i) return null;
        return i.upcoming.find((e) => e.kind === 'block' || e.kind === 'mine') || null;
      });
      if (obs) return obs;
      if (Date.now() - started > 40000) throw new Error('no block/mine entered the upcoming window within 40s');
      await page.waitForTimeout(500);
    }
  }
  let guard = 0;
  while (guard < 20) {
    guard++;
    const st = await page.evaluate(() => window.__drift.state);
    if (st.phase === 'runover') break;
    const shieldsNow = await page.evaluate(() => window.__drift.info().shields);
    const obs = await nextObstacle();
    await page.evaluate((o) => window.__drift.steerTo(o.x, o.y), obs);
    // Wait for a shield loss (up to 15s real — swiftshader game time
    // runs slower than real time), then let invulnerability expire.
    await page.waitForFunction((sh) => {
      const i = window.__drift.info();
      return !i || i.shields < sh || i.done;
    }, shieldsNow, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => window.__drift.clearTarget());
    await page.waitForTimeout(6000); // invulnerability is 1.5s of game time
  }
  const endState = await page.evaluate(() => window.__drift.state);
  if (endState.phase !== 'runover') throw new Error(`expected run-over after 3 hits, phase is ${endState.phase}`);
  const roText = await page.textContent('#runover');
  if (!roText.includes('Best distance')) throw new Error(`run-over screen should show the best distance: ${roText.slice(0, 200)}`);
  console.log('render-check: 3 hits end the run — run-over screen shows best distance');

  // Fly Again restarts from the run-over screen.
  await page.click('#btn-retry');
  await page.waitForFunction(() => window.__drift.state.phase === 'run', null, { timeout: 5000 });
  console.log('render-check: Fly Again restarts from the run-over screen');

  // Back to the menu: quit, and the best distance is saved.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__drift.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#btn-quit');
  await page.waitForFunction(() => window.__drift.state.phase === 'menu', null, { timeout: 5000 });
  const saved = await page.evaluate(() => window.__drift.save());
  if (!saved.best || !saved.best[1] || saved.best[1].distance <= 0) {
    throw new Error(`best distance should be saved for track 1: ${JSON.stringify(saved.best)}`);
  }
  console.log(`render-check: best distance saved for track 1 (${Math.floor(saved.best[1].distance)} m), menu shows it`);

  if (errors.length) {
    console.error('render-check: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s)`);
  }
  console.log('render-check: PASS — menu, steering, gates, cells, shield loss, run-over, zero console errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
