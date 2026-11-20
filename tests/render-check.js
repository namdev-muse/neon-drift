// Neon Drift v0.4.0 — headless Chromium render check.
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
const launchArgs = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];

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
  if (version !== '0.4.0') throw new Error(`expected version 0.4.0, got ${version}`);
  console.log('render-check: game module initialised, version 0.4.0');

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
  if (menuText.includes('v0.4.0') || menuText.includes('Three.js') || menuText.includes('0.160.0')) {
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

  // --- M4: progression & depth (menu level, fresh profile) ---
  // Track 2 is locked on a fresh profile (the chain opens it at 50%
  // of track 1). The locked card still answers a click — it says what
  // opens it — and it must NOT start a run.
  const lockedCount = await page.locator('#track-select .track-card.locked').count();
  if (lockedCount !== 11) throw new Error(`expected 11 locked tracks on a fresh profile, got ${lockedCount}`);
  const unlocked = await page.evaluate(() => window.__drift.unlocked(2));
  if (unlocked) throw new Error('track 2 must start locked on a fresh profile');
  await page.locator('#track-select .track-card').nth(1).click();
  await page.waitForTimeout(300);
  if (await page.evaluate(() => window.__drift.state.phase) !== 'menu') {
    throw new Error('clicking a locked track card must not start a run');
  }
  const hintAfterLock = await page.textContent('#track-hint');
  if (!hintAfterLock.includes('Locked')) throw new Error(`locked card click should explain the lock, hint: ${hintAfterLock}`);
  console.log('render-check: M4 track 2 locked on a fresh profile; the locked card explains the requirement and does not start a run');

  // Mode toggle: Time Trial turns Play into Race and shows par times.
  await page.click('#btn-mode-timetrial');
  const raceLabel = await page.textContent('#btn-play');
  if (raceLabel !== 'Race') throw new Error(`Time Trial should relabel Play as Race, got: ${raceLabel}`);
  const ttCard = await page.locator('#track-select .track-card').first().textContent();
  if (!ttCard.includes('Par')) throw new Error(`Time Trial cards should show par times, got: ${ttCard}`);
  await page.click('#btn-mode-campaign');
  const playLabel = await page.textContent('#btn-play');
  if (playLabel !== 'Play') throw new Error(`Campaign should relabel Race back to Play, got: ${playLabel}`);
  console.log('render-check: M4 mode toggle — Play becomes Race in Time Trial, cards show par times');

  // Upgrades screen: grant energy, buy Thrusters twice through the UI,
  // and prove the price is charged and the level sticks. A third buy
  // with too little energy must refuse and leave the balance alone.
  await page.click('#btn-upgrades');
  await page.waitForFunction(() => !document.getElementById('upgrades').classList.contains('hidden'), null, { timeout: 5000 });
  const energy0 = await page.evaluate(() => window.__drift.grantEnergy(100));
  if (energy0 !== 100) throw new Error(`grantEnergy should set the balance to 100, got ${energy0}`);
  await page.locator('.upgrade-buy').first().click();
  let upg = await page.evaluate(() => window.__drift.upgrades());
  if (upg.levels.thrusters !== 1 || upg.energy !== 70) {
    throw new Error(`first Thrusters buy should cost 30 (level 1, 70 left), got ${JSON.stringify(upg)}`);
  }
  await page.locator('.upgrade-buy').first().click();
  upg = await page.evaluate(() => window.__drift.upgrades());
  if (upg.levels.thrusters !== 2 || upg.energy !== 10) {
    throw new Error(`second Thrusters buy should cost 60 (level 2, 10 left), got ${JSON.stringify(upg)}`);
  }
  await page.locator('.upgrade-buy').nth(2).click(); // Boost Tank costs 25, balance is 10
  upg = await page.evaluate(() => window.__drift.upgrades());
  if (upg.levels.tank !== 0 || upg.energy !== 10) {
    throw new Error(`an unaffordable buy must refuse and leave the balance alone, got ${JSON.stringify(upg)}`);
  }
  const toastAfterRefusal = await page.textContent('#hud-toast');
  if (!toastAfterRefusal.includes('need 25')) throw new Error(`refused buy should say why, toast: ${toastAfterRefusal}`);
  await page.click('#btn-upgrades-close');
  await page.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden'), null, { timeout: 5000 });
  console.log('render-check: M4 upgrades — Thrusters bought to level 2 through the UI (100 -> 70 -> 10 energy), unaffordable buy refused with a reason');

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
  // The ship still carries rightward WORLD momentum from the previous
  // test (setSteer(1,0) drives world +x), so hold ArrowRight — which,
  // after the v0.2.1 mirror fix, steers world -x — until the velocity
  // actually reverses. Under swiftshader a fixed real-time window is
  // too short to prove it, so this polls.
  await page.keyboard.down('ArrowRight');
  try {
    await page.waitForFunction(() => window.__drift.info().ship.vx < -2, null, { timeout: 15000 });
  } finally {
    await page.keyboard.up('ArrowRight');
  }
  const kbAfter = await page.evaluate(() => window.__drift.info().ship);
  if (!(kbAfter.vx < -2)) {
    throw new Error(`ArrowRight did not reverse the ship: vx ${kbAfter.vx.toFixed(2)}`);
  }
  console.log(`render-check: ArrowRight steers (vx reversed to ${kbAfter.vx.toFixed(1)}, x ${kbAfter.x.toFixed(2)})`);

  // Screen direction (v0.2.1): the chase camera looks along +z, so the
  // view is mirrored left-right — world x is NOT screen x. ArrowLeft
  // must move the ship LEFT on screen, ArrowRight RIGHT. v0.2.0 shipped
  // this mirrored, and every earlier steering test read world x only,
  // so the mirror went unnoticed from M1 onward. This assertion reads
  // the ship's projected screen position, not world x.
  const scr0 = await page.evaluate(() => window.__drift.info().screen);
  await page.keyboard.down('ArrowLeft');
  try {
    await page.waitForFunction((x0) => window.__drift.info().screen.x < x0 - 20, scr0.x, { timeout: 20000 });
  } finally {
    await page.keyboard.up('ArrowLeft');
  }
  const scrL = await page.evaluate(() => window.__drift.info().screen);
  if (!(scrL.x < scr0.x - 20)) {
    throw new Error(`ArrowLeft did not move the ship left on screen: ${scr0.x.toFixed(0)} -> ${scrL.x.toFixed(0)}`);
  }
  console.log(`render-check: ArrowLeft moves the ship left on screen (${scr0.x.toFixed(0)} -> ${scrL.x.toFixed(0)})`);
  await page.keyboard.down('ArrowRight');
  try {
    await page.waitForFunction((x0) => window.__drift.info().screen.x > x0 + 20, scrL.x, { timeout: 20000 });
  } finally {
    await page.keyboard.up('ArrowRight');
  }
  const scrR = await page.evaluate(() => window.__drift.info().screen);
  if (!(scrR.x > scrL.x + 20)) {
    throw new Error(`ArrowRight did not move the ship right on screen: ${scrL.x.toFixed(0)} -> ${scrR.x.toFixed(0)}`);
  }
  console.log(`render-check: ArrowRight moves the ship right on screen (${scrL.x.toFixed(0)} -> ${scrR.x.toFixed(0)})`);

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

  // --- M3: feel & juice ---
  // Score pops fire at the event: a +250 pop for the gate, +100 for
  // the cell (pooled divs in #pops — the text stays in the node after
  // the animation fades, so the check reads what last popped).
  const popTexts = await page.evaluate(() => [...document.querySelectorAll('#pops .pop')].map((e) => e.textContent));
  if (!popTexts.includes('+250')) throw new Error(`no +250 gate pop fired (pops seen: ${JSON.stringify(popTexts)})`);
  if (!popTexts.includes('+100')) throw new Error(`no +100 cell pop fired (pops seen: ${JSON.stringify(popTexts)})`);
  console.log('render-check: M3 score pops fire (+250 gate, +100 cell)');

  // Music: the sequencer runs after the Play gesture and advances.
  const audio0 = await page.evaluate(() => window.__drift.info().audio);
  if (!audio0) throw new Error('no AudioContext after the Play gesture');
  if (!audio0.music) throw new Error('music sequencer is not running');
  await page.waitForTimeout(2500);
  const audio1 = await page.evaluate(() => window.__drift.info().audio);
  if (audio1.musicStep <= audio0.musicStep) throw new Error(`music sequencer did not advance (step ${audio0.musicStep} -> ${audio1.musicStep})`);
  console.log(`render-check: M3 music sequencer running (state ${audio1.state}, step ${audio0.musicStep} -> ${audio1.musicStep})`);

  // FOV pulse: boosting fires a pulse. (Poll every 50ms, not per
  // frame — under swiftshader a frame is ~200ms and the pulse only
  // lasts ~0.3s, so rAF polling could miss it entirely.)
  await page.evaluate(() => window.__drift.setSteer(0, 0, true));
  let pulseInfo = null;
  try {
    const h = await page.waitForFunction(() => {
      const i = window.__drift.info();
      return i.fovPulse > 0.3 ? i : false;
    }, null, { timeout: 15000, polling: 50 });
    pulseInfo = await h.jsonValue();
  } finally {
    await page.evaluate(() => window.__drift.clearSteer());
  }
  if (!pulseInfo) throw new Error('boost did not fire an FOV pulse');
  console.log(`render-check: M3 boost fires an FOV pulse (fov ${pulseInfo.fov.toFixed(1)}, pulse ${pulseInfo.fovPulse.toFixed(2)})`);

  // Shake toggle: with shake at 0, an event still adds trauma but the
  // camera amplitude stays 0; at 100% it moves. Steer onto the next
  // gate for each half; the info is captured atomically in-page the
  // moment the gate lands, so the fast trauma decay cannot hide it.
  async function nextGate() {
    const started = Date.now();
    for (;;) {
      const g = await page.evaluate(() => {
        const i = window.__drift.info();
        if (!i) return null;
        return i.upcoming.find((e) => e.kind === 'gate') || null;
      });
      if (g) return g;
      if (Date.now() - started > 40000) throw new Error('no gate entered the upcoming window within 40s');
      await page.waitForTimeout(500);
    }
  }
  // Fresh run for the shake tests: the autopilot + boost legs above
  // may already have cost shields, and each gate-steering leg can
  // clip an obstacle on the way to its gate.
  await page.keyboard.press('r');
  await page.waitForFunction(() => {
    const i = window.__drift.info();
    return window.__drift.state.phase === 'run' && i.shields === 3;
  }, null, { timeout: 5000 });
  async function gateWithShake(shake) {
    await page.evaluate((s) => window.__drift.setShake(s), shake);
    const g0 = await page.evaluate(() => window.__drift.info().gatesHit);
    const gate = await nextGate();
    await page.evaluate((g) => window.__drift.steerTo(g.x, g.y), gate);
    const h = await page.waitForFunction((n) => {
      const i = window.__drift.info();
      if (i.done) return { done: true };
      return (i.gatesHit > n && i.trauma > 0) ? i : false;
    }, g0, { timeout: 30000, polling: 50 });
    const after = await h.jsonValue();
    await page.evaluate(() => window.__drift.clearTarget());
    if (after.done) throw new Error('run ended during the shake-toggle gate test');
    return after;
  }
  {
    const after = await gateWithShake(0);
    if (after.shakeAmp !== 0) throw new Error(`shake toggle at 0 must keep the camera still (shakeAmp ${after.shakeAmp})`);
    console.log(`render-check: M3 shake 0% — trauma ${after.trauma.toFixed(2)} fires, camera still (shakeAmp 0)`);
  }
  {
    const after = await gateWithShake(1);
    if (!(after.shakeAmp > 0)) throw new Error('shake toggle at 100% must move the camera on a gate');
    console.log(`render-check: M3 shake 100% — camera moves on a gate (shakeAmp ${after.shakeAmp.toFixed(3)})`);
  }

  // Rest state: fly straight (roll returns to level), then pause and
  // let every layer settle — trauma, FOV, camera z and time scale must
  // all return to their exact rest values.
  await page.evaluate(() => window.__drift.setSteer(0, 0));
  await page.waitForFunction(() => Math.abs(window.__drift.info().ship.vx) < 0.5, null, { timeout: 20000 });
  await page.evaluate(() => window.__drift.clearSteer());
  const rollNow = await page.evaluate(() => window.__drift.info().camRoll);
  if (Math.abs(rollNow) > 0.01) throw new Error(`camera roll must return to level when flying straight (roll ${rollNow.toFixed(3)})`);
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__drift.state.phase === 'paused', null, { timeout: 5000 });
  await page.waitForTimeout(2500); // let trauma / pulses / knockback decay in real time
  const rest = await page.evaluate(() => window.__drift.info());
  const speedNorm = Math.min(1, Math.max(0, (rest.speed - 12) / 22));
  const expectedFov = 72 + speedNorm * 10;
  const expectedCamZ = -8.5 - speedNorm * 1.1;
  if (rest.trauma > 0.05) throw new Error(`trauma must decay to rest (got ${rest.trauma.toFixed(2)})`);
  if (rest.timeScale !== 1) throw new Error(`time scale must return to 1 (got ${rest.timeScale})`);
  if (Math.abs(rest.fov - expectedFov) > 1) throw new Error(`FOV must return to its speed baseline ${expectedFov.toFixed(1)} (got ${rest.fov.toFixed(1)})`);
  if (Math.abs(rest.camZ - expectedCamZ) > 0.15) throw new Error(`camera z must return to its rest ${expectedCamZ.toFixed(2)} (got ${rest.camZ.toFixed(2)})`);
  if (Math.abs(rest.camRoll) > 0.01) throw new Error(`camera roll must return to 0 at rest (got ${rest.camRoll.toFixed(3)})`);
  console.log(`render-check: M3 rest state — trauma ${rest.trauma.toFixed(2)}, timeScale ${rest.timeScale}, fov ${rest.fov.toFixed(1)} (baseline ${expectedFov.toFixed(1)}), camZ ${rest.camZ.toFixed(2)}, roll ${rest.camRoll.toFixed(3)}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__drift.state.phase === 'run', null, { timeout: 5000 });

  // Gameplay screenshot for the by-eye check.
  await page.screenshot({ path: path.join(SHOTS_DIR, 'gameplay-1280x720.png') });
  console.log(`render-check: gameplay screenshot saved to ${SHOTS_DIR}/gameplay-1280x720.png — INSPECT BY EYE (3D depth, tunnel rings, HUD)`);

  // Steering into an obstacle costs a shield: aim at an upcoming
  // block/mine and hold the line. Pick one at least 40 m ahead so the
  // ship has time to steer onto it, and retry with the next one if the
  // ship passes it by — the nearest obstacle can be metres ahead after
  // the autopilot leg, too close to reach (v0.2.1 hardening; the
  // slalom reorder moved the autopilot's stop point further along).
  // Fresh run for the hit test: the M3 gate-steering legs above may
  // already have cost a shield, and this test needs two hits (flash
  // off, then flash on) while leaving the run alive for the pause
  // test that follows.
  await page.keyboard.press('r');
  await page.waitForFunction(() => {
    const i = window.__drift.info();
    return window.__drift.state.phase === 'run' && i.shields === 3;
  }, null, { timeout: 5000 });
  // M3: reduce-flashing. First hit with the toggle ON must not flash;
  // second hit with it OFF must. The flash is captured atomically
  // in-page the moment the shield drops (it only lasts 120ms, and
  // under swiftshader a frame is ~200ms — a later read would miss it).
  await page.evaluate(() => window.__drift.setReduceFlashing(true));
  const hitBefore = await page.evaluate(() => window.__drift.info());
  let hit = false, hitKind = null, flashOff = null, flashOn = null;
  for (let attempt = 0; attempt < 6 && (flashOff === null || flashOn === null); attempt++) {
    const obstacle = await page.evaluate(() => {
      const i = window.__drift.info();
      if (!i || i.done) return null;
      return i.upcoming.find((e) => (e.kind === 'block' || e.kind === 'mine') && e.z > i.distance + 40) || null;
    });
    if (!obstacle) break;
    const shieldsNow = await page.evaluate(() => window.__drift.info().shields);
    await page.evaluate((o) => window.__drift.steerTo(o.x, o.y), obstacle);
    const h = await page.waitForFunction((sh) => {
      const i = window.__drift.info();
      if (!i) return false;
      if (i.shields < sh || i.done) {
        return { shields: i.shields, flash: document.getElementById('hit-flash').classList.contains('show'), done: i.done };
      }
      return false;
    }, shieldsNow, { timeout: 30000, polling: 50 }).catch(() => null);
    await page.evaluate(() => window.__drift.clearTarget());
    if (h) {
      const got = await h.jsonValue();
      hit = true;
      hitKind = obstacle.kind;
      if (flashOff === null) {
        flashOff = got.flash;
        await page.evaluate(() => window.__drift.setReduceFlashing(false));
      } else if (flashOn === null) {
        flashOn = got.flash;
      }
    }
    await page.waitForTimeout(500);
  }
  if (flashOff === null || flashOn === null) throw new Error(`could not land two hits to test the flash toggle (off: ${flashOff}, on: ${flashOn})`);
  if (flashOff) throw new Error('reduce-flashing ON must suppress the hit flash');
  if (!flashOn) throw new Error('reduce-flashing OFF must show the hit flash');
  console.log('render-check: M3 reduce-flashing — flash suppressed when ON, shown when OFF');
  const hitAfter = await page.evaluate(() => window.__drift.info());
  if (!hit || hitAfter.shields >= hitBefore.shields) {
    throw new Error(`steering into obstacles did not cost a shield (shields ${hitBefore.shields} -> ${hitAfter.shields})`);
  }
  console.log(`render-check: steering into a ${hitKind} costs a shield (${hitBefore.shields} -> ${hitAfter.shields}), stun + flash fire`);

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

  // --- M4: Time Trial end-to-end ---
  // Switch to Time Trial, race track 1 with the autopilot, and finish
  // it: the HUD must show the clock and the gold target, the run must
  // bank energy, the complete screen must show the time and a medal,
  // and finishing track 1 must unlock track 2.
  await page.click('#btn-mode-timetrial');
  await page.waitForFunction(() => window.__drift.mode === 'timetrial', null, { timeout: 5000 });
  await page.evaluate(() => window.__drift.start(1, 'timetrial'));
  await page.waitForFunction(() => window.__drift.state.phase === 'run', null, { timeout: 5000 });
  if (await page.evaluate(() => document.getElementById('hud-time').classList.contains('hidden'))) {
    throw new Error('Time Trial HUD must show the clock');
  }
  const hudTime = await page.textContent('#hud-time');
  if (!hudTime.includes('GOLD')) throw new Error(`Time Trial HUD must show the gold target, got: ${hudTime}`);
  await page.evaluate(() => window.__drift.autopilot(true));
  // The clock must actually run (poll — swiftshader game time runs
  // slower than real time).
  await page.waitForFunction(() => window.__drift.info().time > 5, null, { timeout: 60000 });
  const ttMid = await page.evaluate(() => window.__drift.info());
  if (ttMid.mode !== 'timetrial') throw new Error(`run mode should be timetrial, got ${ttMid.mode}`);
  console.log(`render-check: M4 Time Trial running — clock ${ttMid.time.toFixed(1)}s, HUD shows ${hudTime.trim()}`);
  // A full track 1 at ~0.25x game time under swiftshader takes ~4-5
  // real minutes; the autopilot (greedy bot) finishes it clean.
  await page.waitForFunction(() => window.__drift.state.phase === 'complete', null, { timeout: 420000 });
  await page.evaluate(() => window.__drift.autopilot(false));
  const ttDone = await page.evaluate(() => window.__drift.info());
  const ttSave = await page.evaluate(() => window.__drift.save());
  const medalText = await page.textContent('#complete-medal');
  const energyText = await page.textContent('#complete-energy');
  if (!ttDone.medal && !medalText.includes('No medal')) {
    throw new Error(`complete screen should show the medal (or no medal), got: ${medalText}`);
  }
  if (ttDone.medal && !medalText.toLowerCase().includes(ttDone.medal)) {
    throw new Error(`complete screen medal ${medalText} does not match the run medal ${ttDone.medal}`);
  }
  if (!ttSave.bestTime[1] || Math.abs(ttSave.bestTime[1] - ttDone.time) > 0.2) {
    throw new Error(`best Time Trial time should be saved (saved ${ttSave.bestTime[1]}, run ${ttDone.time.toFixed(1)})`);
  }
  if (!energyText.includes('Banked') || ttSave.energy < ttDone.energy) {
    throw new Error(`run energy should be banked (run ${ttDone.energy}, saved ${ttSave.energy}): ${energyText}`);
  }
  console.log(`render-check: M4 Time Trial complete — ${ttDone.time.toFixed(1)}s, medal ${ttDone.medal || 'none'} (${medalText.trim()}), best time saved, ${ttDone.energy} energy banked`);
  // Finishing track 1 unlocks track 2 — the chain moves.
  await page.click('#btn-menu-complete');
  await page.waitForFunction(() => window.__drift.state.phase === 'menu', null, { timeout: 5000 });
  if (!await page.evaluate(() => window.__drift.unlocked(2))) {
    throw new Error('finishing track 1 must unlock track 2');
  }
  const lockedAfter = await page.locator('#track-select .track-card.locked').count();
  if (lockedAfter !== 10) throw new Error(`expected 10 locked tracks after unlocking track 2, got ${lockedAfter}`);
  console.log('render-check: M4 finishing track 1 unlocks track 2 (10 tracks still locked)');
  await page.click('#btn-mode-campaign');

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
