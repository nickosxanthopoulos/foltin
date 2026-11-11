/* =====================================================================
 *  site.js  --  content sections: pipeline, code walkthrough, scenarios, roadmap, repo files
 * ===================================================================== */
(function () {
  'use strict';
  const D = window.ILIO, TS = window.TrafficSim;
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [].slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const scrollHero = () => document.getElementById('sim').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const M = D.meta;

  // ------------------------------------------------------------------ nav + reveal + counters
  const nav = $('#nav');
  const onScroll = () => { nav.classList.toggle('glass', window.scrollY > 40); nav.style.borderRadius = '0'; nav.style.borderTop = '0'; nav.style.borderLeft = '0'; nav.style.borderRight = '0'; };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const secs = ['sim', 'pipeline', 'code', 'scenarios', 'greenwave', 'lab', 'results', 'roadmap'];
  const links = {}; $$('.nav-link').forEach((a) => { links[a.getAttribute('href').slice(1)] = a; });
  const navIO = new IntersectionObserver((en) => en.forEach((e) => {
    if (!e.isIntersecting) return;
    Object.values(links).forEach((l) => l.classList.remove('on')); if (links[e.target.id]) links[e.target.id].classList.add('on');
  }), { rootMargin: '-45% 0px -50% 0px' });
  secs.forEach((id) => { const n = document.getElementById(id); if (n) navIO.observe(n); });
  const io = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  const observeReveals = () => $$('.reveal:not(.in)').forEach((n) => io.observe(n));
  const countIO = new IntersectionObserver((en) => en.forEach((e) => {
    if (!e.isIntersecting) return; countIO.unobserve(e.target);
    const to = +e.target.dataset.count, t0 = performance.now(), dur = 1400;
    const tick = (n) => { const k = Math.min(1, (n - t0) / dur), v = Math.round(to * (1 - Math.pow(1 - k, 4))); e.target.textContent = v.toLocaleString('el-GR'); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  const observeCounts = () => $$('[data-count]').forEach((n) => countIO.observe(n));
  document.addEventListener('pointermove', (e) => { const c = e.target.closest && e.target.closest('.card'); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); } });

  // ------------------------------------------------------------------ 01 pipeline
  const PIPE = [
    { n: '01', t: 'OpenStreetMap', s: 'Ο πρώτος χάρτης', files: ['map.osm'], mode: 'osm',
      d: 'Με το <span class="mono text-slate-200">osmWebWizard.py</span> επιλέγουμε μια περιοχή οπουδήποτε και την κατεβάζουμε αμέσως. Εδώ: η Ηλιούπολη, <span class="mono">23.7487–23.7740°E · 37.9303–37.9494°N</span>.',
      facts: [[M.osmNodes.toLocaleString('el-GR'), 'κόμβοι OSM'], [M.buildings.toLocaleString('el-GR'), 'κτίρια'], ['7.4 MB', 'map.osm'], ['UTM 34N', 'προβολή']] },
    { n: '02', t: 'netconvert · netedit', s: 'Δίκτυο SUMO', files: ['osm.net.xml', 'ilioupoli.net.xml', 's.nod.xml', 'e.edg.xml', 's.com.xml', 's.tll.xml', 's.typ.xml'], mode: 'net',
      d: 'Το OSM μετατρέπεται σε <span class="mono text-slate-200">.net.xml</span>. Στο <b class="text-white">netedit</b> σβήνουμε τα άχρηστα μικρά στενά που βαραίνουν υπολογιστικά, φτιάχνουμε διασταυρώσεις και ορίζουμε φανάρια.',
      facts: [[M.edges, 'edges'], [M.lanes, 'λωρίδες'], [M.junctions, 'κόμβοι'], [M.tls, 'φανάρια'], [M.km + ' km', 'lane-km']] },
    { n: '03', t: 'Ζήτηση', s: 'Ποιος οδηγεί, πού', files: ['osm.rou.xml', 'osm.trips.xml'], mode: 'flows',
      d: 'Τύποι οχημάτων και <b class="text-white">ροές</b>: ο κεντρικός άξονας παίρνει το <b class="text-white">65%</b> (2600 οχ./ώρα), οι γειτονιές το 35% (1400). Η <span class="mono">randomTrips.py</span> προσθέτει ambient κίνηση.',
      facts: [['2.600', 'οχ./ώρα κεντρικός'], ['1.400', 'οχ./ώρα γειτονιές'], ['5', 'vTypes'], ['1', 'AMBULANCE_01']] },
    { n: '04', t: 'sumocfg', s: 'Το master αρχείο', files: ['ilioupoli.sumocfg.cfg', 's.add.xml', 'map1.add.xml'], mode: 'cfg',
      d: 'Ένα μικρό αρχείο που δένει δίκτυο, ζήτηση και πρόσθετα (<b class="text-white">στάσεις λεωφορείου</b>) — και ορίζει χρόνους έναρξης/λήξης.',
      facts: [['3', 'inputs'], ['bs_0', 'στάση λεωφορείου'], ['3600 s', 'ώρα 08:00–09:00']] },
    { n: '05', t: 'Python · TraCI', s: 'Ο εγκέφαλος', files: ['code'], mode: 'traci',
      d: 'Το αρχείο <span class="mono text-slate-200">code</span> ξεκινά το SUMO και, σε κάθε step, <b class="text-white">διαβάζει</b> (οχήματα, φανάρια) και <b class="text-white">γράφει</b> (κλείσιμο λωρίδας, forced green, φορτηγά).',
      facts: [['254', 'γραμμές κώδικα'], ['6000', 'steps'], ['4', 'σενάρια'], ['~25', 'TraCI calls']] },
    { n: '06', t: 'Analytics', s: 'Monte Carlo → Grafana', files: ['Monte Carlo', 'InfluxDB', 'Grafana'], mode: 'graf',
      d: 'Επαναλήψεις με διαφορετικά seeds (<b class="text-white">MC-disruptions</b>, <b class="text-white">MC-temperament</b>), εξαγωγή σε CSV και dashboards για CO₂, καθυστέρηση και ουρές. <i class="text-slate-500">Σχεδιασμένο (WP4)· prototype εδώ στο lab.</i>',
      facts: [['100', 'σενάρια/πείραμα'], ['CO₂', 'εκπομπές'], ['E2', 'detectors']] },
  ];
  let pipeSel = 0;
  function renderPipe() {
    $('#pipe').innerHTML = PIPE.map((p, i) => '<button class="card pnode text-left reveal d' + (i % 5) + (i === pipeSel ? ' act' : '') + '" data-i="' + i + '"><div class="num">' + p.n + '</div><div class="mt-3 text-[17px] font-semibold text-white leading-tight">' + p.t + '</div><div class="mt-1 text-[12.5px] text-slate-400">' + p.s + '</div><div class="mt-3">' + p.files.slice(0, 3).map((f) => '<span class="fchip">' + f + '</span>').join('') + (p.files.length > 3 ? '<span class="fchip">+' + (p.files.length - 3) + '</span>' : '') + '</div></button>').join('');
    $$('#pipe .pnode').forEach((b) => b.addEventListener('click', () => { pipeSel = +b.dataset.i; renderPipe(); renderPipeDetail(); observeReveals(); $$('#pipe .pnode').forEach((n) => n.classList.add('in')); }));
    $$('#pipe .pnode').forEach((n) => { n.classList.add('in'); });
  }
  function renderPipeDetail() {
    const p = PIPE[pipeSel], box = $('#pipe-detail');
    box.innerHTML = '<div><div class="eyebrow mb-3">' + p.n + ' · ' + p.t + '</div><h3 class="text-2xl font-semibold text-white mb-3">' + p.s + '</h3><p class="text-slate-400 leading-relaxed text-[15px]">' + p.d + '</p>' +
      '<div class="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2.5">' + p.facts.map((f) => '<div class="tile"><div class="v !text-[19px]">' + f[0] + '</div><div class="k !mt-2 !tracking-normal !normal-case" style="font-family:Inter;letter-spacing:0">' + f[1] + '</div></div>').join('') + '</div>' +
      '<div class="mt-4">' + p.files.map((f) => '<span class="fchip">' + f + '</span>').join('') + '</div></div>' +
      '<div class="relative rounded-xl overflow-hidden border hair bg-slate-950/70 min-h-[230px]"><canvas id="pipe-cv" class="absolute inset-0 w-full h-full"></canvas></div>';
    box.classList.add('in'); drawPipe(p.mode);
  }
  function drawPipe(mode) {
    const c = $('#pipe-cv'); if (!c) return;
    const d = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight; c.width = w * d; c.height = h * d;
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    const k = Math.min((w - 24) / M.w, (h - 24) / M.h), ox = (w - M.w * k) / 2, oy = (h + M.h * k) / 2;
    const X = (x) => ox + x * k, Y = (y) => oy - y * k;
    const txt = (t, x, y, col, f) => { g.fillStyle = col || '#94a3b8'; g.font = f || '12px "JetBrains Mono", monospace'; g.fillText(t, x, y); };
    if (mode === 'osm') {
      g.fillStyle = 'rgba(16,185,129,.12)'; D.parks.forEach((a) => { g.beginPath(); for (let i = 0; i < a.length; i += 2) g.lineTo(X(a[i] / 2), Y(a[i + 1] / 2)); g.fill(); });
      g.fillStyle = 'rgba(56,189,248,.55)'; g.strokeStyle = 'rgba(56,189,248,.9)'; D.buildings.forEach((a) => { g.beginPath(); for (let i = 0; i < a.length; i += 2) g.lineTo(X(a[i] / 2), Y(a[i + 1] / 2)); g.closePath(); g.fill(); });
      g.strokeStyle = 'rgba(148,163,184,.3)'; D.edges.forEach((e) => { const s = e.s[0]; g.beginPath(); for (let i = 0; i < s.length; i += 2) g.lineTo(X(s[i]), Y(s[i + 1])); g.stroke(); });
      D.pois.forEach((p) => { g.fillStyle = '#fbbf24'; g.beginPath(); g.arc(X(p.x), Y(p.y), 3.2, 0, 6.2832); g.fill(); });
      txt('map.osm — κτίρια, πάρκα, σχολεία (●)', 14, 20, '#cbd5e1');
    } else if (mode === 'net') {
      D.edges.forEach((e) => { g.strokeStyle = e.p >= 10 ? 'rgba(34,211,238,.9)' : e.p >= 5 ? 'rgba(129,140,248,.8)' : 'rgba(148,163,184,.45)'; g.lineWidth = e.p >= 10 ? 1.7 : 1; e.s.forEach((s) => { g.beginPath(); for (let i = 0; i < s.length; i += 2) g.lineTo(X(s[i]), Y(s[i + 1])); g.stroke(); }); });
      D.tls.forEach((t) => { g.fillStyle = '#34d399'; g.shadowColor = '#34d399'; g.shadowBlur = 12; g.beginPath(); g.arc(X(t.x), Y(t.y), 4.5, 0, 6.2832); g.fill(); }); g.shadowBlur = 0; g.lineWidth = 1;
      txt('osm.net.xml — ' + M.edges + ' edges · ' + M.tls + ' φανάρια (●)', 14, 20, '#cbd5e1');
    } else if (mode === 'flows') {
      const rows = [['main_stubborn', 1700, '#facc15'], ['main_smart', 900, '#38bdf8'], ['bg_traffic_1', 460, '#94a3b8'], ['bg_traffic_2', 460, '#94a3b8'], ['bg_traffic_3', 480, '#94a3b8'], ['city_bus', 10, '#22c55e']];
      rows.forEach((r, i) => { const y = 38 + i * ((h - 56) / rows.length), bw = (w - 170) * r[1] / 1700; txt(r[0], 14, y + 10, '#94a3b8', '11px "JetBrains Mono"'); g.fillStyle = r[2]; g.globalAlpha = .85; g.beginPath(); g.roundRect ? g.roundRect(130, y, Math.max(4, bw), 14, 6) : g.rect(130, y, Math.max(4, bw), 14); g.fill(); g.globalAlpha = 1; txt(r[1] + ' /h', 138 + bw, y + 11, '#e2e8f0', '600 11px "JetBrains Mono"'); });
      txt('vehsPerHour ανά flow', 14, 20, '#cbd5e1');
    } else if (mode === 'cfg') {
      const lines = ['<configuration>', '  <input>', '    <net-file value="osm.net.xml"/>', '    <route-files value="osm.rou.xml"/>', '    <additional-files value="s.add.xml"/>', '  </input>', '</configuration>'];
      lines.forEach((l, i) => { g.font = '13px "JetBrains Mono", monospace'; g.fillStyle = /value/.test(l) ? '#86efac' : '#c4b5fd'; g.fillText(l, 18, 44 + i * 22); });
      txt('ilioupoli.sumocfg.cfg', 14, 20, '#cbd5e1');
    } else if (mode === 'traci') {
      const lines = ['traci.start(sumoCmd)', 'while step < 6000:', '    traci.simulationStep()', '    # truck flow · disruptions', '    # ambulance · green wave', '    # statistics every 100 steps', 'traci.close()'];
      lines.forEach((l, i) => { g.font = '13px "JetBrains Mono", monospace'; g.fillStyle = /^\s+#/.test(l) ? '#5b6b86' : /traci|while/.test(l) ? '#7dd3fc' : '#cbd5e1'; g.fillText(l, 18, 44 + i * 22); });
      txt('code', 14, 20, '#cbd5e1');
      const t = performance.now() / 1000; g.fillStyle = '#34d399'; g.beginPath(); g.arc(w - 40, 40, 5 + Math.sin(t * 5) * 1.5, 0, 6.2832); g.fill();
    } else {
      const s = window.Hero && window.Hero.sim ? window.Hero.sim.stats.series.slice(-60) : [];
      g.strokeStyle = 'rgba(148,163,184,.12)'; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(14, 36 + i * (h - 60) / 5); g.lineTo(w - 14, 36 + i * (h - 60) / 5); g.stroke(); }
      [['n', '#22d3ee'], ['stopped', '#fb7185']].forEach(([key, col]) => { if (s.length < 2) return; const mx = Math.max.apply(null, s.map((a) => a.n)) * 1.1 || 1; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); s.forEach((a, i) => { const x = 14 + i / (s.length - 1) * (w - 28), y = h - 16 - (a[key] / mx) * (h - 60); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); });
      txt('Grafana-style panel (live από το sim)', 14, 20, '#cbd5e1');
    }
  }

  // ------------------------------------------------------------------ 02 code walkthrough
  const KW = /\b(import|from|if|elif|else|for|while|try|except|in|and|or|not|def|return|break|pass|continue|True|False|None|as|is|lambda|with)\b/;
  function hl(line) {
    // tiny python highlighter: comments, strings, numbers, keywords, traci calls
    const ci = (() => { let q = null; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '#') return i; } return -1; })();
    const code = ci >= 0 ? line.slice(0, ci) : line, com = ci >= 0 ? line.slice(ci) : '';
    let out = esc(code).replace(/(f?"[^"]*"|f?'[^']*')/g, '<span class="tk-s">$1</span>');
    out = out.replace(/(<span class="tk-s">.*?<\/span>)|(\b\d+(?:\.\d+)?\b)|(\btraci(?:\.\w+)+)|(\b(?:import|from|if|elif|else|for|while|try|except|in|and|or|not|return|break|pass|True|False|None|as)\b)/g,
      (m, s, n, t, k) => s ? s : n ? '<span class="tk-n">' + n + '</span>' : t ? '<span class="tk-f">' + t + '</span>' : '<span class="tk-k">' + k + '</span>');
    return out + (com ? '<span class="tk-c">' + esc(com) + '</span>' : '');
  }
  const run = (o) => () => { scrollHero(); setTimeout(() => window.Hero.run('x', o), 450); };
  const STEPS = [
    { t: 'Επιλογή σεναρίου', r: [19, 42], h: [22, 28, 31, 34, 36, 38],
      d: 'Μία μεταβλητή ορίζει όλο το πείραμα. Κάθε σενάριο περνά διαφορετικό <span class="mono">--scale</span> (πυκνότητα κίνησης) και <span class="mono">--time-to-teleport</span> στο SUMO. Στο S3 το teleport είναι 150 s για να μη μείνει μόνιμο gridlock.',
      acts: [['S1 · +Κίνηση', run({ scenario: 'S1', speed: 40, focus: '436872460', zoom: 1.0 })], ['S0 · Baseline', run({ scenario: 'S0', speed: 40 })]] },
    { t: 'Εκκίνηση μέσω TraCI', r: [44, 61], h: [46, 59, 60],
      d: 'Το <span class="mono">traci.start()</span> ανοίγει το SUMO και δίνει τον έλεγχο στο Python. Το loop προχωρά την προσομοίωση <b class="text-white">1 δευτερόλεπτο</b> κάθε φορά — εδώ το δίνει στη σελίδα ως τα steps του hero.',
      acts: [['Δες το step counter', run({ speed: 15, tab: 'tls' })]] },
    { t: 'Ροή φορτηγών κάθε 45 s', r: [62, 90], h: [65, 72, 78],
      d: 'Κάθε 45 steps (~80 φορτηγά/ώρα) το Python βρίσκει διαδρομή με <span class="mono">findRoute()</span> και προσθέτει όχημα τύπου <span class="mono">freight_truck</span> (12 m, max 15 m/s). Τα <b class="text-amber-500">καφέ</b> οχήματα στον χάρτη είναι αυτά.',
      acts: [['Δες τα φορτηγά', run({ scenario: 'S0', speed: 30, focus: '66113514#0', zoom: 2.2 })]] },
    { t: 'Διαταραχές: έργα & ατύχημα', r: [108, 135], h: [108, 115, 116, 119, 129, 132],
      d: 'Στο step 1000: <b class="text-white">S2</b> ακινητοποιεί το πρώτο όχημα της edge <span class="mono">436872460</span> (αλάρμ), <b class="text-white">S3</b> κλείνει τη λωρίδα <span class="mono">436872467#0_0</span> με <span class="mono">setDisallowed</span> — σαν να μπήκαν κώνοι.',
      acts: [['S3 · Έργα', run({ scenario: 'S3', speed: 40, ff: 985, focus: '436872467#0', zoom: 3.4, after: 6 })], ['S2 · Ατύχημα', run({ scenario: 'S2', speed: 40, ff: 985, focus: '436872460', zoom: 3.4, after: 6 })]] },
    { t: 'Ασθενοφόρο: tracker', r: [159, 172], h: [160, 161, 167, 168],
      d: 'Το Python παρακολουθεί πότε το <span class="mono">AMBULANCE_01</span> μπαίνει και φτάνει στον προορισμό. Ορίστηκε για step 1900· στο SUMO μπήκε στο 1913 γιατί χρειάστηκε ασφαλές κενό.',
      acts: [['Πήγαινε στο ασθενοφόρο', run({ scenario: 'S3', gw: false, gps: false, speed: 40, ff: 1888, follow: true, after: 5 })]] },
    { t: 'Dynamic Green Wave', r: [188, 231], h: [190, 201, 209, 211, 216, 220, 226, 228],
      d: 'Στα 400 m από το επόμενο φανάρι: διάβασε την κατάσταση, άλλαξε <b class="text-white">μόνο</b> τη λωρίδα του ασθενοφόρου σε <span class="mono text-em">G</span> και στείλε την πίσω με <span class="mono">setRedYellowGreenState</span>. Όταν περάσει, <span class="mono">setProgram(…, "0")</span> επαναφέρει το πρόγραμμα.',
      acts: [['Green Wave ON', run({ scenario: 'S3', gw: true, gps: true, speed: 40, ff: 1888, follow: true, after: 5 })], ['Green Wave OFF', run({ scenario: 'S3', gw: false, gps: false, speed: 40, ff: 1888, follow: true, after: 5 })]] },
    { t: 'Στατιστικά κίνησης', r: [233, 251], h: [236, 242, 249],
      d: 'Ανά 100 steps μετρά πόσα οχήματα περιμένουν και τη συνολική καθυστέρηση (<span class="mono">getWaitingTime</span>). Αυτά τα νούμερα τροφοδοτούν τα live metrics, το διάγραμμα και — στο WP4 — το Grafana.',
      acts: [['Δες τα metrics', run({ scenario: 'S1', speed: 40, tab: 'det' })]] },
  ];
  let stepSel = 0;
  function renderSteps() {
    $('#steps').innerHTML = STEPS.map((s, i) => '<button class="step-btn' + (i === stepSel ? ' on' : '') + '" data-i="' + i + '"><span class="n">' + (i + 1) + '</span><span><span class="block text-[14.5px] font-semibold text-white">' + s.t + '</span><span class="block text-[11.5px] mono text-slate-500 mt-0.5">γραμμές ' + s.r[0] + '–' + s.r[1] + '</span></span></button>').join('');
    $$('#steps .step-btn').forEach((b) => b.addEventListener('click', () => { stepSel = +b.dataset.i; renderSteps(); renderCode(); }));
  }
  function renderCode() {
    const s = STEPS[stepSel], lines = D.code.slice(s.r[0] - 1, s.r[1]);
    $('#code-title').textContent = s.t; $('#code-desc').innerHTML = s.d; $('#code-lines').textContent = 'L' + s.r[0] + '–' + s.r[1] + ' / ' + D.code.length;
    const body = $('#code-body'); body.style.counterReset = 'ln ' + (s.r[0] - 1);
    body.innerHTML = lines.map((l, i) => '<span class="ln' + (s.h.indexOf(s.r[0] + i) >= 0 ? ' hl' : '') + '">' + (hl(l) || ' ') + '</span>').join('');
    const holder = $('#code-run').parentElement; $$('.alt-run', holder).forEach((n) => n.remove());
    $('#code-run-t').textContent = s.acts[0][0]; $('#code-run').onclick = s.acts[0][1];
    s.acts.slice(1).forEach((a) => { const b = document.createElement('button'); b.className = 'btn btn-ghost !py-2.5 shrink-0 alt-run'; b.textContent = a[0]; b.onclick = a[1]; holder.appendChild(b); });
    holder.className = 'flex gap-2 flex-wrap';
  }

  // ------------------------------------------------------------------ 03 scenarios
  const SC = [
    { id: 'S0', t: 'Baseline off-peak', c: 'cy', scale: '0.6', tp: 'off', ev: 'Καμία διαταραχή. Η κίνηση ρέει ομαλά· χρησιμεύει ως σημείο αναφοράς.', col: '#22d3ee' },
    { id: 'S1', t: 'Αυξημένη κίνηση', c: 'am', scale: '0.9', tp: 'off', ev: 'Περισσότερα οχήματα στον ίδιο δρόμο. Οι ουρές στα φανάρια μεγαλώνουν και ξεχειλίζουν.', col: '#fbbf24' },
    { id: 'S2', t: 'Ατύχημα', c: 'ro', scale: '0.8', tp: 'off', ev: 'Step 1000: το πρώτο όχημα στην edge 436872460 σταματά με αλάρμ στη δεξιά λωρίδα.', col: '#fb7185' },
    { id: 'S3', t: 'Έργα (1 λωρίδα)', c: 'am', scale: '0.8', tp: '150 s', ev: 'Step 1000: η λωρίδα 436872467#0_0 κλείνει. Η δεξιά λωρίδα γίνεται bottleneck.', col: '#fb923c' },
  ];
  function renderScenarios() {
    $('#sc-cards').innerHTML = SC.map((s, i) => '<div class="card p-6 reveal d' + i + '"><div class="flex items-center justify-between"><span class="mono text-3xl font-bold" style="color:' + s.col + '">' + s.id + '</span><span class="dot" style="background:' + s.col + ';box-shadow:0 0 12px ' + s.col + '"></span></div><h3 class="mt-4 text-lg font-semibold text-white">' + s.t + '</h3><p class="mt-2 text-sm text-slate-400 leading-relaxed min-h-[84px]">' + s.ev + '</p><div class="mt-4 grid grid-cols-2 gap-2"><div class="tile !p-2"><div class="k">--scale</div><div class="v !text-[17px]">' + s.scale + '</div></div><div class="tile !p-2"><div class="k">teleport</div><div class="v !text-[17px]">' + s.tp + '</div></div></div><button class="btn btn-ghost w-full mt-4 !py-2.5 sc-run" data-sc="' + s.id + '">▶ Δες το live</button></div>').join('');
    $$('.sc-run').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.sc; scrollHero(); setTimeout(() => window.Hero.run('x', { scenario: id, speed: 40, ff: id === 'S2' || id === 'S3' ? 985 : 0, focus: id === 'S3' ? '436872467#0' : id === 'S2' ? '436872460' : null, zoom: 3.2, after: 8 }), 450); }));
    const vt = [
      ['#facc15', 'normal_car', 'Κανονικά αυτοκίνητα', '«Πεισματάρηδες» — κρατούν την αρχική διαδρομή (1700/h).'],
      ['#38bdf8', 'smart_car', 'Έξυπνα (GPS)', 'device.rerouting κάθε 30 s — αποφεύγουν τη συμφόρηση (900/h).'],
      ['#ef4444', 'ambulance_type', 'Ασθενοφόρο', 'vClass="emergency", reroute κάθε 100 s, depart 1900.'],
      ['#22c55e', 'bus_type', 'Λεωφορείο', '12 m · 10/h από το step 1200 · στάση bs_0 (15 s).'],
      ['#a16207', 'freight_truck', 'Φορτηγό', '12 m · accel 0.8 · max 15 m/s · 1 ανά 45 s.'],
    ];
    $('#vtypes').innerHTML = vt.map((v) => '<div class="flex items-start gap-3.5"><span class="mt-1 w-9 h-5 rounded-md flex-none" style="background:' + v[0] + ';box-shadow:0 0 16px ' + v[0] + '55"></span><div><div class="text-[14.5px] text-white font-semibold">' + v[2] + ' <span class="mono text-[11px] text-slate-500 ml-1">' + v[1] + '</span></div><div class="text-[13px] text-slate-400 leading-snug">' + v[3] + '</div></div></div>').join('');
    $('#temps').innerHTML = TS.TEMPERAMENTS.map((t) => '<div><div class="flex justify-between items-center text-[13px] mb-1.5"><span class="text-white font-medium"><i class="dot mr-2" style="background:' + t.col + '"></i>' + t.name + '</span><span class="mono text-slate-500 text-[11px]">sf ' + t.sf.toFixed(2) + ' · a ' + t.a.toFixed(1) + ' · b ' + t.b.toFixed(1) + ' · τ ' + t.tau.toFixed(2) + '</span></div><div class="grid grid-cols-3 gap-2"><div class="bar"><i style="width:' + ((t.sf - .8) / .5 * 100) + '%;background:' + t.col + '"></i></div><div class="bar"><i style="width:' + (t.a / 4 * 100) + '%;background:' + t.col + '"></i></div><div class="bar"><i style="width:' + ((1.7 - t.tau) / 1.1 * 100) + '%;background:' + t.col + '"></i></div></div></div>').join('') + '<div class="grid grid-cols-3 gap-2 text-[10.5px] mono text-slate-500 mt-0.5"><span>ταχύτητα</span><span>επιτάχυνση</span><span>επιθετικότητα</span></div>';
  }

  // ------------------------------------------------------------------ 04 green wave steps
  const GW = [
    ['<span class="mono text-cy">getNextTLS("AMBULANCE_01")</span>', 'επιστρέφει το επόμενο φανάρι στη διαδρομή, τον δείκτη σύνδεσης και την απόσταση.'],
    ['<span class="mono text-cy">distance &lt; 400.0</span>', 'μόνο το φανάρι εντός ακτίνας 400 m «ακούει» το ασθενοφόρο.'],
    ['<span class="mono text-cy">state[link] ∉ {G, g}</span>', 'αν η λωρίδα είναι ήδη πράσινη δεν αγγίζουμε τίποτα.'],
    ['<span class="mono text-em">setRedYellowGreenState</span>', 'ΜΟΝΟ η λωρίδα του ασθενοφόρου → <b class="text-white">G</b>. Οι υπόλοιπες μένουν ως έχουν ώστε να μην παγιδευτούν οχήματα μέσα στον κόμβο.'],
    ['<span class="mono text-vi">setProgram(tls, "0")</span>', 'όταν το ασθενοφόρο προχωρήσει στο επόμενο φανάρι, το πρώτο γυρνά στο κανονικό του πρόγραμμα.'],
  ];
  function renderGW() {
    $('#gw-steps').innerHTML = GW.map((s, i) => '<li class="flex gap-3.5"><span class="flex-none w-6 h-6 rounded-lg bg-slate-800 border hair grid place-items-center mono text-[11px] text-slate-400 mt-0.5">' + (i + 1) + '</span><span>' + s[0] + '<br><span class="text-slate-400 text-[13px] leading-snug">' + s[1] + '</span></span></li>').join('');
    const R = [149.5, 143.6, 128.5, 112.1];
    $('#radar').innerHTML = R.map((r, i) => '<div class="flex-1 flex flex-col items-center justify-end gap-2 h-full"><div class="mono text-[11px] text-em">' + r + ' m</div><div class="w-full rounded-t-lg" style="height:' + (r / 150 * 86) + '%;background:linear-gradient(180deg,rgba(52,211,153,.9),rgba(52,211,153,.08));box-shadow:0 0 24px rgba(52,211,153,.25)"></div><div class="text-[10.5px] text-slate-500">παρέμβαση #' + (i + 1) + '</div></div>').join('');
  }

  // ------------------------------------------------------------------ 07 roadmap
  const WPS = [
    { n: 'WP1', t: 'Πρωτόκολλο & δεδομένα', st: 'prog', stt: 'Σε εξέλιξη', items: ['Πηγή πραγματικών δεδομένων: dopravniinfo.gov.cz (ανανέωση κάθε 2 λεπτά)', 'Επιλογή διασταύρωσης για αρχικές μεταβλητές'] },
    { n: 'WP2', t: 'Mathematical Programming · Monte Carlo', st: 'prog', stt: 'Σε εξέλιξη', items: ['MC-disruptions: τυχαία θέση ατυχήματος, διάρκεια, scale (100 runs)', 'MC-temperament: 5 ομάδες οδηγών με διαφορετικά seeds', 'Cascade impact των διαταραχών σε πραγματικό χρόνο'] },
    { n: 'WP3', t: 'SUMO Baseline', st: 'done', stt: 'Υλοποιημένο στο repo', items: ['Δίκτυο Ηλιούπολης (OSM → netedit), ροές, τύποι οχημάτων', 'Σενάρια S0–S3 μέσω TraCI · φορτηγά, λεωφορείο, ασθενοφόρο', 'Dynamic Green Wave + GPS rerouting · A/B test'] },
    { n: 'WP4', t: 'InfluxDB & Grafana', st: 'plan', stt: 'Σχεδιασμένο', items: ['Python → InfluxDB → Grafana: CO₂ και άλλα μεγέθη', 'Multi-sensor fusion: Sensor A arrivals vs Sensor B departures', 'Prototype: tab «Detectors» στο hero'] },
    { n: 'WP5', t: 'Socioeconomic & GIS', st: 'plan', stt: 'Σχεδιασμένο', items: ['Ετήσιο κόστος διαταραχών από τα Monte Carlo runs', 'QGIS: επίδραση σε γειτονικούς δρόμους, νοσοκομεία, πανεπιστήμια'] },
    { n: 'WP6', t: 'Mitigation · έλεγχος φαναριών', st: 'plan', stt: 'Σχεδιασμένο', items: ['Max-Pressure · SCOOT/SCATS · max green 60 s', 'Phase Abort: αν B < 15% του A κατά το πράσινο → αποκλεισμός', 'Resilience matrix: Baseline vs Disrupted vs Mitigated (ίδια seeds)'] },
  ];
  function renderWps() {
    $('#wps').innerHTML = WPS.map((w, i) => '<div class="relative pl-14 reveal d' + (i % 3) + '"><span class="tl-dot ' + (w.st === 'done' ? 'done' : w.st === 'prog' ? 'prog' : '') + '"></span><div class="card p-6"><div class="flex flex-wrap items-center justify-between gap-3 mb-3"><div class="flex items-center gap-3"><span class="mono font-bold text-cy">' + w.n + '</span><h3 class="text-lg font-semibold text-white">' + w.t + '</h3></div><span class="chip !cursor-default ' + (w.st === 'done' ? 'on green' : w.st === 'prog' ? 'on warn' : '') + '">' + w.stt + '</span></div><ul class="grid gap-1.5 text-[14px] text-slate-400">' + w.items.map((x) => '<li class="flex gap-2.5"><span class="text-cy mt-1.5 w-1 h-1 rounded-full bg-cy flex-none"></span>' + x + '</li>').join('') + '</ul></div></div>').join('');
  }

  // ------------------------------------------------------------------ 08 files
  const FILES = [
    ['code', 11265, 'Python/TraCI controller: σενάρια S0–S3, φορτηγά, ασθενοφόρο, Green Wave, στατιστικά.', 'cy'],
    ['README.md', 19146, 'Το «τετράδιο» του project: WP1–WP6, παρατηρήσεις, A/B, συμπεράσματα.', 'slate'],
    ['osm.net.xml', 2137544, 'Το δίκτυο SUMO που φορτώνει το sumocfg (' + M.edges + ' edges · ' + M.tls + ' φανάρια).', 'em'],
    ['ilioupoli.net.xml', 2155329, 'Προηγούμενη έκδοση του δικτύου (street names, netedit).', 'em'],
    ['osm.rou.xml', 3637, 'vTypes + flows + AMBULANCE_01 (ζήτηση).', 'am'],
    ['ilioupoli.sumocfg.cfg', 194, 'Master config: net + routes + additional.', 'am'],
    ['s.add.xml', 399, 'Στάση λεωφορείου bs_0 (additional).', 'am'],
    ['map1.add.xml', 649, 'Παλαιότερο σύνολο 4 στάσεων λεωφορείου.', 'am'],
    ['osm.trips.xml', 269197, 'Τυχαία trips από randomTrips.py (ambient κίνηση).', 'am'],
    ['map.osm', 7367522, 'Ωμό OpenStreetMap της περιοχής (κτίρια, πάρκα, δρόμοι).', 'vi'],
    ['s.nod.xml · e.edg.xml · s.com.xml', 25049 + 227190 + 162262, 'Plain-XML πηγές του δικτύου: κόμβοι, edges, connections.', 'slate'],
    ['s.tll.xml · s.typ.xml · s.netccfg · s.netecfg', 18238 + 2179 + 687 + 719, 'Προγράμματα φαναριών, τύποι δρόμων, ρυθμίσεις netconvert/netedit.', 'slate'],
    ['index.html · assets/ · tools/', 0, 'Αυτή η σελίδα: renderer, sim engine και ο μετατροπέας δεδομένων.', 'cy'],
  ];
  const kb = (b) => (b === 0 ? '' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b > 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  function renderFiles() {
    const max = 7367522;
    $('#files').innerHTML = FILES.map((f) => '<div class="px-4 py-3 flex items-center gap-4 hover:bg-slate-800/30 transition-colors"><span class="mono text-[12.5px] text-' + (f[3] === 'slate' ? 'slate-200' : f[3] === 'cy' ? 'cyan-300' : f[3] === 'em' ? 'emerald-300' : f[3] === 'am' ? 'amber-300' : 'violet-300') + ' w-[210px] sm:w-[260px] flex-none truncate" title="' + esc(f[0]) + '">' + esc(f[0]) + '</span><span class="text-[13px] text-slate-400 flex-1 leading-snug">' + f[2] + '</span><span class="hidden sm:block w-24 flex-none"><span class="bar block"><i style="width:' + Math.max(2, Math.sqrt(f[1] / max) * 100) + '%;background:#475569"></i></span></span><span class="mono text-[11px] text-slate-500 w-16 text-right flex-none">' + kb(f[1]) + '</span></div>').join('');
    $('#files-n').textContent = FILES.length + ' εγγραφές';
  }

  // ------------------------------------------------------------------ boot
  renderPipe(); renderPipeDetail(); renderSteps(); renderCode(); renderScenarios(); renderGW(); renderWps(); renderFiles();
  observeReveals(); observeCounts();
  window.addEventListener('resize', () => drawPipe(PIPE[pipeSel].mode));
  setInterval(() => { if (PIPE[pipeSel].mode === 'graf' || PIPE[pipeSel].mode === 'traci') { const c = $('#pipe-cv'); if (c && c.getBoundingClientRect().top < innerHeight && c.getBoundingClientRect().bottom > 0) drawPipe(PIPE[pipeSel].mode); } }, 600);
})();
