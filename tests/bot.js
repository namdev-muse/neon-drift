// Neon Drift v0.5.0 — bot harness: the greedy steering bot plays every
// track to completion through the public stepRun + policy hooks, and the
// anti-slop gate asserts holding centre CANNOT finish any track — if the
// bot could clear a track without steering, the track would not be done.
import { TRACKS, simulateRun, centrePolicy, greedyPolicy } from '../physics.js';

let failures = 0;
for (const track of TRACKS) {
  const bot = simulateRun(track, greedyPolicy);
  const centre = simulateRun(track, centrePolicy);
  console.log(`Track ${track.id} "${track.name}": bot ${bot.completed ? 'COMPLETE' : 'FAILED'}`
    + ` in ${bot.time.toFixed(1)}s, ${bot.distance.toFixed(0)}u, score ${bot.score}`
    + ` (${bot.gatesHit} gates, ${bot.cellsHit} cells, ${bot.nearMisses} near-misses,`
    + ` ${bot.hitsTaken} hits, ${bot.shields} shields left)`
    + ` | centre: ${centre.completed ? 'CLEARED (SLOP!)' : `failed at ${centre.distance.toFixed(0)}u`}`);
  if (!bot.completed) { failures++; console.error(`  BOT FAIL: track ${track.id} not completed by the steering bot`); }
  if (bot.shields <= 0) { failures++; console.error(`  BOT FAIL: track ${track.id} bot finished with no shields`); }
  if (centre.completed) { failures++; console.error(`  BOT FAIL: track ${track.id} is clearable by holding centre — tighten the track`); }
  if (bot.gatesHit === 0) { failures++; console.error(`  BOT FAIL: track ${track.id} bot hit no gates`); }
}

if (failures) { console.error(`bot: ${failures} failure(s)`); process.exit(1); }
console.log('bot: PASS — steering bot completes all 12 tracks, holding centre fails all 12');
