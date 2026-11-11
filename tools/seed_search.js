// node tools/seed_search.js [scenario] [from] [to]   -> ambulance time with / without Green Wave per seed
global.window = {};
require('../assets/data.js');
const { Sim } = require('../assets/sim.js');
const D = window.ILIO;
const sc = process.argv[2] || 'S3', from = +(process.argv[3] || 1), to = +(process.argv[4] || 24);
for (let seed = from; seed <= to; seed++) {
  const out = [];
  for (const gw of [false, true]) {
    const s = new Sim(D, { scenario: sc, seed, greenWave: gw, dynGps: gw });
    while (s.t < 3800 && !(s.amb.end > 0)) s.tick();
    out.push(s.amb.end > 0 ? Math.round(s.amb.total) : 'x');
  }
  console.log(sc, 'seed', seed, 'A(no GW)=', out[0], 'B(GW+GPS)=', out[1]);
}
