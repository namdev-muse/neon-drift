# Neon Drift — devlog

## M5 — Polish & robustness (v0.5.0) — 2026-11-21

Polish, not features. **Accessibility:** text size (Normal / Large /
Extra large), high contrast panels and text, and reduce-flashing now
**persists** — before M5 the toggle reset on every load — with a
`prefers-reduced-motion` default until the player chooses. **Performance:**
an FPS guard watches the frame rate and steps the pixel ratio (2 → 1.5
→ 1) and the particle budget down after ~3 s below 28 fps, stepping
back up after ~8 s above 50 fps; gameplay is never touched, only
rendering cost. **Bugs from playtests, fixed:** the 50% distance gate
now toasts the track unlock mid-run (and the run-over screen says so
too — before, a player who died past halfway unlocked the next track
silently), hit bursts are smaller (40 → 24 particles) so the ship no
longer hides inside its own explosion, `setPointerCapture` can't throw
on edge-case pointers, and a browser with no WebGL at all now gets a
plain message with Play disabled instead of a menu full of dead
buttons. **Touch:** a real touch drag steers (verified with genuine
touch input, not synthetic events) and the first touch reveals the
Boost button. **Cross-browser:** Chromium render check passes fully;
headless Firefox in this VM cannot create a WebGL context at all (no
system EGL — tried force-enabled prefs, Chromium's ANGLE libraries,
and disabling the content sandbox), so `tests/firefox-check.js`
verifies the graceful WebGL-failure path there and reports BLOCKED
rather than a false pass. A full Firefox flight check needs a machine
with EGL; the game uses standard Three.js WebGL2 with no
Chromium-only APIs.

**Tests:** smoke 409/409, bot 12/12, render check PASS (zero console
errors) including the new M5 assertions — text size 16 → 18 → 20 px
persisted through the settings UI, high contrast toggles + persists,
reduce-flashing persists, the FPS guard stepped down on its own under
swiftshader and forced levels stick, touch-drag steers right on screen
and reveals the Boost button, and the 50% unlock toast fired mid-run
during the Time Trial leg. Firefox check BLOCKED (environment, see
above) with its DOM tier passing. Size sweep inspected by eye at
1280x720, 2560x1080, 1080x2340, plus the settings screen at the phone
size with Extra large text.

**Playtest verdict:** GO. The lagged, noisy human-like driver
**completed T1** (1299 m, 66.8 s, 8 gates, 7 cells, 4 near-misses, 1
hit, 2 shields left, 22 pops, 68 energy banked) — livelier than M4's
leg, which died at 910 m — saw the unlock toast mid-run, and the
complete screen announced "Track 2 — Violet Spiral unlocked!". The
after-hit frame shows the ship clearly visible beside its burst (the
M3/M4 soft spot is fixed). A second leg with Large text + high
contrast at phone size flew cleanly (2 gates, 1 cell, 0 hits in the
time the slow renderer allowed) and caught one real bug by eye: the
high-contrast button rule flattened the primary button's bright
gradient, leaving dark "Play" text on a dark button — fixed by
scoping the override to non-primary buttons. The settings screen at
phone size with Extra large text was re-captured after the fix.

## M4 — Progression & depth (v0.4.0) — 2026-11-21

The campaign now has a reason to replay. Every run banks **energy**
(cells +2, gates +3, +10 at each quarter of the track), and energy buys
**ship upgrades** — Thrusters, Plating, Boost Tank, three tiers each
(595 energy for the full set, about one campaign playthrough). Tracks
unlock down a chain at 50% best distance, so pushing halfway down a
track earns the next one; old saves keep every track they ever flew.
And **Time Trial** races each track against its par time — the greedy
bot's time, 68–91 s across the campaign — for gold (beat the bot),
silver and bronze medals. The mode fits the steering core: it is the
same flight, but boost management and clean lines are the whole game,
and upgrades earn faster times, so the economy and the mode feed each
other. A Daily track was considered and rejected: it would need a
date-seeded generator and adds a calendar dependency without deepening
steering; Time Trial deepens the one skill the game is about.

**Tests:** smoke 394/394, bot 12/12 (plus the upgraded bot completes
all 12 and centre still fails all 12 with max upgrades), render check
PASS (zero console errors) including the new M4 assertions — track 2
locked on a fresh profile, the locked card explains itself and never
starts a run, the mode toggle relabels Play as Race, upgrades bought
through the UI charge the right price and refuse unaffordable buys
with a reason, and a full Time Trial run of track 1 ends with a medal,
a saved best time, banked energy and track 2 unlocked. Size sweep
inspected by eye at 1280x720, 2560x1080, 1080x2340, plus the upgrades
screen at the phone size.

**Playtest verdict:** GO. A lagged, noisy human-like gate-chaser died at
910 m on T1 (16 pops, 52 energy), then completed T1 with Thrusters 1
(25 pops, 60 energy) — the upgrade is legible in play. Time Trial leg
died at 355 m; the medal moment was proven by the render check's
autopilot (GOLD 60.8 s, "New best time!").

## M1 — Core (v0.1.0) — 2026-11-21

First milestone of the 12-hour sprint (game #4, second 3D game of the
loop). The core is done: a 3D neon tunnel racer where steering at speed
is the whole game.

**Built:**
- Tunnel flight engine: auto-forward with a speed ramp, steering with
  momentum and banking (drag / arrows / WASD / touch), boost on Space
  with a draining meter that gates refill.
- Obstacles: blocks, mines, moving barrier walls (the gap slides —
  time the pass), boost gates, energy cells. 3 shields; a hit costs
  one, stuns, and grants brief invulnerability.
- 6 dense hand-crafted tracks with distinct identities (palette,
  layout, obstacle rhythm), built from segment scripts — slalom, gate
  lines, minefields with a guaranteed corridor, barriers, weaves,
  gauntlets. No empty straights; the opening seconds teach.
- Real 3D: chase camera with depth, streaming tunnel rings, parallax
  starfield, nebula glow, emissive-rim obstacles, ship trail.
- Live-3D menu: the attract flight actually flies track 1 behind the
  menu. Screen-stack flow, overshoot pops, hover tick SFX + scale pop
  on every button, one primary Play, no version text on player screens.
- Game feel: trauma shake tiers, hit-stop, pooled particles, near-miss
  slow-mo, FOV kick with speed, Web Audio synth SFX + ambient pad.
- Anti-slop: no auto-steer, no assist. The bot steers through the
  public hooks and still needs real decisions; holding centre fails
  every track within 500 m.

**Tests:** smoke 173/173, bot 6/6 tracks completed by the steering bot
(centre fails 6/6), render check PASS (zero console errors), size
sweep inspected by eye at 1280x720, 2560x1080, 1080x2340.

**Playtest verdict:** GO — the steering core is fun (see the M1
milestone log for the honest detail).

**Known issues:**
- Under software rendering (swiftshader) the game runs at a fraction
  of real-time speed; all time-based render-check assertions poll
  instead of using fixed windows. On a real GPU it runs at 60fps.
- Track run times are long (65–80 s per track at bot pace) — the
  campaign pacing is a tuning question for M2.

## M2 — Track craft (v0.2.0) — 2026-11-21

Second milestone: the campaign grows from 6 tracks to 12, with a new
segment rhythm — the **spiral**, where boost gates orbit the centre and
the ship must fly a circle, not a line. Each new track has its own
palette and identity: Solar Flare (spiral debut), Emerald Rush (double
barriers everywhere), Rose Nebula (minefields + spirals), Azure Deep
(gauntlet after gauntlet), Acid Rain (spiral/slalom alternation), Void
Crown (everything, at full speed). The difficulty curve is smooth by
measurement: bot run times grow steadily 68 s → 91 s across the 12
tracks, with no cliff between adjacent tracks.

**Tuning found by the bot, not by guessing:**
- The first draft failed: the bot died on tracks 9, 11 and 12, all on
  double-barrier segments (the two walls were 80 u apart with the gap
  sliding ±7 — no time to re-aim at the higher speeds). The walls were
  spaced to 100 u apart and their slide eased to ±6.
- The bot's clearance scoring was also a weak link: it treated a
  0.4-clearance pass as nearly as good as a 2-clearance one, so it flew
  into centre mines while chasing gates. It now pays a steep penalty
  for flying close to any obstacle.
- The last failure was a real geometry trap in the **slalom** segment
  itself (all 12 tracks): the gate sat 11 u before the centre mine, so
  the swing from the gate to the next block's safe side crossed the
  mine's line — unthreadable at speed even on a good line. The gate now
  rides after the mine, so the mine is met while the ship is still on
  the open side and the gate-to-block swing is clear. The centre line
  is still guarded: holding centre hits the mine.

**Tests:** smoke 275/275, bot 12/12 tracks completed by the steering bot
(centre fails 12/12), render check PASS (zero console errors), size
sweep inspected by eye at 1280x720, 2560x1080, 1080x2340.

**Playtest verdict:** GO — the spiral orbits (534° ship sweep vs 540°
gate orbit on T7), a lagged noisy hand-chaser threads all 9 gates to
500 m on T7, and T11/T12 event timelines show a decision every 1–4 s
with no dead stretches (see the M2 milestone log for the honest detail).

### Hotfix v0.2.1 — steering was mirrored on screen (same run, before the finale)
The live-site check after the v0.2.0 push found it: ArrowLeft moved the
ship to the RIGHT side of the screen, and drag steering was mirrored
the same way. Root cause: the chase camera sits at z=-8.5 and looks
toward +z, so its right vector is world -x — the view is mirrored
left-right. It had been there since M1: every steering test before it
measured world x only (the ship DID move in world space), so the
mirror was invisible to the whole test suite. The live browser check
caught it with a matched-distance test (6× ArrowLeft → screen x≈1225,
right of centre; 6× ArrowRight → x≈700, left).

Fix: the lateral component of HUMAN input (keyboard + drag) is negated
where screen input becomes world input, so ArrowLeft moves the ship
screen-left. Autopilot, hookSteer and steerTarget are untouched — they
drive the simulation in world coordinates by contract. The ship's bank
was already correct on screen once the input is fixed. The render check
now asserts screen direction (projected ship position): ArrowLeft must
decrease screen x, ArrowRight must increase it. Tests re-run after the
fix: smoke 275/275, bot 12/12, render PASS including the new screen
assertion.

**Known issues:**
- Best-distance saves for tracks 7–12 needed a save-schema fix: the
  old parser only accepted track ids 1–6. Fixed in this milestone
  (ids 1–12 accepted).

## M3 — Feel & juice (v0.3.0) — 2026-11-21

Third milestone: the flying has to *feel* great, not just work. Every
event now fires a full 5–8 layer bundle (the game-feel recipe), and the
contract lives in `physics.js` as `FEEDBACK_LAYERS` — the smoke test
asserts every event carries 5–8 known layers, and the render check
asserts the layers actually fire in the browser.

**Built:**
- **Floating score pops:** pooled DOM divs at the event's projected
  screen position (+250 gate, +100 cell, +25 near-miss, total on
  complete), overshoot pop + rise + fade, offset just above the event
  so the number never sits on the ship. The gate/near-miss toasts are
  gone — the pop is the feedback now.
- **Camera polish:** roll with the bank, speed pull-back, hit
  knockback (camera z push), FOV pulse on gates/boost/complete on top
  of the speed kick. Every layer decays in real time to its exact rest
  value (FOV 72, z -8.5, roll 0).
- **Audio deepening:** the static pad is now a generative synthwave
  sequencer — A-minor bass line plus a pentatonic arpeggio that doubles
  in density as the ship speeds up, over the pad. SFX are pitch-varied
  (±5%) so repeated gates never machine-gun; near-miss and boost get a
  filtered-noise whoosh.
- **Ship detail:** canopy + twin engine glows that breathe with speed
  and pulse on gates/cells; hit squash (wider, flatter, springs back).
- **Rest-state proof:** the render check pauses mid-run and asserts
  trauma 0, time scale 1, FOV back to its speed baseline, camera z and
  roll at rest — and proves the accessibility toggles do what they say
  (shake 0% → trauma fires, camera still; reduce-flashing ON → no
  flash, OFF → flash).

**Tests:** smoke 312/312, bot 12/12, render check PASS (zero console
errors) including all new M3 assertions, size sweep inspected by eye
at 1280x720, 2560x1080, 1080x2340 — clean at all three.

**Playtest verdict:** GO — it feels great. A lagged, noisy
human-like chaser on T1: 16 pops in 41 s of game time (an event every
1–3 s), peak FOV 82.4, hit trauma 0.45 with knockback 1.0, slow-mo on
4 near-misses, 728 m with 1 shield left. On T7: 23 pops, peak FOV
87.0, 9 gates and 10 cells before dying at 1085 m — challenging but
fair, the spiral still demands real steering. (See the M3 milestone
log for the honest detail, including the probe bug that made the first
T7 leg fly with no input at all.)

**Known issues:**
- Under swiftshader the game runs at ~5 fps, so short-lived juice
  (a 0.15 s trauma spike, a 120 ms flash) can fall between frames —
  the render check polls every 50 ms and captures values atomically
  in-page instead of reading them after the fact.
