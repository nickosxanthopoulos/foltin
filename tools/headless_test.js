// Headless smoke test of assets/sim.js   ->   node tools/headless_test.js
global.window = {};
require('../assets/data.js');
const { Sim } = require('../assets/sim.js');
const D = window.ILIO;

function run(label, opts, until) {
  const logs = [];
  const t0 = Date.now();
  const s = new Sim(D, Object.assign({ onLog: (m) => logs.push(m) }, opts));
  let nan = 0;
  while (s.t < until) {
    s.tick();
    if (s.step % 100 === 0 && Math.abs(s.t - s.step) < 1e-6) for (const v of s.vehicles) if (!isFinite(v.pos) || !isFinite(v.v)) nan++;
    if (s.amb.end > 0 && s.t > s.amb.end + 30) break;
  }
  const dt = Date.now() - t0;
  const last = s.stats.series[s.stats.series.length - 1];
  console.log(`${label.padEnd(26)} t=${Math.round(s.t)}  veh=${s.vehicles.length} stopped=${last && last.stopped} spawned=${s.stats.spawned} arrived=${s.stats.arrived} tele=${s.stats.teleports} dropped=${s.stats.dropped || 0} amb=${s.amb.total ? Math.round(s.amb.total) : (s.amb.entered ? 'on route' : '-')} forced=${s.stats.forced} reroutes=${s.amb.reroutes} nan=${nan} [${dt} ms]`);
  return { s, logs };
}

const mode = process.argv[2] || 'all';
if (mode === 'all') {
  run('S0 baseline', { scenario: 'S0', seed: 1 }, 2600);
  run('S1 +traffic', { scenario: 'S1', seed: 1 }, 2600);
  run('S2 accident', { scenario: 'S2', seed: 1 }, 2600);
  run('S3 works GW on', { scenario: 'S3', seed: 1, greenWave: true }, 2600);
  run('S3 works GW off', { scenario: 'S3', seed: 1, greenWave: false, dynGps: false }, 2600);
} else {
  const r = run('detail', { scenario: process.argv[3] || 'S3', seed: 1 }, 3000);
  console.log(r.logs.filter((m) => m.kind !== 'stat').slice(0, 60).map((m) => Math.round(m.t) + ' ' + m.msg).join('\n'));
  console.log(r.logs.filter((m) => m.kind === 'stat').map((m) => m.msg).join('\n'));
}
