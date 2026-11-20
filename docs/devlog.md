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
