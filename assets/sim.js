/* =====================================================================
 *  sim.js  --  micro-simulator that mirrors the SUMO + TraCI setup of this repo
 *
 *  It runs on the REAL network (osm.net.xml -> assets/data.js) and re-implements,
 *  in the browser, the logic of the Python file `code`:
 *    - flows of osm.rou.xml  (main_stubborn / main_smart / bg_traffic_1..3 / city_bus / trucks_main)
 *    - scenarios S0..S3  (scale, accident on edge 436872460, lane closure 436872467#0_0)
 *    - AMBULANCE_01 departing at step 1900 + dynamic GREEN WAVE through TraCI-like calls
 *    - Krauss-like car following, lane changing, priority junctions, traffic-light programs
 *
 *  It is a visual re-implementation, NOT the SUMO engine: numbers are indicative.
 * ===================================================================== */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ seeded RNG
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ vehicle types (osm.rou.xml)
  // MC-temperament: five driver groups (README WP2/WP3) -> speedFactor, accel, decel, tau, sigma
  const TEMPERAMENTS = [
    { name: 'Ήρεμος',       sf: 0.90, a: 1.9, b: 3.4, tau: 1.55, sig: 0.25, col: '#5eead4' },
    { name: 'Συντηρητικός', sf: 0.97, a: 2.3, b: 3.8, tau: 1.30, sig: 0.35, col: '#93c5fd' },
    { name: 'Κανονικός',    sf: 1.02, a: 2.6, b: 4.5, tau: 1.10, sig: 0.50, col: '#fde047' },
    { name: 'Βιαστικός',    sf: 1.10, a: 3.1, b: 4.8, tau: 0.90, sig: 0.60, col: '#fdba74' },
    { name: 'Επιθετικός',   sf: 1.18, a: 3.6, b: 5.2, tau: 0.75, sig: 0.70, col: '#fb7185' },
  ];
  const TYPES = {
    normal_car: { len: 4.6, w: 1.9, col: '#facc15', maxV: 40, a: 2.6, b: 4.5 },
    smart_car:  { len: 4.4, w: 1.9, col: '#38bdf8', maxV: 40, a: 2.6, b: 4.5 },
    freight_truck: { len: 12, w: 2.5, col: '#a16207', maxV: 15, a: 0.8, b: 2.5 },       // vType freight_truck
    bus_type:   { len: 12, w: 2.6, col: '#22c55e', maxV: 27, a: 1.2, b: 4.0 },
    ambulance_type: { len: 6.2, w: 2.2, col: '#ef4444', maxV: 45, a: 3.6, b: 5.5 },
    ambient:    { len: 4.5, w: 1.9, col: '#94a3b8', maxV: 40, a: 2.6, b: 4.5 },
  };

  // ------------------------------------------------------------------ scenarios (exact numbers of `code`)
  const SCENARIOS = {
    S0: { id: 'S0', name: 'Baseline off-peak', scale: 0.6, teleport: -1, desc: 'Κανονική κίνηση (scale 0.6) – χωρίς διαταραχή.' },
    S1: { id: 'S1', name: 'Αυξημένη κίνηση',   scale: 0.9, teleport: -1, desc: 'Scale 0.9 – περισσότερα οχήματα στον ίδιο δρόμο.' },
    S2: { id: 'S2', name: 'Ατύχημα',            scale: 0.8, teleport: -1, desc: 'Step 1000: ακινητοποιείται όχημα στην edge 436872460.' },
    S3: { id: 'S3', name: 'Έργα (1 λωρίδα)',    scale: 0.8, teleport: 150, desc: 'Step 1000: κλείνει η λωρίδα 436872467#0_0 (setDisallowed).' },
  };

  const DT = 0.5;              // simulation tick (s)
  const MINGAP = 2.2;
  const KMH = 3.6;

  // ------------------------------------------------------------------ helpers
  function polyLen(p) { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; }
  function cumul(p) { const c = [0]; for (let i = 2; i < p.length; i += 2) c.push(c[c.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])); return c; }

  // MinHeap for Dijkstra
  class Heap {
    constructor() { this.a = []; }
    push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
    get size() { return this.a.length; }
  }

  // ------------------------------------------------------------------ static network (shared between runs)
  function buildNet(D) {
    if (D._net) return D._net;
    const E = D.edges.map((e, i) => {
      const lanes = e.s.map((s) => { const c = cumul(s); return { pts: s, cum: c, len: c[c.length - 1] }; });
      return { i, id: e.id, n: e.n, v: e.v, prio: e.p, lanes, len: lanes[0].len, j: e.j, f: e.f, nx: e.nx, ty: e.ty };
    });
    // successors lookup + rivals (higher priority approaches to the same node)
    const byNode = new Map();
    E.forEach((e) => { const k = e.j[0] + ',' + e.j[1]; if (!byNode.has(k)) byNode.set(k, []); byNode.get(k).push(e); e.node = k; });
    E.forEach((e) => {
      e.hasTl = e.nx.some((t) => t[2] >= 0);
      e.rivals = hasTlNode(byNode.get(e.node)) ? [] : byNode.get(e.node).filter((o) => o !== e && o.prio > e.prio).map((o) => o.i);
      e.nxMap = new Map(); e.nx.forEach((t) => e.nxMap.set(t[0], t));
    });
    function hasTlNode(list) { return list.some((o) => o.hasTl); }
    const idIndex = new Map(E.map((e) => [e.id, e.i]));
    const net = { E, byId: idIndex, tls: D.tls, stops: D.stops, routes: D.routes, ambient: D.ambient, conn: new Map() };
    D._net = net; return net;
  }

  // connector (junction box) polyline between lane k of A and lane k' of B -> quadratic Bezier
  function connector(net, A, B, la, lb) {
    const key = ((A.i * 4096 + B.i) * 4 + la) * 4 + lb;
    let c = net.conn.get(key);
    if (c) return c;
    const pa = A.lanes[la].pts, pb = B.lanes[lb].pts;
    const x0 = pa[pa.length - 2], y0 = pa[pa.length - 1], x2 = pb[0], y2 = pb[1];
    const d = Math.hypot(x2 - x0, y2 - y0);
    if (d < 0.6) { c = { len: 0, pts: null, d }; net.conn.set(key, c); return c; }
    // tangents
    const ax = x0 - pa[pa.length - 4], ay = y0 - pa[pa.length - 3], al = Math.hypot(ax, ay) || 1;
    const bx = pb[2] - x2, by = pb[3] - y2, bl = Math.hypot(bx, by) || 1;
    const tx = ax / al, ty = ay / al, ux = bx / bl, uy = by / bl;
    // control = intersection of the two tangent lines (fallback: mid-point)
    const det = tx * uy - ty * ux;
    let cx = (x0 + x2) / 2, cy = (y0 + y2) / 2;
    if (Math.abs(det) > 0.05) {
      const s = ((x2 - x0) * uy - (y2 - y0) * ux) / det;
      if (s > -1 && s < d * 2.5) { cx = x0 + tx * s; cy = y0 + ty * s; }
    }
    const pts = []; const N = 8;
    for (let k = 0; k <= N; k++) { const t = k / N, u = 1 - t; pts.push(u * u * x0 + 2 * u * t * cx + t * t * x2, u * u * y0 + 2 * u * t * cy + t * t * y2); }
    const cum = cumul(pts);
    c = { len: cum[cum.length - 1], pts, cum, d }; net.conn.set(key, c); return c;
  }

  function posOnPoly(pts, cum, s) {          // returns [x, y, angle]
    const n = cum.length;
    if (s <= 0) { return [pts[0], pts[1], Math.atan2(pts[3] - pts[1], pts[2] - pts[0])]; }
    if (s >= cum[n - 1]) { return [pts[2 * n - 2], pts[2 * n - 1], Math.atan2(pts[2 * n - 1] - pts[2 * n - 3], pts[2 * n - 2] - pts[2 * n - 4])]; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
    const x0 = pts[2 * lo], y0 = pts[2 * lo + 1], x1 = pts[2 * hi], y1 = pts[2 * hi + 1];
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.atan2(y1 - y0, x1 - x0)];
  }

  // =====================================================================
  class Sim {
    constructor(D, opts) {
      opts = opts || {};
      this.D = D; this.net = buildNet(D);
      this.seed = opts.seed == null ? 1 : opts.seed;
      this.rng = mulberry32(this.seed);
      this.scenario = SCENARIOS[opts.scenario || 'S3'];
      this.greenWave = opts.greenWave !== false;
      this.dynGps = opts.dynGps !== false;
      this.rain = !!opts.rain;
      this.ambientRate = opts.ambient == null ? 1200 : opts.ambient;       // veh/h of background random trips
      this.maxGreen = opts.maxPressure || false;
      this.scaleOverride = opts.scale || null;
      this.cal = opts.cal == null ? 0.55 : opts.cal;               // demand calibration of the browser engine (simplified junction model)
      this.noAmbulance = !!opts.noAmbulance;
      this.t = 0; this.step = 0;
      this.vehicles = []; this.pending = []; this.byId = new Map();
      this.nextId = 0; this.log = []; this.onLog = opts.onLog || null;
      this.lanes = this.net.E.map((e) => e.lanes.map(() => ({ list: [] })));
      this.closed = new Set();
      this.edgeSpeed = new Float32Array(this.net.E.length).fill(-1);   // smoothed mean speed (travel-time feedback for GPS)
      this.edgeCount = new Int16Array(this.net.E.length);
      this.enter = new Int32Array(this.net.E.length); this.leave = new Int32Array(this.net.E.length);   // detector counters (E2-like)
      this.detA = this.net.byId.get('436872467#0'); this.detB = this.net.byId.get('436872455'); this.det = [];
      this.tlsOverride = new Map(); this.activeTls = null;
      this.tlsPhaseT = this.net.tls.map(() => 0);
      this.stats = { arrived: 0, teleports: 0, spawned: 0, forced: 0, series: [] };
      this.ambulance = null; this.amb = { start: -1, end: -1, entered: false, forced: [], reroutes: 0, wait: 0 };
      this.bus = { start: -1, end: -1 };
      this.obstacle = null; this.accident = false; this.construction = false;
      this.flows = this._makeFlows();
      this.truckEntered = false; this.firstTruckStep = -1;
      this.emit('[SCENARIO] ' + this.scenario.id + ' Active: ' + this.scenario.desc + (this.greenWave ? '' : ' (Green Wave OFF)'));
    }

    emit(msg, kind) {
      const m = { t: this.t, msg, kind: kind || 'info' };
      this.log.push(m); if (this.log.length > 400) this.log.shift();
      if (this.onLog) this.onLog(m);
    }

    get scale() { return this.scaleOverride != null ? this.scaleOverride : this.scenario.scale; }

    // ---------------------------------------------------------------- demand (osm.rou.xml)
    _makeFlows() {
      const R = this.net.routes;
      const f = (id, type, vph, route, t0, t1, extra) => Object.assign({ id, type, vph, route, t0, t1, acc: this.rng() * 0.5, sub: id }, extra || {});
      const list = [
        f('main_stubborn', 'normal_car', 1700, R.main, 0, 3600),
        f('main_smart', 'smart_car', 900, R.main, 0, 3600),
        f('bg_traffic_1', 'normal_car', 460, R.bg1, 0, 3600),
        f('bg_traffic_2', 'normal_car', 460, R.bg2, 0, 3600),
        f('bg_traffic_3', 'normal_car', 480, R.bg3, 0, 3600),
        f('city_bus', 'bus_type', 10, R.bus, 1200, 3600),
        f('trucks_main', 'freight_truck', 0.2 * 3600, R.main, 0, 3600),          // probability 0.2 / s  (~ 720/h)
      ];
      list.find((x) => x.id === 'trucks_main').vph = 0;                          // trucks are inserted by TraCI every 45 s (see step())
      return list;
    }

    // ---------------------------------------------------------------- vehicle creation
    makeVehicle(type, route, extra) {
      const T = TYPES[type];
      const rng = this.rng;
      const temp = type === 'ambulance_type' ? { sf: 1.12, a: T.a, b: T.b, tau: 0.65, sig: 0.1 } :
                   (type === 'bus_type' || type === 'freight_truck') ? { sf: 0.95, a: T.a, b: T.b, tau: 1.2, sig: 0.3 } :
                   TEMPERAMENTS[Math.min(4, Math.floor(rng() * 5))];
      const v = Object.assign({
        id: type === 'ambulance_type' ? 'AMBULANCE_01' : '',
        type, route: route.slice(), ri: 0, lane: 0, pos: 0, v: 0, len: T.len, w: T.w,
        sf: temp.sf, a: Math.min(temp.a, T.a * 1.1), b: temp.b, tau: temp.tau, sig: temp.sig,
        maxV: T.maxV, wait: 0, stuck: 0, tdep: this.t, temp,
        prevLane: -1, blend: 1, stopT: 0, stopped: false, forceStop: false, lcT: 0, rrT: this.t + 5 + rng() * 25,
        yieldT: 0, dest: route[route.length - 1], tripT: 0, busStopDone: false, color: null, accum: 0,
      }, extra || {});
      return v;
    }

    tryInsert(v) {
      // departLane = free / departPos = base : choose the lane with the largest free gap at the start of the edge
      const e = this.net.E[v.route[0]];
      let best = -1, bestGap = -1;
      for (let l = 0; l < e.n; l++) {
        if (this.closed.has(e.i + '_' + l)) continue;
        const list = this.lanes[e.i][l].list;
        let gap = 1e9;
        if (list.length) { const o = list[list.length - 1]; gap = (o.pos - o.len) - (v.len + 0.1); }
        if (gap > bestGap) { bestGap = gap; best = l; }
      }
      if (best < 0 || bestGap < 6 + MINGAP) return false;
      const ahead = this.lanes[e.i][best].list; const lead = ahead.length ? ahead[ahead.length - 1] : null;
      if (!v.id) v.id = v.type === 'bus_type' ? 'city_bus.' + (this.busN = (this.busN == null ? 0 : this.busN + 1)) : v.type + '.' + (this.nextId++);
      v.lane = best; v.pos = Math.min(v.len + 0.1, e.lanes[best].len - 0.01);
      v.v = Math.max(0, Math.min(e.v * 0.8, lead ? Math.min(lead.v + 2, Math.sqrt(2 * v.b * Math.max(0, bestGap - 2))) : 14));
      v._eff = this._effLen(v);
      this.vehicles.push(v); this.byId.set(v.id, v); this.stats.spawned++; this.enter[e.i]++;
      ahead.push(v);
      return true;
    }

    // ---------------------------------------------------------------- travel time routing (device.rerouting)
    reroute(v) {
      const E = this.net.E, from = v.route[v.ri], dst = v.dest;
      if (from === dst) return;
      const dist = new Map([[from, 0]]), prev = new Map(); const h = new Heap(); h.push(0, from);
      let found = false;
      while (h.size) {
        const [c, u] = h.pop();
        if (u === dst) { found = true; break; }
        if (c > dist.get(u)) continue;
        for (const t of E[u].nx) {
          const w = t[0]; const ew = E[w];
          if (this._edgeBlocked(ew, v)) continue;
          const sp = this.edgeSpeed[w] > 0 ? Math.max(1.2, Math.min(ew.v, this.edgeSpeed[w])) : ew.v;
          const nc = c + ew.len / sp + (this.edgeCount[w] > 0 && sp < 3 ? 25 : 0);
          if (nc < (dist.has(w) ? dist.get(w) : 1e18)) { dist.set(w, nc); prev.set(w, u); h.push(nc, w); }
        }
      }
      if (!found) return;
      const path = [dst]; while (path[path.length - 1] !== from) path.push(prev.get(path[path.length - 1]));
      path.reverse();
      const old = v.route.slice(v.ri).join(',');
      if (old === path.join(',')) return;
      // keep lane valid for the new next transition
      const keep = v.route.slice(0, v.ri);
      v.route = keep.concat(path);
      if (v.id === 'AMBULANCE_01') { this.amb.reroutes++; this.emit('[GPS] ' + v.id + ' reroute → νέα διαδρομή (' + path.length + ' edges)', 'gps'); }
      else v.reroutedAt = this.t;
    }
    _edgeBlocked(e, v) {
      if (this.closed.size === 0) return false;
      for (let l = 0; l < e.n; l++) if (!this.closed.has(e.i + '_' + l)) return false;
      return true;
    }

    // ---------------------------------------------------------------- traffic lights
    tlsState(ti) {
      const ov = this.tlsOverride.get(ti);
      if (ov) return ov;
      const T = this.net.tls[ti];
      let cyc = 0; for (const p of T.ph) cyc += p[0];
      let tt = (this.t + T.off) % cyc;
      for (let k = 0; k < T.ph.length; k++) { if (tt < T.ph[k][0]) { T._ph = k; return T.ph[k][1]; } tt -= T.ph[k][0]; }
      return T.ph[0][1];
    }
    linkChar(ti, link) { const s = this.tlsState(ti); return s[link] || 'G'; }

    // ---------------------------------------------------------------- the TraCI-like green-wave controller of `code`
    // getNextTLS("AMBULANCE_01") -> [tlsIndex, linkIndex, distance]  (first signal still ahead of the front bumper)
    nextTls(v) {
      const E = this.net.E;
      let dist = E[v.route[v.ri]].lanes[v.lane].len - v.pos;
      for (let k = v.ri; k < v.route.length - 1; k++) {
        const t = E[v.route[k]].nxMap.get(v.route[k + 1]);
        if (t && t[2] >= 0 && !(k === v.ri && dist < -0.05)) return [t[2], t[3], dist];
        dist += E[v.route[k + 1]].lanes[0].len;
      }
      return null;
    }

    ambInfo() {
      const a = this.ambulance; if (!a) return null;
      const E = this.net.E; let rem = E[a.route[a.ri]].lanes[a.lane].len - a.pos;
      for (let k = a.ri + 1; k < a.route.length; k++) rem += E[a.route[k]].lanes[0].len;
      return { v: a.v, rem, el: this.t - this.amb.start, next: this.nextTls(a) };
    }

    greenWaveControl() {
      const amb = this.ambulance;
      if (!amb) {
        if (this.activeTls !== null) { this.tlsOverride.delete(this.activeTls); this.activeTls = null; }
        return;
      }
      const nt = this.nextTls(amb);
      if (!nt) return;
      const [ti, link, d] = nt;
      if (d < 400) {
        if (this.activeTls !== null && this.activeTls !== ti) this.tlsOverride.delete(this.activeTls);   // setProgram(active_tls, "0")
        this.activeTls = ti;
        const st = this.tlsState(ti);
        const ch = st[link];
        if (ch !== 'G' && ch !== 'g') {
          const arr = st.split(''); arr[link] = 'G';                       // only the ambulance lane turns green
          this.tlsOverride.set(ti, arr.join(''));                           // setRedYellowGreenState(tls_id, new_state)
          this.stats.forced++;
          this.amb.forced.push({ t: this.t, tls: ti, d });
          this.emit('  [GREEN WAVE] Forced Prasino sto fanari ' + this.net.tls[ti].id.slice(0, 14) + ' (Apostash: ' + d.toFixed(1) + 'm)', 'green');
        }
      }
    }

    // ---------------------------------------------------------------- rebuild per-lane ordered lists
    _rebuildLanes() {
      const L = this.lanes, E = this.net.E;
      for (let i = 0; i < L.length; i++) for (let l = 0; l < L[i].length; l++) L[i][l].list.length = 0;
      this.edgeCount.fill(0);
      for (const v of this.vehicles) {
        const e = E[v.route[v.ri]];
        L[e.i][v.lane].list.push(v);
        this.edgeCount[e.i]++;
        const ln = e.lanes[v.lane];
        if (v.pos > ln.len && v.ri + 1 < v.route.length) {                 // ghost on the next lane while crossing the junction
          const nxe = v.route[v.ri + 1]; const tl = Math.min(v.nl != null ? v.nl : v.lane, E[nxe].n - 1);
          const gh = v._gh || (v._gh = { ghost: true });
          gh.ref = v; gh.pos = v.pos - v._eff; gh.len = v.len; gh.v = v.v;
          L[nxe][tl].list.push(gh);
        }
      }
      for (let i = 0; i < L.length; i++) for (let l = 0; l < L[i].length; l++) { const a = L[i][l].list; if (a.length > 1) a.sort((p, q) => q.pos - p.pos); }
    }

    // effective length of the current edge for vehicle v: lane length + junction connector
    _effLen(v) {
      const E = this.net.E; const e = E[v.route[v.ri]];
      const ln = e.lanes[v.lane];
      if (v.ri + 1 >= v.route.length) { v.nl = v.lane; return ln.len; }
      const nx = E[v.route[v.ri + 1]];
      const after = v.ri + 2 < v.route.length ? nx.nxMap.get(v.route[v.ri + 2]) : null;
      v.nl = this._pickLane(nx, Math.min(v.lane, nx.n - 1), after ? after[1] : 0xff);   // lane I will occupy after the junction
      const c = connector(this.net, e, nx, v.lane, v.nl);
      return ln.len + c.len;
    }

    // nearest vehicle strictly ahead of v on a (sorted, front-first) lane list
    _ahead(lst, v) {
      for (let k = lst.length - 1; k >= 0; k--) {
        const o = lst[k];
        if (o === v || o.ref === v) continue;
        if (o.pos > v.pos) return o;
      }
      return null;
    }

    // leader search: returns [gap, leaderSpeed]   (same lane first, then along the route)
    _leader(v, lane, searchDist) {
      const E = this.net.E;
      const o = this._ahead(this.lanes[v.route[v.ri]][lane].list, v);
      if (o) return [(o.pos - o.len) - v.pos - MINGAP, o.v];
      let acc = v._eff - v.pos, cl = v.nl != null ? v.nl : lane; const _n1 = E[v.route[v.ri + 1]]; if (_n1 && cl >= _n1.n) cl = _n1.n - 1;
      let thr = v.pos - v._eff;                      // my front position expressed in next-lane coordinates
      for (let k = v.ri + 1; k < v.route.length && acc < searchDist; k++) {
        const e = E[v.route[k]]; cl = k === v.ri + 1 ? Math.min(cl, e.n - 1) : this._pickLane(e, Math.min(cl, e.n - 1), 0xff);
        const l2 = this.lanes[e.i][cl].list;
        for (let q = l2.length - 1; q >= 0; q--) {
          const w = l2[q]; if (w.ref === v || w === v || w.pos <= thr) continue;   // ignore ghosts that are still behind me
          return [acc + (w.pos - w.len) - MINGAP, w.v];                          // nearest vehicle ahead on that lane
        }
        thr = -1e9;
        acc += e.lanes[cl].len;
        if (k + 1 < v.route.length) { const nx = E[v.route[k + 1]]; acc += connector(this.net, e, nx, cl, Math.min(cl, nx.n - 1)).len; }
      }
      return [1e9, 30];
    }

    // =====================================================================
    //  One tick
    // =====================================================================
    tick() {
      const dt = DT, rng = this.rng, E = this.net.E;
      this.t += dt; const stepNow = Math.floor(this.t + 1e-6); const newStep = stepNow !== this.step; this.step = stepNow;
      const wholeSec = Math.abs(this.t - Math.round(this.t)) < 1e-6;

      // ---- scenario events (TraCI) -----------------------------------------------------
      if (this.scenario.id === 'S3' && !this.construction && this.t >= 1000) {
        this.construction = true; this.closed.add(this.net.byId.get('436872467#0') + '_0');
        this.emit('[SCENARIO S3] ERGA: H deksia lwrida kleise sto step ' + this.step + ' logw ergwn!', 'warn');
      }
      if (this.scenario.id === 'S2' && !this.accident && this.t >= 1000) {
        const ei = this.net.byId.get('436872460');
        const cars = []; for (let l = 0; l < E[ei].n; l++) for (const o of this.lanes[ei][l].list) if (!o.ghost && o.type !== 'ambulance_type') cars.push(o);
        if (cars.length) {
          const c = cars[0]; c.lane = 0; c.forceStop = true; c.v = 0; c.color = '#ef4444'; c.alarm = true; this.obstacle = c; this.accident = true;
          this.emit('[SCENARIO S2] ATYXHMA: Το όχημα ' + c.id + ' τράκαρε και έμεινε ακινητοποιημένο!', 'warn');
        }
      }

      // ---- demand ---------------------------------------------------------------------
      const sc = this.scale;
      for (const f of this.flows) {
        if (this.t < f.t0 || this.t >= f.t1 || f.vph === 0) continue;
        f.acc += f.vph * sc * this.cal / 3600 * dt;
        while (f.acc >= 1) { f.acc -= 1; this.pending.push({ flow: f, t: this.t }); }
      }
      if (this.ambientRate > 0 && this.net.ambient.length) {
        this._amb = (this._amb || 0) + this.ambientRate * sc / 3600 * dt;
        while (this._amb >= 1) {
          this._amb -= 1;
          let r = this.net.ambient[(rng() * this.net.ambient.length) | 0];
          for (let k = 0; k < 6 && this.net.E[r[0]].len < 16; k++) r = this.net.ambient[(rng() * this.net.ambient.length) | 0];
          this.pending.push({ flow: { type: 'ambient', route: r, id: 'ambient' }, t: this.t });
        }
      }
      // TraCI trucks: every 45 s (step % 45 == 0), until 3600
      if (wholeSec && this.step > 0 && this.step <= 3600 && this.step % 45 === 0) {
        this.pending.push({ flow: { type: 'freight_truck', route: this.net.routes.main, id: 'trucks_main_' + this.step }, t: this.t, name: 'trucks_main_' + this.step });
      }
      if (!this.noAmbulance && !this._ambQueued && this.t >= 1900) {
        this._ambQueued = true;
        this.pending.unshift({ flow: { type: 'ambulance_type', route: this.net.routes.main, id: 'AMBULANCE_01' }, t: this.t, prio: true });
      }
      // insertion
      if (this.pending.length) {
        const rest = [];
        for (const p of this.pending) {
          const T = p.flow.type;
          const v = this.makeVehicle(T, p.flow.route, p.name ? { id: p.name } : {});
          if (T === 'smart_car') v.smart = true;
          if (T === 'ambulance_type') { v.smart = this.dynGps; }
          if (T === 'ambient') v.color = null;
          if (!this.tryInsert(v)) { if (this.t - p.t < 120 || T === 'ambulance_type') rest.push(p); else this.stats.dropped = (this.stats.dropped || 0) + 1; }
          else {
            if (T === 'ambulance_type') {
              this.ambulance = v; this.amb.start = this.t; this.amb.entered = true;
              this.emit('[INFO] >>> TO ASTHENOFORO (AMBULANCE_01) MPHKE STO SIMULATION STO STEP ' + this.step + '! <<<', 'amb');
            }
            if (T === 'freight_truck' && !this.truckEntered) { this.truckEntered = true; this.firstTruckStep = this.step; this.emit('[INFO] Το prwto fortigo (' + v.id + ') mphke sto simulation sto step ' + this.step + '!', 'info'); }
            if (T === 'bus_type' && this.bus.start < 0) { this.bus.start = this.t; this.busVeh = v; this.emit('[INFO] To lewforeio (' + v.id + ') mphke sto step ' + this.step, 'info'); }
            if (T === 'bus_type') v.isBus = true;
          }
        }
        this.pending = rest;
      }

      // ---- TraCI green wave ---------------------------------------------------------------
      if (this.greenWave && wholeSec) this.greenWaveControl();

      // ---- GPS rerouting -----------------------------------------------------------------------
      if (wholeSec) {
        for (const v of this.vehicles) {
          if (!v.smart || v.ri >= v.route.length - 2) continue;
          if (this.t >= v.rrT) { v.rrT = this.t + (v.type === 'ambulance_type' ? 100 : 30); this.reroute(v); }
        }
        // smoothed edge mean speeds
        const L = this.lanes;
        for (let i = 0; i < L.length; i++) {
          let s = 0, c = 0;
          for (let l = 0; l < L[i].length; l++) for (const o of L[i][l].list) if (!o.ghost) { s += o.v; c++; }
          if (c) { const m = s / c; this.edgeSpeed[i] = this.edgeSpeed[i] < 0 ? m : this.edgeSpeed[i] * 0.8 + m * 0.2; }
          else if (this.edgeSpeed[i] >= 0) this.edgeSpeed[i] = this.edgeSpeed[i] * 0.9 + E[i].v * 0.1;
        }
      }

      this._rebuildLanes();

      // ---- car following + lane changing + junctions ----------------------------------------------------
      const vs = this.vehicles; const removed = [];
      const rainF = this.rain ? 0.78 : 1, rainTau = this.rain ? 1.35 : 1;
      for (let n = 0; n < vs.length; n++) {
        const v = vs[n];
        const e = E[v.route[v.ri]]; v._eff = this._effLen(v);
        const lane = v.lane; const ln = e.lanes[lane];
        const last = v.ri >= v.route.length - 1;
        const nxId = last ? -1 : v.route[v.ri + 1];
        const trans = last ? null : e.nxMap.get(nxId);

        // ----- lane change decisions (staggered, every ~1 s)
        if (!v.forceStop && ((n + this.step) & 1) === 0 && v.pos < ln.len - 4) this._laneLogic(v, e, trans, dt);

        // ----- speed limit
        let vmax = Math.min(e.v * v.sf * rainF, v.maxV);
        if (v.type === 'ambulance_type') vmax = Math.min(e.v * 1.15, 33);
        // leader (same lane + downstream)
        let [gap, vl] = this._leader(v, v.lane, 60 + v.v * 4);
        let dstop = 1e9;   // distance to a stationary obstacle (red light / yield / bus stop)

        if (v.forceStop) { v.v = 0; continue; }

        // ----- traffic light / junction control at the end of the lane
        const toLine = ln.len - v.pos;                       // front bumper -> stop line
        if (!last && toLine > -0.5 && v.pos <= ln.len) {
          if (trans && trans[2] >= 0) {
            const ch = this.linkChar(trans[2], trans[3]);
            if (ch === 'r' || ch === 'R' || ch === 's') dstop = toLine;
            else if (ch === 'y' || ch === 'Y') { const bd = (v.v * v.v) / (2 * v.b) + v.v * 0.4; if (bd < toLine - 0.5) dstop = toLine; }
          } else if (e.rivals.length && toLine < 40) {
            // priority junction: yield to approaching vehicles of higher priority edges
            let busy = false;
            for (const ri of e.rivals) {
              for (let l = 0; l < E[ri].n; l++) {
                const lst = this.lanes[ri][l].list;
                if (lst.length) { const o = lst[0]; if (!o.ghost && E[ri].len - o.pos < 22 && (o.v > 1.5 || E[ri].len - o.pos < 6)) { busy = true; break; } }
              }
              if (busy) break;
            }
            if (busy && v.yieldT < 9) { dstop = toLine; v.yieldT += dt; }
            else if (!busy) v.yieldT = Math.max(0, v.yieldT - dt * 0.5);
          }
        }
        // ----- end of route: leave
        if (last && v.pos >= ln.len) { removed.push(v); this._arrive(v); continue; }
        // ----- bus stop dwell (busStop bs_0 of s.add.xml)
        if (v.isBus && !v.busStopDone) {
          const st = this.net.stops.find((s) => s.e === e.i);
          if (st) {
            if (v.stopT > 0) { v.stopT -= dt; dstop = Math.min(dstop, Math.max(0, st.b - v.pos)); if (v.stopT <= 0) v.busStopDone = true; }
            else if (v.pos <= st.b + 1) {
              dstop = Math.min(dstop, Math.max(0, st.b - v.pos));
              if (v.pos >= st.b - 2.5 && v.v < 0.3) { v.stopT = 15; this.emit('[INFO] ' + v.id + ' σταματά στη στάση ' + st.id + ' (15 s)', 'info'); }
            }
          }
        }

        // ----- Krauss safe speed
        const b = v.b, tau = v.tau * rainTau;
        let vsafe = vmax;
        if (gap < 1e8) { const g = Math.max(0, gap); vsafe = Math.min(vsafe, -b * tau + Math.sqrt(b * b * tau * tau + vl * vl + 2 * b * g)); }
        if (dstop < 1e8) { const g = Math.max(0, dstop - 0.3); vsafe = Math.min(vsafe, -b * tau + Math.sqrt(b * b * tau * tau + 2 * b * g)); }
        let vn = Math.min(v.v + v.a * dt, vmax, vsafe);
        vn = Math.max(vn, Math.max(0, v.v - v.b * 1.6 * dt));       // physical braking limit
        if (vsafe < vn) vn = Math.max(0, vsafe);
        if (vn > 0.5 && v.sig > 0 && v.type !== 'ambulance_type') vn = Math.max(0, vn - v.sig * v.a * dt * rng() * 0.5);
        vn = Math.max(0, vn);
        // a vehicle that hasn't got a lane that leads on must not run over the line
        const adv = (v.v + vn) * 0.5 * dt;
        let np = v.pos + adv;
        if (dstop < 1e8 && np > ln.len - 0.05 && v.pos <= ln.len) np = Math.min(np, ln.len - 0.05);
        if (gap < 1e8 && adv > gap + MINGAP - 0.3) { np = v.pos + Math.max(0, Math.min(adv, gap + MINGAP - 0.3)); vn = Math.min(vn, Math.max(0, (np - v.pos) / dt)); }
        v.pos = np; v.v = vn;
        if (vn < 0.1) { v.wait += dt; } else v.wait = 0;
        v.accum += vn * dt;

        // ----- junction crossing: next edge (a short edge can be hopped several times per tick)
        let hops = 0;
        while (v.ri < v.route.length - 1 && v.pos >= v._eff && hops++ < 6) {
          v.pos -= v._eff; this.leave[v.route[v.ri]]++; v.ri++; this.enter[v.route[v.ri]]++;
          const ne = E[v.route[v.ri]];
          // choose a lane that is open and (if known) leads to the following edge
          const after = v.ri + 1 < v.route.length ? ne.nxMap.get(v.route[v.ri + 1]) : null;
          const nl = this._pickLane(ne, Math.min(v.lane, ne.n - 1), after ? after[1] : 0xff);
          v.prevLane = v.lane; v.blend = 0; v.lane = nl;
          if (v.pos < 0) v.pos = 0;
          v._eff = this._effLen(v);
        }
        // time-to-teleport (SUMO --time-to-teleport)
        const tt = this.scenario.teleport > 0 ? this.scenario.teleport : 900;
        if (v.wait > tt && !v.forceStop && v.type !== 'ambulance_type') { removed.push(v); this.stats.teleports++; if (this.stats.teleports < 6 || this.stats.teleports % 10 === 0) this.emit('[TELEPORT] ' + v.id + ' @' + e.id + ' αφαιρέθηκε μετά από ' + Math.round(v.wait) + ' s αναμονής (--time-to-teleport ' + this.scenario.teleport + ')', 'warn'); }
        if (v.blend < 1) v.blend = Math.min(1, v.blend + dt / 1.4);
      }
      if (removed.length) {
        const set = new Set(removed); this.vehicles = vs.filter((v) => !set.has(v)); removed.forEach((v) => this.byId.delete(v.id));
        if (this.ambulance && set.has(this.ambulance)) this.ambulance = null;
      }
      // ---- per-100-step statistics (same text as `code`)
      if (wholeSec && this.step % 100 === 0) {
        let stopped = 0, delay = 0; for (const v of this.vehicles) if (v.wait > 0) { stopped++; delay += v.wait; }
        this.emit('Step ' + this.step + ': ' + this.vehicles.length + ' total cars. ' + stopped + ' stopped (Total delay: ' + Math.round(delay) + 's).', 'stat');
      }
      if (wholeSec && this.step % 10 === 0) this._sample();
    }

    _pickLane(ne, pref, mask) {
      const ok = (l) => !this.closed.has(ne.i + '_' + l) && ((mask >> l) & 1);
      if (ok(pref)) return pref;
      for (let d = 1; d < ne.n; d++) { if (pref - d >= 0 && ok(pref - d)) return pref - d; if (pref + d < ne.n && ok(pref + d)) return pref + d; }
      for (let l = 0; l < ne.n; l++) if (!this.closed.has(ne.i + '_' + l)) return l;
      return pref;
    }

    _laneLogic(v, e, trans, dt) {
      if (e.n < 2) return;
      const lane = v.lane;
      const need = trans ? trans[1] : 0xff;
      const closed = (l) => this.closed.has(e.i + '_' + l);
      const mustMove = !((need >> lane) & 1) || closed(lane);
      if (v.lcT > this.t && !mustMove) return;
      const cand = [];
      if (lane > 0) cand.push(lane - 1);
      if (lane < e.n - 1) cand.push(lane + 1);
      let best = -1, bestScore = -1e9;
      const [g0, vl0] = this._leaderOn(v, lane);
      const want = Math.min(e.v * v.sf, v.maxV);
      for (const l of cand) {
        if (closed(l) || !((need >> l) & 1)) continue;
        const [gAhead, vAhead] = this._leaderOn(v, l);
        const gBack = this._followerGap(v, l);
        const need5 = mustMove ? Math.max(0.5, 5 - v.wait * 0.4) : 5;      // zipper-like merge: the longer I wait the smaller the gap I accept
        if (gAhead < need5 || gBack < need5) continue;
        let score;
        if (mustMove) score = 100 + Math.min(gAhead, 60);
        else {
          const blocked = g0 < 18 + v.v * 1.5 && vl0 < want - 2.5;      // slow leader -> overtake
          if (!blocked) continue;
          score = Math.min(gAhead, 80) - Math.min(g0, 80) + (vAhead - vl0) * 3;
          if (score < 8) continue;
        }
        if (score > bestScore) { bestScore = score; best = l; }
      }
      if (best >= 0) {
        v.prevLane = v.lane; v.blend = 0; v.lane = best; v.lcT = this.t + 3;
      } else if (mustMove && e.lanes[lane].len - v.pos < 14 && v.wait > 5) {
        // blocked in the wrong lane -> squeeze in (avoids artificial dead-locks)
        for (const l of cand) if (!closed(l) && ((need >> l) & 1)) { v.prevLane = v.lane; v.blend = 0; v.lane = l; v.lcT = this.t + 2; break; }
      }
    }
    _leaderOn(v, l) {
      const o = this._ahead(this.lanes[v.route[v.ri]][l].list, v);
      return o ? [(o.pos - o.len) - v.pos - MINGAP, o.v] : [1e9, 30];
    }
    _followerGap(v, l) {
      const lst = this.lanes[v.route[v.ri]][l].list;
      for (let k = 0; k < lst.length; k++) { const o = lst[k]; if (o === v || o.ref === v) continue; if (o.pos <= v.pos) return (v.pos - v.len) - o.pos - Math.max(0, (o.v - v.v) * 1.5); }
      return 1e9;
    }

    _arrive(v) {
      this.stats.arrived++; this.leave[v.route[v.ri]]++;
      if (v === this.ambulance) {
        this.amb.end = this.t; this.amb.total = this.t - this.amb.start;
        this.emit('!!! TO ASTHENOFORO (AMBULANCE_01) EFTASE STON PROORISMO TOU !!!  --> Synolikos Xronos Diadromhs: ' + Math.round(this.amb.total) + ' deuterolepta (Step ' + this.step + ').', 'amb');
        this.ambulance = null;
        if (this.activeTls !== null) { this.tlsOverride.delete(this.activeTls); this.activeTls = null; }
      }
      if (v === this.busVeh) { this.bus.end = this.t; this.emit('[INFO] To lewforeio eftase ston proorismo tou sto step ' + this.step + '. --> Synolikos Xronos Lewforeiou: ' + Math.round(this.t - this.bus.start) + ' deuterolepta.', 'info'); }
    }

    // ---------------------------------------------------------------- statistics
    _sample() {
      let stopped = 0, delay = 0, sp = 0;
      for (const v of this.vehicles) { if (v.wait > 0) { stopped++; delay += v.wait; } sp += v.v; }
      const n = this.vehicles.length;
      const s = { t: Math.round(this.t), n, stopped, delay: Math.round(delay), meanV: n ? sp / n : 0, arrived: this.stats.arrived };
      this.stats.series.push(s); if (this.stats.series.length > 720) this.stats.series.shift();
      this.det.push({ t: s.t, a: this.enter[this.detA], b: this.leave[this.detB] }); if (this.det.length > 720) this.det.shift();
      return s;
    }

    // vehicle world position + heading (used by the renderer)
    place(v) {
      const E = this.net.E; const e = E[v.route[v.ri]];
      const at = (lane, pos) => {
        const ln = e.lanes[lane];
        if (pos <= ln.len || v.ri + 1 >= v.route.length) return posOnPoly(ln.pts, ln.cum, pos);
        const nx = E[v.route[v.ri + 1]]; const tl = Math.min(lane === v.lane && v.nl != null ? v.nl : lane, nx.n - 1);
        const c = connector(this.net, e, nx, lane, tl);
        if (!c.pts) { return posOnPoly(ln.pts, ln.cum, ln.len); }
        return posOnPoly(c.pts, c.cum, pos - ln.len);
      };
      const p = at(v.lane, v.pos - v.len * 0.5);
      if (v.blend < 1 && v.prevLane >= 0 && v.prevLane < e.n) {
        const q = at(v.prevLane, v.pos - v.len * 0.5); const t = v.blend; const s = t * t * (3 - 2 * t);
        return [q[0] + (p[0] - q[0]) * s, q[1] + (p[1] - q[1]) * s, p[2]];
      }
      return p;
    }

    run(seconds) { const n = Math.round(seconds / DT); for (let i = 0; i < n; i++) this.tick(); }
  }

  root.TrafficSim = { Sim, SCENARIOS, TYPES, TEMPERAMENTS, DT, buildNet, connector, posOnPoly, mulberry32 };
  if (typeof module !== 'undefined') module.exports = root.TrafficSim;
})(typeof window !== 'undefined' ? window : globalThis);
