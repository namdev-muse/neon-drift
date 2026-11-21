// Neon Drift v0.5.0 — cross-browser check (M5): the same core pass as
// the Chromium render check, but in headless Firefox. Compact on
// purpose — menu, WebGL, Play, steering, autopilot gate + cell, zero
// errors — so the 2-hour milestone cadence can afford both browsers.
// Reuses the render-check's Three.js CDN workaround (the sandboxed
// browser cannot reach jsdelivr; the pinned module is fulfilled from a
// curl cache in the OS temp dir — nothing is vendored into the repo).
//
// ENVIRONMENT LIMIT (recorded 2026-11-21, not a game defect): headless
// Firefox in this VM cannot create a WebGL context at all — the VM has
// no system EGL ("Exhausted GL driver options"), and Firefox cannot
// use Chromium's bundled ANGLE libraries (tried: webgl.force-enabled
// prefs, LD_LIBRARY_PATH at the headless-shell's libEGL/libGLESv2,
// VK_ICD_FILENAMES at its SwiftShader ICD, MOZ_DISABLE_CONTENT_SANDBOX).
// When WebGL is unavailable the check runs its DOM tier instead — the
// menu shows the game's graceful WebGL-failure message with Play
// disabled (no dead buttons), and no page error other than the WebGL
// constructor itself appears — and exits 2 (BLOCKED), never a false
// PASS. The game uses standard Three.js WebGL2 with no Chromium-only
// APIs, so there is no game-side reason it would fail in a real
// Firefox; a full Firefox flight check needs a machine with EGL.
// Run: node tests/firefox-check.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-drift-firefox');
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
const { firefox } = require(playwrightPath);

// Best effort at software WebGL: force past the blocklist, and point
// Firefox at Chromium's bundled ANGLE EGL (the VM has no system EGL).
const CHROME_DIR = path.join(os.homedir(), '.cache', 'ms-playwright', 'chromium_headless_shell-1255', 'chrome-headless-shell-linux64');
const EGL_DIR = path.join(os.tmpdir(), 'neon-drift-egl');
fs.mkdirSync(EGL_DIR, { recursive: true });
for (const [link, target] of [['libEGL.so.1', 'libEGL.so'], ['libGLESv2.so.1', 'libGLESv2.so']]) {
  const p = path.join(EGL_DIR, link);
  try { fs.unlinkSync(p); } catch { /* not there yet */ }
  try { fs.symlinkSync(path.join(CHROME_DIR, target), p); } catch { /* exists */ }
}

const errors = [];
let browser;
try {
  browser = await firefox.launch({
    args: ['--no-sandbox'],
    firefoxUserPrefs: {
      'webgl.force-enabled': true,
      'webgl.disabled': false,
      'webgl.enable-webgl2': true,
      'layers.acceleration.force-enabled': true,
    },
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${EGL_DIR}:${CHROME_DIR}:${process.env.LD_LIBRARY_PATH || ''}`,
      VK_ICD_FILENAMES: path.join(CHROME_DIR, 'vk_swiftshader_icd.json'),
      MOZ_DISABLE_CONTENT_SANDBOX: '1',
    },
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
    console.log(`firefox-check: fulfilling pinned three@0.160.0 from local curl cache (${cached})`);
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
  }

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Tier 0: can this Firefox create a WebGL context at all?
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  });
  if (!webgl) {
    // DOM tier only (M5 graceful failure): the game module cannot boot
    // without a renderer, so the menu must say so plainly and disable
    // its buttons instead of offering a dead menu. The track cards are
    // built by the game module, so they are absent here — the assertions
    // are the static menu, the visible WebGL message, Play disabled,
    // and no page error other than the WebGL constructor itself (which
    // is the environment, not the game).
    const menuText = await page.textContent('#menu');
    if (!menuText.includes('NEON DRIFT')) throw new Error('menu title missing in Firefox (DOM tier)');
    if (await page.evaluate(() => document.getElementById('webgl-error').classList.contains('hidden'))) {
      throw new Error('the WebGL failure message must show in Firefox (DOM tier)');
    }
    const errText = await page.textContent('#webgl-error');
    if (!errText.includes('WebGL')) throw new Error(`WebGL failure message should name WebGL, got: ${errText}`);
    if (!await page.evaluate(() => document.getElementById('btn-play').disabled)) {
      throw new Error('Play must be disabled when WebGL is unavailable (DOM tier)');
    }
    const otherErrors = errors.filter((e) => !e.includes('WebGL context could not be created') && !e.includes('Error creating WebGL context'));
    if (otherErrors.length) {
      console.error('firefox-check: non-WebGL errors:');
      for (const e of otherErrors) console.error('  ' + e);
      throw new Error(`${otherErrors.length} non-WebGL console/page error(s) in Firefox`);
    }
    console.log('firefox-check: BLOCKED — headless Firefox in this VM cannot create a WebGL context (no system EGL; see header). DOM tier passed: menu renders, WebGL failure message shows, Play disabled, no non-WebGL errors.');
    process.exitCode = 2;
  } else {
  try {
    await page.waitForFunction(() => window.__drift, null, { timeout: 30000 });
  } catch {
    throw new Error('game module did not initialise in Firefox (see CDN note above)');
  }

  const version = await page.evaluate(() => window.__drift.version);
  if (version !== '0.5.0') throw new Error(`expected version 0.5.0, got ${version}`);
  console.log('firefox-check: game module initialised in Firefox, version 0.5.0');

  const gl = await page.evaluate(() => {
    const canvas = document.querySelector('#game-container canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return ctx ? { width: canvas.width, height: canvas.height } : null;
  });
  if (!gl) throw new Error('no WebGL context on the game canvas in Firefox');
  console.log(`firefox-check: WebGL context live (${gl.width}x${gl.height} canvas)`);

  const menuText = await page.textContent('#menu');
  if (!menuText.includes('NEON DRIFT')) throw new Error('menu title missing in Firefox');
  if (menuText.includes('v0.5.0') || menuText.includes('Three.js') || menuText.includes('0.160.0')) {
    throw new Error('menu shows version/engine text in Firefox');
  }
  const trackCards = await page.locator('#track-select .track-card').count();
  if (trackCards !== 12) throw new Error(`expected 12 track cards, got ${trackCards}`);
  console.log('firefox-check: menu renders — title, 12 track cards, no version text');

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'menu.png') });

  await page.click('#btn-play');
  await page.waitForFunction(() => window.__drift.state.phase === 'run', null, { timeout: 10000 });
  if (!await page.isVisible('#hud')) throw new Error('HUD not visible after PLAY in Firefox');
  console.log('firefox-check: PLAY starts track 1, HUD visible');

  // Steering moves the ship (hook input, polled — software GL in
  // Firefox is slow, so a fixed window cannot prove it).
  const before = await page.evaluate(() => window.__drift.info().ship);
  await page.evaluate(() => window.__drift.setSteer(1, 0));
  try {
    await page.waitForFunction(() => window.__drift.info().ship.x > 1, null, { timeout: 30000 });
  } finally {
    await page.evaluate(() => window.__drift.clearSteer());
  }
  const after = await page.evaluate(() => window.__drift.info().ship);
  if (!(after.x > before.x + 1)) {
    throw new Error(`steering did not move the ship in Firefox: x ${before.x.toFixed(2)} -> ${after.x.toFixed(2)}`);
  }
  console.log(`firefox-check: steering moves the ship (x ${before.x.toFixed(2)} -> ${after.x.toFixed(2)})`);

  // Autopilot threads a gate and collects a cell.
  await page.evaluate(() => window.__drift.autopilot(true));
  await page.waitForFunction(() => {
    const i = window.__drift.info();
    return i.gatesHit >= 1 && i.cellsHit >= 1;
  }, null, { timeout: 180000 });
  const flown = await page.evaluate(() => window.__drift.info());
  console.log(`firefox-check: autopilot threads gates + collects cells (gates ${flown.gatesHit}, cells ${flown.cellsHit}, ${flown.distance.toFixed(0)} m)`);
  await page.evaluate(() => window.__drift.autopilot(false));
  await page.screenshot({ path: path.join(SHOTS_DIR, 'gameplay.png') });

  // Settings open and the M5 controls are present and wired.
  await page.evaluate(() => window.__drift.pause());
  await page.waitForFunction(() => window.__drift.state.phase === 'paused', null, { timeout: 5000 });
  await page.evaluate(() => window.__drift.quitToMenu());
  await page.waitForFunction(() => window.__drift.state.phase === 'menu', null, { timeout: 5000 });
  await page.click('#btn-settings');
  await page.waitForFunction(() => !document.getElementById('settings').classList.contains('hidden'), null, { timeout: 5000 });
  await page.click('#btn-text-large');
  const ts = await page.evaluate(() => document.documentElement.dataset.textSize);
  if (ts !== 'large') throw new Error(`text size Large did not apply in Firefox (got ${ts})`);
  await page.click('#high-contrast');
  if (!await page.evaluate(() => document.body.classList.contains('high-contrast'))) {
    throw new Error('high contrast did not apply in Firefox');
  }
  console.log('firefox-check: settings — text size + high contrast apply');
  await page.click('#btn-settings-close');

  if (errors.length) {
    console.error('firefox-check: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s) in Firefox`);
  }
  console.log(`firefox-check: PASS — menu, steering, gates, cells, settings, zero console errors (shots in ${SHOTS_DIR})`);
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
