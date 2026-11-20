# Neon Drift — devlog

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
