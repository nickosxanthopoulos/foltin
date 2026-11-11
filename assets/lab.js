/* =====================================================================
 *  lab.js  --  (1) Green-wave race (1D illustration)   (2) Monte Carlo lab (workers)
 * ===================================================================== */
(function () {
  'use strict';
  const D = window.ILIO, TS = window.TrafficSim;
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [].slice.call((r || document).querySelectorAll(s));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const dprOf = () => Math.min(2, window.devicePixelRatio || 1);
  function fitCanvas(c) {
    const d = dprOf(), w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return { g, w, h };
  }
  function onVisible(el, cb) { new IntersectionObserver((en) => cb(en[0].isIntersecting), { threshold: 0.05 }).observe(el); }

  // ====================================================================== 1. RACE (1D)
  const ROAD = 1000, LIGHTS = [210, 430, 650, 870], CYC = 44, GREEN = 20, YEL = 3;
  class Road {
    constructor(spawn, offs, gw) {
      this.gw = gw; this.spawn = spawn; this.si = 0; this.offs = offs; this.t = spawn[0] - 1; this.cars = []; this.forced = LIGHTS.map(() => false);
      this.amb = null; this.done = false; this.time = 0; this.tStart = 0;
    }
    state(i) {
      if (this.forced[i]) return 'G';
      const tt = ((this.t + this.offs[i]) % CYC + CYC) % CYC;
      return tt < GREEN ? 'G' : tt < GREEN + YEL ? 'y' : 'r';
    }
    startAmb() { this.amb = { x: 0, v: 12, id: 'AMB' }; this.tStart = this.t; }
    step(dt) {
      this.t += dt;
      // spawn
      while (this.si < this.spawn.length && this.spawn[this.si] <= this.t) {
        const last = this.cars[this.cars.length - 1];
        if (!last || last.x > 12) { this.cars.push({ x: 0, v: 10 }); this.si++; } else break;
      }
      // forced green: the TraCI rule of `code`
      if (this.gw && this.amb && !this.done) {
        for (let i = 0; i < LIGHTS.length; i++) {
          const d = LIGHTS[i] - this.amb.x;
          if (d > -2) { if (d < 400 && this.state(i) !== 'G') this.forced[i] = true; break; }
        }
      }
      if (this.amb) for (let i = 0; i < LIGHTS.length; i++) if (this.forced[i] && this.amb.x > LIGHTS[i] + 12) this.forced[i] = false;   // setProgram(..., "0")
      // cars (IDM) – sorted by x descending
      const cars = this.cars;
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k], lead = cars[k - 1];
        let gap = 1e9, vl = 14;
        if (lead) { gap = lead.x - c.x - 4.6; vl = lead.v; }
        for (let i = 0; i < LIGHTS.length; i++) {
          const d = LIGHTS[i] - c.x - 1;
          if (d > -1 && d < 120) { const s = this.state(i); if (s !== 'G' && (s === 'r' || c.v * c.v / 5 < d)) { if (d < gap) { gap = d; vl = 0; } } break; }
        }
        const v0 = 13.9, a = 1.9, b = 2.6, T = 1.3, s0 = 2.2;
        const s = Math.max(.1, gap + s0 - 2.2), dv = c.v - vl;
        const sStar = s0 + Math.max(0, c.v * T + c.v * dv / (2 * Math.sqrt(a * b)));
        const acc = a * (1 - Math.pow(c.v / v0, 4) - Math.pow(sStar / Math.max(s0, gap + s0), 2));
        c.v = clamp(c.v + acc * dt, 0, v0); c.x += c.v * dt;
      }
      this.cars = cars.filter((c) => c.x < ROAD + 20);
      // ambulance: not blocked by cars (they pull aside), only by red lights
      if (this.amb && !this.done) {
        const m = this.amb; let gap = 1e9;
        for (let i = 0; i < LIGHTS.length; i++) {
          const d = LIGHTS[i] - m.x - 1;
          if (d > -1) { const s = this.state(i); if (s !== 'G' && (s === 'r' || m.v * m.v / 7 < d)) gap = d; break; }
        }
        const v0 = 22, a = 3.4, b = 5.5, T = .6;
        const vsafe = gap < 1e8 ? -b * T + Math.sqrt(b * b * T * T + 2 * b * Math.max(0, gap)) : v0;
        m.v = clamp(Math.min(m.v + a * dt, v0, vsafe), 0, v0);
        m.x += m.v * dt;
        if (m.x >= ROAD) { this.done = true; this.time = this.t - this.tStart; }
      }
    }
  }
  const raceCv = $('#race');
  let race = null, raceSeed = 11, raceHold = 0, raceVisible = false, raceLast = performance.now();
  function newRace() {
    const rng = TS.mulberry32(raceSeed * 7919 + 13);
    const spawn = []; let t = -45; while (t < 200) { t += -Math.log(1 - rng()) / 0.36; spawn.push(t); }
    const offs = LIGHTS.map(() => rng() * CYC);
    const A = new Road(spawn, offs, false), B = new Road(spawn, offs, true);
    for (const r of [A, B]) { while (r.t < 0) r.step(0.25); r.startAmb(); }
    race = { A, B }; raceHold = 0;
  }
  function drawRoad(g, w, y0, h, R, label, col) {
    const x0 = 34, x1 = w - 24, sx = (m) => x0 + (m / ROAD) * (x1 - x0);
    g.fillStyle = 'rgba(10,16,32,.9)'; g.beginPath(); g.roundRect ? g.roundRect(x0 - 12, y0, x1 - x0 + 24, h, 12) : g.rect(x0 - 12, y0, x1 - x0 + 24, h); g.fill();
    g.strokeStyle = 'rgba(148,163,184,.12)'; g.stroke();
    const cy = y0 + h * .62, cyCar = y0 + h * .38;
    g.setLineDash([8, 10]); g.strokeStyle = 'rgba(148,163,184,.18)'; g.beginPath(); g.moveTo(x0, y0 + h * .5); g.lineTo(x1, y0 + h * .5); g.stroke(); g.setLineDash([]);
    g.font = '600 10.5px "JetBrains Mono", monospace'; g.fillStyle = col; g.textBaseline = 'middle'; g.fillText(label, x0, y0 + 11);
    // green-wave band
    if (R.gw && R.amb && !R.done) { const a = sx(R.amb.x), b = sx(Math.min(ROAD, R.amb.x + 400)); const gr = g.createLinearGradient(a, 0, b, 0); gr.addColorStop(0, 'rgba(52,211,153,.2)'); gr.addColorStop(1, 'rgba(52,211,153,0)'); g.fillStyle = gr; g.fillRect(a, y0 + 4, b - a, h - 8); }
    // lights
    LIGHTS.forEach((m, i) => {
      const s = R.state(i), c = s === 'G' ? '#34d399' : s === 'y' ? '#fbbf24' : '#fb7185', x = sx(m);
      g.strokeStyle = c; g.lineWidth = 3; g.shadowColor = c; g.shadowBlur = 10; g.beginPath(); g.moveTo(x, y0 + 16); g.lineTo(x, y0 + h - 8); g.stroke(); g.shadowBlur = 0; g.lineWidth = 1;
      if (R.forced[i]) { g.fillStyle = '#6ee7b7'; g.fillText('★', x - 4, y0 + 11); }
    });
    // cars
    g.fillStyle = '#facc15'; R.cars.forEach((c) => { const x = sx(c.x); g.globalAlpha = .9; g.beginPath(); g.roundRect ? g.roundRect(x - 6, cyCar - 3.5, 7, 7, 2) : g.rect(x - 6, cyCar - 3.5, 7, 7); g.fill(); }); g.globalAlpha = 1;
    // ambulance
    if (R.amb) {
      const x = sx(Math.min(R.amb.x, ROAD)), fl = Math.floor(performance.now() / 200) % 2;
      g.save(); g.shadowColor = fl ? '#ef4444' : '#3b82f6'; g.shadowBlur = 18; g.fillStyle = '#f8fafc'; g.beginPath(); g.roundRect ? g.roundRect(x - 8, cy - 4.5, 11, 9, 3) : g.rect(x - 8, cy - 4.5, 11, 9); g.fill(); g.fillStyle = fl ? '#ef4444' : '#3b82f6'; g.fillRect(x - 3, cy - 4.5, 3, 9); g.restore();
    }
    if (R.done) { g.fillStyle = '#fff'; g.font = '700 13px "Space Grotesk", sans-serif'; g.textAlign = 'right'; g.fillText('🏁 ' + R.time.toFixed(1) + ' s', x1 - 4, y0 + 11); g.textAlign = 'left'; }
  }
  function raceFrame(now) {
    const dtR = Math.min(.1, (now - raceLast) / 1000); raceLast = now;
    if (raceVisible && race) {
      const sp = 4; let n = Math.round(dtR * sp / .25); for (let i = 0; i < Math.max(1, n); i++) { race.A.step(.25); race.B.step(.25); }
      const { g, w, h } = fitCanvas(raceCv); g.clearRect(0, 0, w, h);
      drawRoad(g, w, 6, h / 2 - 10, race.A, 'A · χωρίς Green Wave', '#fb7185');
      drawRoad(g, w, h / 2 + 4, h / 2 - 10, race.B, 'B · με Green Wave (400 m)', '#34d399');
      // axis
      g.fillStyle = 'rgba(148,163,184,.5)'; g.font = '10px "JetBrains Mono"'; g.textBaseline = 'alphabetic';
      $('#race-a').innerHTML = (race.A.done ? race.A.time : race.A.t - race.A.tStart).toFixed(1) + '<span class="u">s</span>';
      $('#race-b').innerHTML = (race.B.done ? race.B.time : race.B.t - race.B.tStart).toFixed(1) + '<span class="u">s</span>';
      if (race.A.done && race.B.done) { raceHold += dtR; if (raceHold > 3.2) { raceSeed++; newRace(); } }
    }
    requestAnimationFrame(raceFrame);
  }
  if (raceCv) {
    newRace(); onVisible(raceCv, (v) => { raceVisible = v; raceLast = performance.now(); });
    $('#race-restart').addEventListener('click', () => { raceSeed++; newRace(); });
    requestAnimationFrame(raceFrame);
  }

  // ====================================================================== 2. MONTE CARLO
  // Four arms, identical seeds:  A baseline · B Green Wave · C dynamic GPS · D both
  const ARMS = [
    { k: 'A', name: 'Baseline', sub: 'χωρίς GW, χωρίς reroute', gw: false, gps: false, col: '#94a3b8' },
    { k: 'B', name: 'Green Wave', sub: 'forced green ≤ 400 m', gw: true, gps: false, col: '#34d399' },
    { k: 'C', name: 'Δυναμικό GPS', sub: 'device.rerouting 100 s', gw: false, gps: true, col: '#a78bfa' },
    { k: 'D', name: 'GW + GPS', sub: 'ο συνδυασμός του README', gw: true, gps: true, col: '#22d3ee' },
  ];
  const mcCv = $('#mc-chart');
  const MC = { sc: 'S3', n: 12, R: ARMS.map(() => []), running: false, total: 0, done: 0, workers: [], url: null };
  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const quant = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const vals = (k) => MC.R[k].filter((r) => r).map((r) => r.v);

  function drawMC() {
    const { g, w, h } = fitCanvas(mcCv); g.clearRect(0, 0, w, h);
    const all = [].concat.apply([], ARMS.map((a, k) => vals(k)));
    const padL = 92, padR = 24, padT = 14, padB = 30;
    g.font = '600 11px "JetBrains Mono", monospace'; g.textBaseline = 'middle';
    if (!all.length) { g.fillStyle = 'rgba(148,163,184,.6)'; g.textAlign = 'center'; g.font = '500 14px Inter, sans-serif'; g.fillText('Πάτα «Τρέξε το Monte Carlo» — τα αποτελέσματα εμφανίζονται ζωντανά', w / 2, h / 2); g.textAlign = 'left'; return; }
    let lo = Math.min.apply(null, all), hi = Math.max.apply(null, all); const span = Math.max(40, hi - lo); lo = Math.max(0, lo - span * .06); hi += span * .08;
    const X = (v) => padL + (v - lo) / (hi - lo) * (w - padL - padR);
    const rowH = (h - padT - padB) / ARMS.length;
    g.strokeStyle = 'rgba(148,163,184,.1)'; g.fillStyle = 'rgba(148,163,184,.55)'; g.lineWidth = 1; g.textAlign = 'center';
    const step = (() => { const raw = (hi - lo) / 6, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw); })();
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { g.beginPath(); g.moveTo(X(v), padT); g.lineTo(X(v), h - padB + 4); g.stroke(); g.fillText(Math.round(v) + ' s', X(v), h - 12); }
    ARMS.forEach((a, k) => {
      const y = padT + rowH * (k + .5), list = MC.R[k].filter((r) => r);
      if (k % 2 === 0) { g.fillStyle = 'rgba(15,23,42,.55)'; g.fillRect(0, y - rowH / 2, w, rowH); }
      g.textAlign = 'left'; g.fillStyle = a.col; g.font = '700 11px "JetBrains Mono"'; g.fillText(a.k + ' · ' + a.name.split(' ')[0], 12, y - 6);
      g.fillStyle = 'rgba(148,163,184,.5)'; g.font = '500 9.5px Inter'; g.fillText(a.k === 'D' ? 'GW + GPS' : a.sub.slice(0, 16), 12, y + 8);
      if (!list.length) return;
      const v = list.map((r) => r.v), q1 = quant(v, .25), q3 = quant(v, .75), med = quant(v, .5), mu = mean(v);
      g.fillStyle = a.col + '24'; g.strokeStyle = a.col + '66'; g.lineWidth = 1; g.beginPath();
      if (g.roundRect) g.roundRect(X(q1), y - rowH * .3, Math.max(3, X(q3) - X(q1)), rowH * .6, 6); else g.rect(X(q1), y - rowH * .3, Math.max(3, X(q3) - X(q1)), rowH * .6);
      g.fill(); g.stroke();
      list.forEach((r, i) => {
        const jy = (((i * 37 + k * 11) % 13) - 6) * (rowH * .036);
        g.fillStyle = a.col; g.shadowColor = a.col; g.shadowBlur = 8; g.beginPath(); g.arc(X(r.v), y + jy, r.cens ? 3 : 4, 0, 6.2832); g.fill(); g.shadowBlur = 0;
        if (r.cens) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); }
      });
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(med), y - rowH * .32); g.lineTo(X(med), y + rowH * .32); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(X(mu), y - 9); g.lineTo(X(mu) + 5, y - 14); g.lineTo(X(mu) - 5, y - 14); g.closePath(); g.fill();
      g.font = '700 10.5px "JetBrains Mono"'; g.textAlign = 'left'; g.fillStyle = '#e2e8f0'; g.fillText('μ ' + Math.round(mu) + ' s', Math.min(X(Math.max.apply(null, v)) + 12, w - 62), y - rowH * .32 + 2);
    });
    g.textAlign = 'left';
  }
  function updateMCStats() {
    const base = vals(0), tb = $('#mc-table'); if (!tb) return;
    tb.innerHTML = ARMS.map((a, k) => {
      const v = vals(k);
      if (!v.length) return '<div class="tile flex items-center justify-between opacity-50"><span class="text-[13px]" style="color:' + a.col + '">' + a.k + ' · ' + a.name + '</span><span class="mono text-slate-500">—</span></div>';
      const mu = mean(v); let wins = 0, pairs = 0, worse = 0;
      if (k) for (let i = 0; i < MC.n; i++) if (MC.R[0][i] && MC.R[k][i]) { pairs++; if (MC.R[k][i].v < MC.R[0][i].v) wins++; else if (MC.R[k][i].v > MC.R[0][i].v * 1.05) worse++; }
      const gain = k && base.length ? (mean(base) - mu) / mean(base) * 100 : null;
      return '<div class="tile" style="border-color:' + a.col + '40"><div class="flex items-center justify-between gap-2"><span class="text-[13px] font-semibold" style="color:' + a.col + '">' + a.k + ' · ' + a.name + '</span><span class="v !mt-0 !text-[19px]">' + Math.round(mu) + '<span class="u">s</span></span></div>' +
        '<div class="mt-1.5 flex items-center justify-between text-[11px] mono text-slate-500"><span>med ' + Math.round(quant(v, .5)) + ' · p90 ' + Math.round(quant(v, .9)) + '</span>' +
        (gain === null ? '<span>αναφορά</span>' : '<span style="color:' + (gain >= 0 ? '#34d399' : '#fb7185') + '">' + (gain >= 0 ? '−' : '+') + Math.abs(gain).toFixed(0) + '% · ' + wins + '/' + pairs + (worse ? ' · ' + worse + '↑' : '') + '</span>') + '</div></div>';
    }).join('');
    const mB = vals(1), mC = vals(2);
    if (base.length && mB.length && mC.length && MC.R[3].length) {
      let worseB = 0, pairs = 0;
      for (let i = 0; i < MC.n; i++) if (MC.R[0][i] && MC.R[1][i]) { pairs++; if (MC.R[1][i].v > MC.R[0][i].v * 1.05) worseB++; }
      const gB = (mean(base) - mean(mB)) / mean(base) * 100, gC = (mean(base) - mean(mC)) / mean(base) * 100;
      $('#mc-note').innerHTML = '<b class="text-slate-300">Τι βλέπουμε:</b> το δυναμικό GPS δίνει <b style="color:#a78bfa">' + gC.toFixed(0) + '%</b> κέρδος, το Green Wave μόνο του <b style="color:#34d399">' + gB.toFixed(0) + '%</b>' + (worseB ? ' και σε <b class="text-rose-300">' + worseB + '/' + pairs + '</b> seeds <i>χειροτερεύει</i> τον χρόνο (όπως το 519 → 690 s του SUMO)' : '') + '. Λευκός δείκτης ▼ = μέσος όρος, λευκή γραμμή = διάμεσος, πλαίσιο = ενδοτεταρτημοριακό εύρος. Ανοιχτές τελείες: το ασθενοφόρο δεν έφτασε μέσα στο όριο χρόνου.';
    }
  }

  async function makeWorkerURL() {
    const src = await (await fetch('assets/sim.js', { cache: 'force-cache' })).text();
    const code = 'self.window=self;' + src + ';\n' +
      'self.onmessage=function(e){var m=e.data;if(m.type==="init"){self.DD=m.D;return;}' +
      'var j=m.job;var s=new TrafficSim.Sim(self.DD,{scenario:j.sc,seed:j.seed,greenWave:j.gw,dynGps:j.gps,ambient:1200});' +
      'while(s.t<j.cap&&!(s.amb.end>0))s.tick();' +
      'self.postMessage({job:j,total:s.amb.end>0?s.amb.total:null,t:s.t,start:s.amb.start,forced:s.stats.forced});};';
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  function record(res) {
    const j = res.job, cens = res.total == null;
    const v = cens ? (j.cap - (res.start > 0 ? res.start : 1900)) : res.total;
    MC.R[j.arm][j.idx] = { v, cens, forced: res.forced };
    MC.done++;
    const pct = (MC.done / MC.total * 100).toFixed(0);
    $('#mc-bar').style.width = pct + '%'; $('#mc-pct').textContent = pct + '%'; $('#mc-status').textContent = 'τρέχει… ' + MC.done + ' / ' + MC.total + ' runs';
    drawMC(); updateMCStats();
  }
  function finish() {
    MC.running = false; $('#mc-run').disabled = false; $('#mc-run').innerHTML = '<svg viewBox="0 0 20 20" class="w-4 h-4 fill-current"><path d="M6 4l11 6-11 6z"/></svg> Ξανά';
    $('#mc-status').textContent = 'ολοκληρώθηκε · ' + MC.total + ' runs · ίδια seeds και στα 4 σκέλη'; MC.workers.forEach((w) => w.terminate()); MC.workers = [];
  }
  async function runMC() {
    if (MC.running) return;
    MC.running = true; MC.R = ARMS.map(() => []); MC.done = 0; MC.total = MC.n * ARMS.length;
    $('#mc-run').disabled = true; $('#mc-run').textContent = 'τρέχει…'; $('#mc-bar').style.width = '0%'; $('#mc-pct').textContent = '0%'; $('#mc-status').textContent = 'εκκίνηση workers…';
    drawMC(); updateMCStats();
    const jobs = [], cap = 4300;
    for (let i = 0; i < MC.n; i++) ARMS.forEach((a, k) => jobs.push({ sc: MC.sc, seed: 101 + i * 7, gw: a.gw, gps: a.gps, arm: k, idx: i, cap }));
    let usedWorkers = false;
    try {
      if (!window.Worker || location.protocol === 'file:') throw new Error('no worker');
      MC.url = MC.url || await makeWorkerURL();
      const { _net, ...pure } = D; const nw = clamp((navigator.hardwareConcurrency || 4) - 1, 2, 8); let next = 0;
      await new Promise((resolve, reject) => {
        let live = nw, failed = false;
        for (let k = 0; k < nw; k++) {
          const w = new Worker(MC.url); MC.workers.push(w);
          w.onerror = (e) => { if (!failed) { failed = true; reject(e); } };
          w.onmessage = (e) => { usedWorkers = true; record(e.data); if (next < jobs.length) w.postMessage({ type: 'job', job: jobs[next++] }); else if (--live === 0) resolve(); };
          w.postMessage({ type: 'init', D: pure }); w.postMessage({ type: 'job', job: jobs[next++] });
        }
      });
    } catch (err) {
      MC.workers.forEach((w) => w.terminate()); MC.workers = [];
      if (usedWorkers) { finish(); return; }
      $('#mc-status').textContent = 'fallback στο κύριο thread…';
      for (const j of jobs.filter((j) => !MC.R[j.arm][j.idx])) {
        await new Promise((r) => setTimeout(r, 0));
        const s = new TrafficSim.Sim(D, { scenario: j.sc, seed: j.seed, greenWave: j.gw, dynGps: j.gps, ambient: 1200 });
        while (s.t < j.cap && !(s.amb.end > 0)) s.tick();
        record({ job: j, total: s.amb.end > 0 ? s.amb.total : null, start: s.amb.start, forced: s.stats.forced });
      }
    }
    finish();
  }
  if (mcCv) {
    $$('#mc-sc button').forEach((b) => b.addEventListener('click', () => { if (MC.running) return; MC.sc = b.dataset.v; $$('#mc-sc button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('#mc-n button').forEach((b) => b.addEventListener('click', () => { if (MC.running) return; MC.n = +b.dataset.v; $$('#mc-n button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#mc-run').addEventListener('click', runMC);
    window.addEventListener('resize', drawMC); setTimeout(() => { drawMC(); updateMCStats(); }, 100);
    onVisible(mcCv, drawMC);
  }
  window.Lab = { runMC, MC };
})();
