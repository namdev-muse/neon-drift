# Neon Drift

A 3D neon tunnel racer — **steer your ship through a glowing tunnel at
rising speed**. Dodge violet blocks and mines, time your pass through
moving barrier walls, thread magenta boost gates for speed and score,
and collect gold energy cells. You have 3 shields: a hit costs one and
stuns the ship; lose all three and the run ends. Reach the end of the
track to complete it. Score comes from distance, gates and cells — your
best distance is saved per track.

**Live:** https://namdev-muse.github.io/neon-drift/
**Version:** v0.1.0 (M1 core)
**Stack:** Three.js 0.160.0 (pinned via jsdelivr import map, no build step), vanilla HTML/CSS/JS, Web Audio synth SFX, GitHub Pages.

## Gameplay

Real captures from a headless-Chromium run of the game
(`npm run screenshots` regenerates them — see `tests/screenshots.js`).

![Main menu over the live 3D attract scene](docs/screenshots/menu.png)
![Mid-run on First Light — the ship banks through the tunnel](docs/screenshots/gameplay.png)
![Run over — best distance saved](docs/screenshots/runover.png)

## The core: steering is the skill

The ship flies forward on its own and only gets faster. Steering has
momentum and banking — the ship goes where you point it, but it takes a
moment to get there, so you steer early and commit. There is no
auto-steer, no assist, and nothing that tells you the answer before you
act. Holding the centre line is never free: every stretch of every
track guards the centre with a block, a mine, or a barrier wall. The
bot harness proves it — the greedy steering bot completes all 6 tracks,
while holding centre fails all 6 within the first 500 m.

## Tracks

Six hand-crafted tracks, each with its own identity (palette, layout,
obstacle rhythm), built from dense segments — slalom, gate lines, mine
fields with a guaranteed corridor, moving barriers, weaves, gauntlets.
No empty straights: every stretch has a decision. The opening seconds
are gentle — the ship starts centred and slow — then the tunnel
tightens.

| # | Track | Length | Top speed |
|---|-------|--------|-----------|
| 1 | First Light | 1300 m | 24 u/s |
| 2 | Violet Spiral | 1500 m | 27 u/s |
| 3 | Gold Rush | 1600 m | 28 u/s |
| 4 | Crimson Gauntlet | 1800 m | 30 u/s |
| 5 | Nebula Weave | 1900 m | 31 u/s |
| 6 | Event Horizon | 2100 m | 33 u/s |

## Controls

- Mouse / touch: drag to steer
- Arrow keys / WASD: steer
- Space (or the Boost button on touch): boost — drains the meter, refills passively and through gates
- P: pause · M: mute · R: restart · Esc: back / pause

## Game feel

Trauma screen shake (small / medium / large tiers with hit-stop),
hit-stop on impacts, near-miss slow-mo, pooled particles on every
event, FOV kick with speed, Web Audio synth SFX and an ambient pad,
screen-shake and reduce-flashing settings.

## Tests

- `npm run smoke` — 173 physics checks (tracks, steering, boost, gates, cells, hits, save, anti-slop gate)
- `npm test` — smoke + bot (steering bot completes all 6 tracks; holding centre fails all 6)
- `npm run render-check` — headless Chromium: menu over the live 3D scene, steering, gates, cells, shield loss, run-over, pause, restart, zero console errors
- `npm run screenshots` — README captures + 3-resolution size sweep (1280x720, 2560x1080, 1080x2340), inspected by eye

## Devlog

See [docs/devlog.md](docs/devlog.md).
