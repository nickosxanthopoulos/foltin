/* =====================================================================
 *  app.js  --  hero: live map renderer + HUD + controls + guided tour
 *  Uses  window.ILIO (assets/data.js)  and  window.TrafficSim (assets/sim.js)
 * ===================================================================== */
(function () {
  'use strict';
  const D = window.ILIO, TS = window.TrafficSim;
  const { Sim, SCENARIOS, TYPES, TEMPERAMENTS, DT } = TS;
  const net = TS.buildNet(D), E = net.E;
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [].slice.call((r || document).querySelectorAll(s));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- state
  const S = { scenario: 'S3', gw: true, gps: false, rain: false, heat: true, follow: false, ambient: true, speed: 15, playing: true, seed: 5, ff: null, selected: null, tab: 'tls' };
  let sim = null, acc = 0, heroVisible = true, lastForced = 0, pulses = [], tour = null;

  // ---------------------------------------------------------------- canvas + camera
  const cv = $('#cv'), ctx = cv.getContext('2d', { alpha: false });
  let W = 0, H = 0, DPR = 1;
  const cam = { x: 900, y: 600, z: 0.7, tx: 900, ty: 600, tz: 0.7, snap: true };
  const isLg = () => window.matchMedia('(min-width: 1024px)').matches;
  function safeRect() {
    if (isLg()) return { l: 0, r: W - 372, t: 64, b: H - 210 };
    return { l: 0, r: W, t: 40, b: H - 10 };
  }
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(300, r.width); H = Math.max(300, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    if (!tour) fitCorridor(true);
  }
  function boundsOfEdges(ids) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ids.forEach((i) => E[i].lanes.forEach((l) => { for (let k = 0; k < l.pts.length; k += 2) { x0 = Math.min(x0, l.pts[k]); x1 = Math.max(x1, l.pts[k]); y0 = Math.min(y0, l.pts[k + 1]); y1 = Math.max(y1, l.pts[k + 1]); } }));
    return { x0, y0, x1, y1 };
  }
  const corridor = boundsOfEdges(D.routes.main);
  function fitBox(b, pad, instant) {
    const s = safeRect();
    const w = (b.x1 - b.x0) * (1 + pad), h = (b.y1 - b.y0) * (1 + pad);
    const z = Math.min((s.r - s.l) / Math.max(w, 60), (s.b - s.t) / Math.max(h, 60));
    cam.tz = clamp(z, 0.3, 12); cam.tx = (b.x0 + b.x1) / 2; cam.ty = (b.y0 + b.y1) / 2;
    if (instant) { cam.z = cam.tz; cam.x = cam.tx; cam.y = cam.ty; }
  }
  function fitCorridor(instant) {
    const b = { x0: Math.min(corridor.x0, 300), y0: Math.min(corridor.y0, 250), x1: Math.max(corridor.x1, 1500), y1: Math.max(corridor.y1, 1050) };
    // keep the corridor in frame but show plenty of the neighbourhood
    fitBox(b, 0.02, instant);
  }
  function camTo(x, y, z, instant) { cam.tx = x; cam.ty = y; cam.tz = z; if (instant) { cam.x = x; cam.y = y; cam.z = z; } }
  function toScreen(x, y) {
    const s = safeRect(), cx = (s.l + s.r) / 2, cy = (s.t + s.b) / 2;
    return [cx + (x - cam.x) * cam.z, cy - (y - cam.y) * cam.z];
  }
  function toWorld(px, py) {
    const s = safeRect(), cx = (s.l + s.r) / 2, cy = (s.t + s.b) / 2;
    return [cam.x + (px - cx) / cam.z, cam.y - (py - cy) / cam.z];
  }

  // ---------------------------------------------------------------- static geometry (Path2D in world metres)
  const P = { };
  function polyPath(list, scale) {
    const p = new Path2D();
    list.forEach((a) => { p.moveTo(a[0] * scale, a[1] * scale); for (let k = 2; k < a.length; k += 2) p.lineTo(a[k] * scale, a[k + 1] * scale); p.closePath(); });
    return p;
  }
  P.buildings = polyPath(D.buildings, 0.5); P.parks = polyPath(D.parks, 0.5); P.water = polyPath(D.water, 0.5);
  P.roads = new Path2D(); P.junc = new Path2D(); P.edge = []; P.main = new Path2D(); P.nodes = new Path2D();
  E.forEach((e) => {
    const pe = new Path2D();
    e.lanes.forEach((l) => { pe.moveTo(l.pts[0], l.pts[1]); for (let k = 2; k < l.pts.length; k += 2) pe.lineTo(l.pts[k], l.pts[k + 1]); });
    P.edge.push(pe); P.roads.addPath(pe);
  });
  const seenNode = new Set();
  E.forEach((e) => {
    e.nx.forEach((t) => {
      const B = E[t[0]];
      for (let la = 0; la < e.n; la++) if ((t[1] >> la) & 1) {
        const c = TS.connector(net, e, B, la, Math.min(la, B.n - 1));
        if (c.pts) { P.junc.moveTo(c.pts[0], c.pts[1]); for (let k = 2; k < c.pts.length; k += 2) P.junc.lineTo(c.pts[k], c.pts[k + 1]); }
      }
    });
    if (!seenNode.has(e.node)) { seenNode.add(e.node); P.nodes.moveTo(e.j[0] + 3.4, e.j[1]); P.nodes.arc(e.j[0], e.j[1], 3.4, 0, 6.2832); }
  });
  D.routes.main.forEach((i, k) => { const l = E[i].lanes[0]; P.main.moveTo(l.pts[0], l.pts[1]); for (let q = 2; q < l.pts.length; q += 2) P.main.lineTo(l.pts[q], l.pts[q + 1]); if (k + 1 < D.routes.main.length) { const c = TS.connector(net, E[i], E[D.routes.main[k + 1]], 0, 0); if (c.pts) for (let q = 2; q < c.pts.length; q += 2) P.main.lineTo(c.pts[q], c.pts[q + 1]); } });
  // signal heads: one bar at the end of each controlled lane
  const heads = [];
  E.forEach((e) => e.nx.forEach((t) => {
    if (t[2] < 0) return;
    for (let l = 0; l < e.n; l++) if ((t[1] >> l) & 1) {
      const p = e.lanes[l].pts, n = p.length, x = p[n - 2], y = p[n - 1], dx = x - p[n - 4], dy = y - p[n - 3], d = Math.hypot(dx, dy) || 1;
      heads.push({ x, y, nx: -dy / d, ny: dx / d, tl: t[2], link: t[3] });
    }
  }));
  const closedPath = (id, lane) => { const e = E[net.byId.get(id)], p = e.lanes[lane].pts, path = new Path2D(); path.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) path.lineTo(p[k], p[k + 1]); return path; };
  const worksEdge = net.byId.get('436872467#0'), accEdge = net.byId.get('436872460');
  P.works = closedPath('436872467#0', 0);

  // ---------------------------------------------------------------- colours
  const heatStops = [[0, [239, 68, 68, .85]], [0.3, [249, 115, 22, .7]], [0.55, [251, 191, 36, .5]], [0.8, [52, 211, 153, .32]], [1, [34, 211, 238, .30]]];
  function heat(r) {
    r = clamp(r, 0, 1);
    for (let i = 1; i < heatStops.length; i++) if (r <= heatStops[i][0]) {
      const a = heatStops[i - 1], b = heatStops[i], t = (r - a[0]) / (b[0] - a[0]);
      return 'rgba(' + [0, 1, 2].map((k) => Math.round(lerp(a[1][k], b[1][k], t))).join(',') + ',' + lerp(a[1][3], b[1][3], t).toFixed(2) + ')';
    }
    return 'rgba(34,211,238,.3)';
  }
  const SIG = { G: '#34d399', g: '#34d399', y: '#fbbf24', Y: '#fbbf24', r: '#fb7185', R: '#fb7185', s: '#fb7185', u: '#fbbf24', o: '#64748b', O: '#64748b' };

  // ---------------------------------------------------------------- simulation management
  const con = $('#con');
  function pushLog(m) {
    const d = document.createElement('div'); d.className = 'l k-' + m.kind;
    d.innerHTML = '<b>' + String(Math.floor(m.t)).padStart(4, '0') + '</b>' + m.msg.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    con.appendChild(d); while (con.childElementCount > 70) con.removeChild(con.firstChild);
    con.scrollTop = con.scrollHeight;
  }
  function newSim(opts) {
    opts = opts || {};
    con.innerHTML = ''; pulses = []; lastForced = 0; S.selected = null; hideInfo();
    sim = new Sim(D, { scenario: S.scenario, seed: S.seed, greenWave: S.gw, dynGps: S.gps, rain: S.rain, ambient: S.ambient ? 1200 : 0, onLog: pushLog });
    sim.run(opts.warm == null ? 150 : opts.warm);
    acc = 0; prime();
    $('#amb-final').classList.add('hidden');
    updateHud(true);
  }
  function prime() { if (!sim) return; snap(0); snap(1); }
  function snap(which) {
    const vs = sim.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i], p = sim.place(v);
      if (which === 0) { v.ox = p[0]; v.oy = p[1]; v.oa = p[2]; v.pv = v.v; }
      else {
        v.px = p[0]; v.py = p[1]; v.pa = p[2];
        if (v.ox === undefined) { v.ox = p[0]; v.oy = p[1]; v.oa = p[2]; v.pv = v.v; }
      }
    }
  }
  function advance(dtReal) {
    acc += dtReal * S.speed;
    const t0 = performance.now();
    let ran = false;
    while (acc >= DT && performance.now() - t0 < 12) {
      acc -= DT;
      if (acc < DT) snap(0);
      sim.tick(); ran = true;
    }
    if (ran) snap(1);
    if (acc > DT * 8) acc = acc % DT;
  }
  function fastForward() {
    const t0 = performance.now();
    while (sim.t < S.ff.target && performance.now() - t0 < 28) sim.tick();
    const pct = clamp((sim.t - S.ff.from) / Math.max(1, S.ff.target - S.ff.from), 0, 1);
    $('#ff-b').style.width = (pct * 100).toFixed(0) + '%'; $('#ff-t').textContent = 'Προσομοίωση… step ' + Math.round(sim.t) + ' / ' + Math.round(S.ff.target);
    if (sim.t >= S.ff.target) { const cb = S.ff.done; S.ff = null; $('#ffbar').classList.add('hidden'); acc = 0; prime(); if (cb) cb(); }
  }
  function ffTo(target, done) {
    if (sim.t > target) newSim({ warm: 0 });
    S.ff = { target, from: sim.t, done }; $('#ffbar').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- render
  const rrect = ctx.roundRect ? (x, y, w, h, r) => ctx.roundRect(x, y, w, h, r) : (x, y, w, h) => ctx.rect(x, y, w, h);
  function render(now) {
    const z = cam.z, tsec = now / 1000;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#060a13'; ctx.fillRect(0, 0, W, H);
    const s = safeRect(), cx = (s.l + s.r) / 2, cy = (s.t + s.b) / 2;
    // soft glow behind the map
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(18,30,56,.55)'); g.addColorStop(1, 'rgba(6,10,19,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.setTransform(DPR * z, 0, 0, -DPR * z, DPR * (cx - cam.x * z), DPR * (cy + cam.y * z));
    const px = 1 / z;                                   // one screen pixel in metres
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // ---- backdrop
    ctx.fillStyle = 'rgba(37,99,235,.16)'; ctx.fill(P.water);
    ctx.fillStyle = 'rgba(16,185,129,.09)'; ctx.fill(P.parks);
    ctx.save(); ctx.translate(1.6, -1.6); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(P.buildings); ctx.restore();
    ctx.fillStyle = '#0b1328'; ctx.fill(P.buildings);
    ctx.lineWidth = Math.max(.35, .8 * px); ctx.strokeStyle = 'rgba(70,100,160,.22)'; ctx.stroke(P.buildings);

    // ---- corridor glow
    ctx.lineWidth = 22; ctx.strokeStyle = 'rgba(34,211,238,.05)'; ctx.stroke(P.main);
    ctx.lineWidth = 11; ctx.strokeStyle = 'rgba(34,211,238,.08)'; ctx.stroke(P.main);

    // ---- roads
    const laneW = Math.max(3.0, 2.3 * px);
    ctx.lineCap = 'butt';
    ctx.lineWidth = laneW + Math.max(1.1, 1.5 * px); ctx.strokeStyle = '#33476e'; ctx.stroke(P.roads); ctx.stroke(P.junc);
    ctx.fillStyle = '#33476e'; ctx.beginPath(); ctx.fill(P.nodes);
    ctx.lineWidth = laneW; ctx.strokeStyle = '#0f182d'; ctx.stroke(P.roads); ctx.stroke(P.junc);
    ctx.fillStyle = '#0f182d'; ctx.fill(P.nodes);
    if (S.heat && sim) {
      ctx.lineWidth = laneW * 0.86;
      const es = sim.edgeSpeed, ec = sim.edgeCount;
      for (let i = 0; i < E.length; i++) {
        if (ec[i] === 0 && es[i] < 0) continue;
        const r = es[i] < 0 ? 1 : es[i] / (E[i].v * 0.85);
        if (ec[i] === 0 && r > 0.85) continue;
        ctx.strokeStyle = heat(r); ctx.stroke(P.edge[i]);
      }
    }
    ctx.lineCap = 'round';
    // lane dashes at close zoom
    if (z > 2.2) { ctx.setLineDash([2.2, 3.4]); ctx.lineWidth = .16; ctx.strokeStyle = 'rgba(203,213,225,.22)'; for (let i = 0; i < E.length; i++) if (E[i].n > 1) { ctx.stroke(P.edge[i]); } ctx.setLineDash([]); }

    // ---- scenario markings
    if (sim && sim.closed.size) {
      ctx.lineCap = 'butt'; ctx.lineWidth = laneW; ctx.strokeStyle = 'rgba(249,115,22,.5)'; ctx.stroke(P.works);
      ctx.setLineDash([3, 3]); ctx.lineWidth = laneW * .6; ctx.strokeStyle = 'rgba(15,23,42,.9)'; ctx.stroke(P.works); ctx.setLineDash([]); ctx.lineCap = 'round';
    }

    // ---- signal heads
    if (sim) {
      for (let i = 0; i < heads.length; i++) {
        const h = heads[i], ch = sim.linkChar(h.tl, h.link), col = SIG[ch] || '#64748b';
        ctx.strokeStyle = col; ctx.lineWidth = .95; ctx.shadowColor = col; ctx.shadowBlur = z > .6 ? 10 : 0;
        ctx.beginPath(); ctx.moveTo(h.x + h.nx * 1.5, h.y + h.ny * 1.5); ctx.lineTo(h.x - h.nx * 1.5, h.y - h.ny * 1.5); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // ---- ambulance route ahead + radius
    const amb = sim && sim.ambulance;
    if (amb) {
      const p = new Path2D(); let first = true;
      for (let k = amb.ri; k < amb.route.length; k++) {
        const l = E[amb.route[k]].lanes[Math.min(k === amb.ri ? amb.lane : 0, E[amb.route[k]].n - 1)].pts;
        for (let q = 0; q < l.length; q += 2) { if (first) { p.moveTo(l[q], l[q + 1]); first = false; } else p.lineTo(l[q], l[q + 1]); }
      }
      ctx.lineWidth = 2.2 * Math.max(1, px * 1.4); ctx.strokeStyle = 'rgba(251,113,133,.9)'; ctx.setLineDash([7 * Math.max(1, px * 1.4), 6 * Math.max(1, px * 1.4)]); ctx.lineDashOffset = -tsec * 26 * Math.max(1, px * 1.4);
      ctx.shadowColor = '#fb7185'; ctx.shadowBlur = 8; ctx.stroke(p); ctx.setLineDash([]); ctx.shadowBlur = 0;
    }

    // ---- vehicles
    if (sim) drawVehicles(tsec);

    // ---- screen-space overlays
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawOverlays(tsec, amb);
  }

  function drawVehicles(tsec) {
    const z = cam.z, alpha = clamp(acc / DT, 0, 1);
    const vis = (len) => Math.max(1, 7.5 / (len * z));
    const vs = sim.vehicles;
    const flash = Math.floor(tsec * 4) % 2;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]; if (v.px === undefined) continue;
      let x = lerp(v.ox, v.px, alpha), y = lerp(v.oy, v.py, alpha);
      let da = v.pa - v.oa; if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      const a = v.oa + da * alpha;
      v._sx = x; v._sy = y;
      const T = TYPES[v.type], m = vis(v.len), L = v.len * m, Wd = v.w * Math.max(1, m * 0.78);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      let col = v.color || T.col;
      if (v.type === 'ambulance_type') col = '#f8fafc';
      // headlights
      if (z > 1.1 && v.v > 0.5) {
        const gr = ctx.createLinearGradient(L / 2, 0, L / 2 + 9, 0); gr.addColorStop(0, 'rgba(253,230,138,.22)'); gr.addColorStop(1, 'rgba(253,230,138,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(L / 2, -Wd * .35); ctx.lineTo(L / 2 + 9, -Wd * 1.1); ctx.lineTo(L / 2 + 9, Wd * 1.1); ctx.lineTo(L / 2, Wd * .35); ctx.fill();
      }
      ctx.fillStyle = col; ctx.beginPath(); rrect(-L / 2, -Wd / 2, L, Wd, Math.min(Wd * .35, L * .3)); ctx.fill();
      if (v.type !== 'freight_truck' && L > 3) { ctx.fillStyle = 'rgba(2,6,14,.55)'; ctx.fillRect(L * .1, -Wd * .36, L * .2, Wd * .72); }
      if (v.type === 'freight_truck') { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(-L / 2, -Wd / 2, L * .72, Wd); }
      // brake lights
      if (v.pv !== undefined && (v.pv - v.v > 0.08 || (v.v < 0.2 && v.wait > 0))) { ctx.fillStyle = '#ff2d4d'; ctx.shadowColor = '#ff2d4d'; ctx.shadowBlur = 6; ctx.fillRect(-L / 2 - .15, -Wd * .42, .5 * m, Wd * .84); ctx.shadowBlur = 0; }
      ctx.restore();
      if (v.type === 'ambulance_type') {
        ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter';
        const rr = 26 / z * 1.0 + 4, g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
        g.addColorStop(0, flash ? 'rgba(239,68,68,.75)' : 'rgba(59,130,246,.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr, 0, 6.2832); ctx.fill(); ctx.restore();
      } else if (v.alarm) {
        if (flash) { ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter'; const rr = 14 / z + 2, g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr); g.addColorStop(0, 'rgba(251,191,36,.9)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr, 0, 6.2832); ctx.fill(); ctx.restore(); }
      } else if (v.reroutedAt && sim.t - v.reroutedAt < 3 && v.smart) {
        ctx.strokeStyle = 'rgba(167,139,250,.85)'; ctx.lineWidth = 1.2 / z; ctx.beginPath(); ctx.arc(x, y, (7 + (sim.t - v.reroutedAt) * 5) / z, 0, 6.2832); ctx.stroke();
      }
    }
    // selection ring
    if (S.selected && sim.vehicles.indexOf(S.selected) >= 0 && S.selected._sx !== undefined) {
      const v = S.selected; ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5 / z; ctx.beginPath(); ctx.arc(v._sx, v._sy, 9 / z, 0, 6.2832); ctx.stroke();
    }
  }

  function drawOverlays(tsec, amb) {
    const z = cam.z;
    ctx.font = '600 10.5px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    // traffic-light labels + forced pulses
    if (sim) {
      D.tls.forEach((T, i) => {
        const [sx, sy] = toScreen(T.x, T.y); if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) return;
        const forced = sim.tlsOverride.has(i);
        if (z > 0.55) {
          ctx.strokeStyle = forced ? 'rgba(52,211,153,.9)' : 'rgba(148,163,184,.35)'; ctx.lineWidth = forced ? 2 : 1;
          ctx.beginPath(); ctx.arc(sx, sy, 15 + (forced ? Math.sin(tsec * 6) * 2 : 0), 0, 6.2832); ctx.stroke();
        }
        if (z > 0.9) { ctx.fillStyle = forced ? '#6ee7b7' : '#94a3b8'; ctx.fillText((forced ? '★ ' : '') + 'TL ' + (i + 1), sx + 19, sy - 14); }
      });
      // pulses
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i], age = (performance.now() - p.t0) / 1400; if (age > 1) { pulses.splice(i, 1); continue; }
        const [sx, sy] = toScreen(p.x, p.y); ctx.strokeStyle = 'rgba(52,211,153,' + (1 - age).toFixed(2) + ')'; ctx.lineWidth = 3 * (1 - age) + .5;
        ctx.beginPath(); ctx.arc(sx, sy, 14 + age * 90, 0, 6.2832); ctx.stroke();
      }
      // works + accident labels
      if (sim.closed.size) {
        const l = E[worksEdge].lanes[0], mid = TS.posOnPoly(l.pts, l.cum, l.len * .5), [sx, sy] = toScreen(mid[0], mid[1]);
        drawTag(sx, sy - 26, 'ΕΡΓΑ · λωρίδα κλειστή', '#fb923c');
      }
      if (sim.obstacle && sim.vehicles.indexOf(sim.obstacle) >= 0) { const o = sim.obstacle; if (o._sx !== undefined) { const [sx, sy] = toScreen(o._sx, o._sy); drawTag(sx, sy - 24, 'ΑΤΥΧΗΜΑ', '#fb7185'); } }
      // bus stop
      if (z > 1.4 && D.stops.length) { const st = D.stops[0], e = E[st.e], p = TS.posOnPoly(e.lanes[st.lane].pts, e.lanes[st.lane].cum, (st.a + st.b) / 2), [sx, sy] = toScreen(p[0], p[1]); drawTag(sx, sy - 16, '🚌 bs_0', '#4ade80'); }
    }
    // ambulance ring + label
    if (amb && amb._sx !== undefined) {
      const [sx, sy] = toScreen(amb._sx, amb._sy);
      const rad = 400 * z;
      if (S.gw) {
        ctx.save(); ctx.strokeStyle = 'rgba(52,211,153,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -tsec * 12;
        ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
        const g = ctx.createRadialGradient(sx, sy, rad * .6, sx, sy, rad); g.addColorStop(0, 'rgba(52,211,153,0)'); g.addColorStop(1, 'rgba(52,211,153,.07)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(110,231,183,.85)'; ctx.font = '600 10px "JetBrains Mono"'; ctx.textAlign = 'center'; ctx.fillText('GREEN-WAVE RADIUS · 400 m', sx, sy - rad - 10 > 12 ? sy - rad - 10 : sy + rad + 12); ctx.textAlign = 'left'; ctx.restore();
      }
      drawTag(sx, sy - 22, 'AMBULANCE_01 · ' + Math.round(amb.v * 3.6) + ' km/h', '#fb7185', true);
    }
  }
  function drawTag(x, y, text, col, strong) {
    ctx.font = '600 10.5px "JetBrains Mono", monospace'; const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(8,12,22,.86)'; ctx.strokeStyle = col; ctx.lineWidth = strong ? 1.5 : 1;
    ctx.beginPath(); rrect(x - w / 2, y - 10, w, 20, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(text, x, y + .5); ctx.textAlign = 'left';
    ctx.beginPath(); ctx.moveTo(x - 4, y + 10); ctx.lineTo(x + 4, y + 10); ctx.lineTo(x, y + 15); ctx.closePath(); ctx.fillStyle = 'rgba(8,12,22,.86)'; ctx.fill(); ctx.strokeStyle = col; ctx.stroke();
  }

  // ---------------------------------------------------------------- HUD
  const el = (id) => document.getElementById(id);
  const mVeh = el('m-veh'), mStop = el('m-stop'), mDelay = el('m-delay'), mSpeed = el('m-speed'), mStep = el('m-step'), mClock = el('m-clock');
  const tlsList = el('tls-list'), drvList = el('drv-list');
  const fmtT = (s) => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const spark = (c, series, defs, opt) => {
    const d = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    const n = series.length; if (n < 2) return;
    let max = opt && opt.max ? opt.max : 1; defs.forEach((df) => series.forEach((s) => { max = Math.max(max, s[df.k]); })); max *= 1.12;
    g.strokeStyle = 'rgba(148,163,184,.1)'; g.lineWidth = 1; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, h * i / 4); g.lineTo(w, h * i / 4); g.stroke(); }
    defs.forEach((df) => {
      g.beginPath(); series.forEach((s, i) => { const x = i / (n - 1) * w, y = h - 3 - (s[df.k] / max) * (h - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = df.c; g.lineWidth = 1.7; g.lineJoin = 'round'; g.stroke();
      if (df.fill) { g.lineTo(w, h); g.lineTo(0, h); g.closePath(); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, df.c + '44'); gr.addColorStop(1, df.c + '00'); g.fillStyle = gr; g.fill(); }
    });
  };
  let tlsBuilt = false;
  function buildTls() {
    tlsList.innerHTML = D.tls.map((T, i) => '<div class="flex items-center justify-between gap-2 rounded-lg bg-slate-950/50 border hair px-2.5 py-1.5"><span class="mono text-[11px] text-slate-300 w-9">TL ' + (i + 1) + '</span><span class="flex gap-[2px] flex-wrap justify-end flex-1" id="tl-s' + i + '"></span><span class="w-3 text-em text-[11px]" id="tl-f' + i + '"></span></div>').join('');
    drvList.innerHTML = TEMPERAMENTS.map((t, i) => '<div><div class="flex justify-between text-[11.5px] mb-1"><span class="text-slate-300"><i class="dot mr-1.5" style="background:' + t.col + '"></i>' + t.name + '</span><span class="mono text-slate-500">sf ' + t.sf.toFixed(2) + ' · τ ' + t.tau.toFixed(2) + '</span></div><div class="bar"><i id="drv-b' + i + '" style="width:0;background:' + t.col + '"></i></div></div>').join('');
    el('legend').innerHTML = [['#facc15', 'normal_car'], ['#38bdf8', 'smart_car (GPS)'], ['#f8fafc', 'ambulance'], ['#22c55e', 'λεωφορείο'], ['#a16207', 'φορτηγό'], ['#94a3b8', 'ambient trips'], ['#34d399', 'πράσινο'], ['#fb7185', 'κόκκινο / ταμπέλες']].map((a) => '<div class="flex items-center gap-2"><i class="dot" style="background:' + a[0] + ';box-shadow:0 0 8px ' + a[0] + '66"></i>' + a[1] + '</div>').join('') +
      '<div class="col-span-2 mt-1 text-[11px] text-slate-500 leading-snug">Χρώμα δρόμου: <span class="text-cyan-300">γαλάζιο</span> ελεύθερο → <span class="text-amber-300">πορτοκαλί</span> → <span class="text-rose-400">κόκκινο</span> συμφόρηση (heatmap).</div>';
    tlsBuilt = true;
  }
  let hudT = 0;
  function updateHud(force) {
    const now = performance.now(); if (!force && now - hudT < 120) return; hudT = now;
    if (!tlsBuilt) buildTls();
    const vs = sim.vehicles; let stopped = 0, delay = 0, sp = 0; const cnt = [0, 0, 0, 0, 0];
    for (let i = 0; i < vs.length; i++) { const v = vs[i]; if (v.v < 0.1 && !v.forceStop) { stopped++; delay += v.wait; } sp += v.v; const k = TEMPERAMENTS.indexOf(v.temp); if (k >= 0) cnt[k]++; }
    mVeh.textContent = vs.length; mStop.innerHTML = stopped + '<span class="u">οχ.</span>'; mDelay.innerHTML = Math.round(delay).toLocaleString('el-GR') + '<span class="u">s</span>';
    mSpeed.innerHTML = (vs.length ? Math.round(sp / vs.length * 3.6) : 0) + '<span class="u">km/h</span>';
    mStep.textContent = 'STEP ' + Math.floor(sim.t); mClock.textContent = fmtT(sim.t);
    spark(el('ch-main'), sim.stats.series, [{ k: 'n', c: '#22d3ee', fill: true }, { k: 'stopped', c: '#fb7185', fill: true }]);
    // ambulance
    const info = sim.ambInfo(), st = el('amb-status');
    if (info) {
      st.textContent = 'εν κινήσει'; st.className = 'text-[11px] mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300';
      el('amb-el').textContent = Math.round(info.el) + ' s'; el('amb-rem').textContent = Math.round(info.rem) + ' m'; el('amb-v').textContent = Math.round(info.v * 3.6) + ' km/h';
      if (!sim.amb.rem0) sim.amb.rem0 = info.rem; el('amb-bar').style.width = clamp((1 - info.rem / sim.amb.rem0) * 100, 0, 100).toFixed(0) + '%';
      el('amb-next').textContent = info.next ? 'TL ' + (info.next[0] + 1) + ' · ' + Math.round(info.next[2]) + ' m' : '—';
    } else if (sim.amb.end > 0) {
      st.textContent = 'έφτασε'; st.className = 'text-[11px] mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300';
      el('amb-el').textContent = Math.round(sim.amb.total) + ' s'; el('amb-rem').textContent = '0 m'; el('amb-v').textContent = '—'; el('amb-bar').style.width = '100%'; el('amb-next').textContent = '—';
      const f = el('amb-final'); f.classList.remove('hidden'); f.innerHTML = '<b>Τερματισμός σε ' + Math.round(sim.amb.total) + ' s</b> · step ' + Math.round(sim.amb.end) + (S.gw ? ' · ' + sim.amb.forced.length + ' forced green' : ' · χωρίς Green Wave');
    } else {
      st.textContent = sim.t < 1900 ? 'αναμονή step 1900' : 'εισαγωγή…'; st.className = 'text-[11px] mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400';
      el('amb-el').textContent = '—'; el('amb-rem').textContent = '—'; el('amb-v').textContent = '—'; el('amb-bar').style.width = '0%'; el('amb-next').textContent = '—';
    }
    el('amb-forced').textContent = sim.amb.forced.length; el('amb-rr').textContent = sim.amb.reroutes;
    // pulses on new forced greens
    if (sim.amb.forced.length > lastForced) { for (let i = lastForced; i < sim.amb.forced.length; i++) { const f = sim.amb.forced[i], T = D.tls[f.tls]; pulses.push({ x: T.x, y: T.y, t0: performance.now() }); } lastForced = sim.amb.forced.length; }
    // tabs
    if (S.tab === 'tls') {
      D.tls.forEach((T, i) => {
        const s = sim.tlsState(i), h = el('tl-s' + i); if (!h) return;
        if (h._s !== s) { h._s = s; h.innerHTML = s.split('').map((c) => '<i style="width:5px;height:11px;border-radius:2px;display:inline-block;background:' + (SIG[c] || '#475569') + '"></i>').join(''); }
        el('tl-f' + i).textContent = sim.tlsOverride.has(i) ? '★' : '';
      });
    } else if (S.tab === 'det') {
      const d = sim.det; if (d.length > 1) {
        const last = d[d.length - 1], i6 = Math.max(0, d.length - 7), a60 = last.a - d[i6].a, b60 = last.b - d[i6].b, delta = last.a - last.b;
        el('d-a').textContent = last.a; el('d-b').textContent = last.b; el('d-d').textContent = delta;
        const rel = d.map((x) => ({ a: x.a - d[0].a, b: x.b - d[0].b }));
        spark(el('ch-det'), rel, [{ k: 'a', c: '#22d3ee', fill: true }, { k: 'b', c: '#34d399' }]);
        const ratio = a60 > 4 ? b60 / a60 : null, al = el('d-alert');
        if (ratio === null) { al.textContent = 'B/A (60 s): — · ροή ομαλή'; al.className = 'mt-2 text-[11.5px] rounded-lg px-2.5 py-1.5 bg-slate-800/70 text-slate-400'; }
        else if (ratio < 0.15) { al.textContent = 'B/A (60 s): ' + Math.round(ratio * 100) + '% · ΑΠΟΚΛΕΙΣΜΟΣ — phase abort'; al.className = 'mt-2 text-[11.5px] rounded-lg px-2.5 py-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/40'; }
        else if (ratio < 0.5) { al.textContent = 'B/A (60 s): ' + Math.round(ratio * 100) + '% · συμφόρηση στο τμήμα'; al.className = 'mt-2 text-[11.5px] rounded-lg px-2.5 py-1.5 bg-amber-500/15 text-amber-300 border border-amber-500/30'; }
        else { al.textContent = 'B/A (60 s): ' + Math.round(ratio * 100) + '% · ροή ομαλή'; al.className = 'mt-2 text-[11.5px] rounded-lg px-2.5 py-1.5 bg-slate-800/70 text-slate-300'; }
      }
    } else if (S.tab === 'drv') {
      const tot = Math.max(1, cnt.reduce((a, b) => a + b, 0)); cnt.forEach((c, i) => { el('drv-b' + i).style.width = (c / tot * 100).toFixed(0) + '%'; });
    }
    if (S.selected) updateInfo();
  }

  // ---------------------------------------------------------------- vehicle inspector
  const info = document.createElement('div');
  info.id = 'vinfo'; info.className = 'glass hidden absolute z-20 px-3 py-2.5 text-[12px] pointer-events-none w-[212px]';
  cv.parentElement.appendChild(info);
  function hideInfo() { info.classList.add('hidden'); }
  function updateInfo() {
    const v = S.selected; if (!v || sim.vehicles.indexOf(v) < 0 || v._sx === undefined) { S.selected = null; hideInfo(); return; }
    const [sx, sy] = toScreen(v._sx, v._sy); const e = E[v.route[v.ri]];
    const lbl = { normal_car: 'Επιβατικό', smart_car: 'Smart car (GPS)', ambulance_type: 'Ασθενοφόρο', bus_type: 'Λεωφορείο', freight_truck: 'Φορτηγό', ambient: 'Ambient trip' }[v.type];
    info.innerHTML = '<div class="mono text-cy text-[11px] mb-1">' + v.id + '</div><div class="text-white font-semibold">' + lbl + '</div><div class="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-400"><span>Ταχύτητα</span><b class="text-slate-200 mono">' + Math.round(v.v * 3.6) + ' km/h</b><span>Αναμονή</span><b class="text-slate-200 mono">' + Math.round(v.wait) + ' s</b><span>Οδηγός</span><b class="text-slate-200">' + (v.temp.name || 'Έκτακτος') + '</b><span>Edge</span><b class="text-slate-200 mono truncate">' + e.id + '</b><span>Λωρίδα</span><b class="text-slate-200 mono">' + v.lane + '/' + e.n + '</b></div>';
    info.classList.remove('hidden');
    const r = cv.getBoundingClientRect(); info.style.left = clamp(sx + 16, 8, r.width - 224) + 'px'; info.style.top = clamp(sy - 40, 60, r.height - 140) + 'px';
  }

  // ---------------------------------------------------------------- input
  const ptrs = new Map(); let dragMoved = 0, pinch0 = 0;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragMoved = 0; cv.classList.add('drag'); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } });
  cv.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) { const dx = e.clientX - p.x, dy = e.clientY - p.y; dragMoved += Math.abs(dx) + Math.abs(dy); cam.x -= dx / cam.z; cam.y += dy / cam.z; cam.tx = cam.x; cam.ty = cam.y; if (dragMoved > 4 && S.follow) setFollow(false); fadeTitle(); }
    else if (ptrs.size === 2) { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch0); pinch0 = d; return; }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const endPtr = (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) cv.classList.remove('drag'); pinch0 = 0; };
  cv.addEventListener('pointerup', (e) => { if (dragMoved < 5) pick(e); endPtr(e); });
  cv.addEventListener('pointercancel', endPtr);
  function zoomAt(clientX, clientY, f) {
    const r = cv.getBoundingClientRect(), mx = clientX - r.left, my = clientY - r.top;
    const [wx, wy] = toWorld(mx, my); const nz = clamp(cam.z * f, 0.25, 14);
    cam.z = cam.tz = nz; const s = safeRect(), cx = (s.l + s.r) / 2, cy = (s.t + s.b) / 2;
    cam.x = cam.tx = wx - (mx - cx) / nz; cam.y = cam.ty = wy + (my - cy) / nz; fadeTitle();
  }
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0014))); }, { passive: false });
  cv.addEventListener('dblclick', () => { setFollow(false); fitCorridor(false); });
  function pick(e) {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = 16 * 16;
    sim.vehicles.forEach((v) => { if (v._sx === undefined) return; const [sx, sy] = toScreen(v._sx, v._sy), d = (sx - mx) * (sx - mx) + (sy - my) * (sy - my); if (d < bd) { bd = d; best = v; } });
    S.selected = best; if (!best) hideInfo(); else updateInfo();
  }
  function fadeTitle(o) { el('title').style.opacity = o == null ? '.22' : o; }
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName) && heroVisible) { e.preventDefault(); setPlaying(!S.playing); } });

  // ---------------------------------------------------------------- controls
  function setPlaying(p) { S.playing = p; el('ic-pause').classList.toggle('hidden', !p); el('ic-play').classList.toggle('hidden', p); }
  function setSpeed(v) { S.speed = v; $$('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === v)); }
  function setScenario(id, keepSim) {
    S.scenario = id; $$('#scs .chip').forEach((c) => c.classList.toggle('on', c.dataset.sc === id)); if (!keepSim) newSim();
  }
  function setFollow(on) { S.follow = on; el('t-follow').classList.toggle('on', on); }
  function setSwitch(id, key, on) { S[key] = on; el(id).classList.toggle('on', on); }
  $$('#speeds button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  $$('#scs .chip').forEach((c) => c.addEventListener('click', () => { stopTour(); setScenario(c.dataset.sc); }));
  el('btn-play').addEventListener('click', () => setPlaying(!S.playing));
  el('btn-reset').addEventListener('click', (e) => { stopTour(); fadeTitle(1); if (e.shiftKey) S.seed = (Math.random() * 1e6) | 0; newSim(); });
  el('t-gw').addEventListener('click', () => { setSwitch('t-gw', 'gw', !S.gw); sim.greenWave = S.gw; if (!S.gw && sim.activeTls !== null) { sim.tlsOverride.delete(sim.activeTls); sim.activeTls = null; } });
  el('t-gps').addEventListener('click', () => { setSwitch('t-gps', 'gps', !S.gps); sim.dynGps = S.gps; if (sim.ambulance) sim.ambulance.smart = S.gps; });
  el('t-rain').addEventListener('click', () => { setSwitch('t-rain', 'rain', !S.rain); sim.rain = S.rain; sim.emit(S.rain ? '[WEATHER] Βροχή: speed ×0.78, tau ×1.35 (TraCI setSpeed / setTau)' : '[WEATHER] Τέλος βροχής', 'warn'); });
  el('t-heat').addEventListener('click', () => setSwitch('t-heat', 'heat', !S.heat));
  el('t-follow').addEventListener('click', () => { setFollow(!S.follow); if (S.follow) { cam.tz = Math.max(cam.tz, 1.3); } });
  el('btn-ff').addEventListener('click', () => { stopTour(); goAmbulance(); });
  $$('#tabs .tab').forEach((t) => t.addEventListener('click', () => {
    S.tab = t.dataset.tab; $$('#tabs .tab').forEach((x) => x.classList.toggle('on', x === t));
    $$('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== S.tab)); updateHud(true);
  }));

  function goAmbulance(opts) {
    opts = opts || {}; fadeTitle(.15);
    ffTo(1888, () => { setPlaying(true); setSpeed(opts.speed || 6); setFollow(true); camTo(cam.x, cam.y, 1.3); });
  }

  // ---------------------------------------------------------------- guided tour
  const capEl = el('caption');
  function caption(k, t) { el('cap-k').textContent = k; el('cap-t').innerHTML = t; capEl.classList.remove('hide'); }
  function stopTour() { if (!tour) return; tour = null; capEl.classList.add('hide'); el('btn-tour').innerHTML = '<svg viewBox="0 0 20 20" class="w-4 h-4 fill-current"><path d="M6 4l11 6-11 6z"/></svg> Ξενάγηση'; }
  function startTour() {
    if (tour) { stopTour(); return; }
    S.scenario = 'S3'; setSwitch('t-gw', 'gw', true); setSwitch('t-gps', 'gps', false); setSwitch('t-rain', 'rain', false); setFollow(false);
    setScenario('S3', true); newSim({ warm: 0 }); setPlaying(true); setSpeed(60);
    fitBox({ x0: corridor.x0 - 80, y0: corridor.y0 - 80, x1: corridor.x1 + 80, y1: corridor.y1 + 80 }, 0.05, false);
    tour = { i: 0, fired: new Set() }; fadeTitle(.1);
    el('btn-tour').innerHTML = '■ Τέλος ξενάγησης';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    caption('STEP 0 · BASELINE', 'Σενάριο <b>S3</b>. Ρέουν <b>2.600 οχ./ώρα</b> στον κεντρικό άξονα και 3 γειτονιές. Κάθε όχημα έχει δική του <b>ψυχολογία οδηγού</b>.');
  }
  const TOUR = [
    { t: 420, run() { setSpeed(90); caption('ΖΩΝΤΑΝΗ ΣΥΜΦΟΡΗΣΗ', 'Το <b>heatmap</b> χρωματίζει τους δρόμους από γαλάζιο (ελεύθερο) σε κόκκινο. Τα φανάρια ακολουθούν τα προγράμματα του <span class="mono">osm.net.xml</span>.'); } },
    { t: 940, run() { setSpeed(10); const l = E[worksEdge].lanes[0], m = TS.posOnPoly(l.pts, l.cum, l.len * .5); camTo(m[0], m[1], 3.2); caption('STEP 1000 · ΕΡΓΑ', 'Το TraCI καλεί <span class="mono">setDisallowed("436872467#0_0", ["all"])</span>: η δεξιά λωρίδα κλείνει.'); } },
    { t: 1070, run() { setSpeed(40); fitBox({ x0: corridor.x0 - 80, y0: corridor.y0 - 80, x1: corridor.x1 + 80, y1: corridor.y1 + 80 }, 0.05, false); caption('ΑΠΟΤΕΛΕΣΜΑ', 'Μία λωρίδα αντί για δύο: η <b>ουρά</b> ξεχειλίζει προς τα πίσω και η συνολική καθυστέρηση εκτοξεύεται.'); } },
    { t: 1500, run() { setSpeed(120); caption('ΣΥΝΕΧΙΖΟΥΜΕ…', 'Το ασθενοφόρο θα μπει στο δίκτυο στο <b>step 1900</b>…'); } },
    { t: 1872, run() { setSpeed(8); setFollow(true); camTo(cam.x, cam.y, 1.25); caption('STEP 1900 · AMBULANCE_01', 'Μπαίνει στη διαδρομή. Κάθε δευτερόλεπτο το Python ρωτά <span class="mono">getNextTLS()</span> — δείτε τον <b class="text-em">πράσινο κύκλο 400 m</b>.'); } },
  ];
  function tourStep() {
    if (!tour) return;
    for (let k = 0; k < TOUR.length; k++) if (!tour.fired.has(k) && sim.t >= TOUR[k].t) { tour.fired.add(k); TOUR[k].run(); }
    if (!tour.gw && sim.amb.forced.length) { tour.gw = true; caption('GREEN WAVE', 'Το φανάρι αναγκάζεται σε <b class="text-em">πράσινο</b> μόνο για τη λωρίδα του ασθενοφόρου — δείτε την ένδειξη ★.'); }
    if (!tour.done && sim.amb.end > 0) {
      tour.done = true; setSpeed(5); caption('ΤΕΡΜΑΤΙΣΜΟΣ', 'Το ασθενοφόρο έφτασε σε <b>' + Math.round(sim.amb.total) + ' s</b>. Δοκίμασε να κλείσεις το <b>Green Wave</b> και να ξανατρέξεις — ή δες το Monte Carlo ↓');
      setTimeout(() => { if (tour && tour.done) stopTour(); }, 9000);
    }
  }
  el('btn-tour').addEventListener('click', startTour);

  // ---------------------------------------------------------------- main loop
  let last = performance.now(), frames = 0;
  function frame(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000); last = now; frames++;
    if (heroVisible && sim) {
      if (S.ff) fastForward();
      else if (S.playing) advance(dtReal);
      if (tour) tourStep();
      // camera
      if (S.follow && sim.ambulance && sim.ambulance._sx !== undefined) { cam.tx = sim.ambulance._sx; cam.ty = sim.ambulance._sy; }
      const k = reduceMotion ? 1 : 1 - Math.exp(-dtReal * 4.2);
      cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k; cam.z *= Math.pow(cam.tz / cam.z, k);
      render(now);
      updateHud(false);
    }
    requestAnimationFrame(frame);
  }
  new IntersectionObserver((en) => { heroVisible = en[0].isIntersecting; if (heroVisible) last = performance.now(); }, { threshold: 0.02 }).observe(el('sim'));
  window.addEventListener('resize', () => { resize(); });
  let rz = 0; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(resize, 60); }).observe(cv.parentElement);

  // ---------------------------------------------------------------- public API (used by site.js)
  window.Hero = {
    S, get sim() { return sim; },
    setScenario(id) { stopTour(); setScenario(id); },
    goAmbulance(o) { stopTour(); goAmbulance(o); },
    run(id, o) {                       // convenience for the code walkthrough
      stopTour(); o = o || {}; if (o.ff || o.focus || o.follow) fadeTitle(.15);
      if (o.scenario) setScenario(o.scenario, true);
      if (o.gw != null) { setSwitch('t-gw', 'gw', o.gw); }
      if (o.gps != null) { setSwitch('t-gps', 'gps', o.gps); }
      newSim({ warm: 0 }); setPlaying(true); setFollow(false);
      if (o.speed) setSpeed(o.speed);
      if (o.ff) ffTo(o.ff, () => { if (o.follow) { setFollow(true); camTo(cam.x, cam.y, 1.3); } if (o.focus) focus(o.focus, o.zoom); setSpeed(o.after || 6); });
      else if (o.focus) focus(o.focus, o.zoom);
      if (o.tab) { $$('#tabs .tab').forEach((t) => { if (t.dataset.tab === o.tab) t.click(); }); }
    },
    focus,
    tour: startTour,
  };
  function focus(edgeId, zoom) { const i = net.byId.get(edgeId); if (i == null) return; const l = E[i].lanes[0], m = TS.posOnPoly(l.pts, l.cum, l.len * .5); setFollow(false); camTo(m[0], m[1], zoom || 3); }

  // ---------------------------------------------------------------- boot
  resize(); fitCorridor(true);
  newSim();
  setSpeed(15); setPlaying(!reduceMotion);
  requestAnimationFrame(frame);
})();
