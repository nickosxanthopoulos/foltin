#!/usr/bin/env python3
"""
build_data.py  --  SUMO network  ->  assets/data.js  (compact JSON used by the web demo)

Reads the *real* files of this repo:
    osm.net.xml      road graph, lanes, junctions, traffic-light programs
    osm.rou.xml      flows / vehicle types  (documented, routes are recomputed here)
    s.add.xml        bus stops
    osm.trips.xml    random trips  (used as "ambient" background traffic)
    map.osm          buildings, parks, schools ... (drawn as the city backdrop)

Usage:  python tools/build_data.py
"""
import heapq, json, math, os, collections
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
def P(name): return os.path.join(ROOT, name)

# --------------------------------------------------------------------------- UTM
def utm(lat, lon, zone=34):
    a = 6378137.0; f = 1 / 298.257223563; k0 = 0.9996
    n = f / (2 - f); A = a / (1 + n) * (1 + n**2 / 4 + n**4 / 64)
    al = [n / 2 - 2 * n**2 / 3 + 5 * n**3 / 16, 13 * n**2 / 48 - 3 * n**3 / 5, 61 * n**3 / 240]
    lam0 = math.radians((zone - 1) * 6 - 180 + 3)
    phi = math.radians(lat); lam = math.radians(lon) - lam0
    t = math.sinh(math.atanh(math.sin(phi)) - 2 * math.sqrt(n) / (1 + n) * math.atanh(2 * math.sqrt(n) / (1 + n) * math.sin(phi)))
    xi = math.atan2(t, math.cos(lam)); eta = math.atanh(math.sin(lam) / math.sqrt(1 + t * t))
    E = 500000 + k0 * A * (eta + sum(al[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3)))
    N = k0 * A * (xi + sum(al[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3)))
    return E, N

# --------------------------------------------------------------------------- geometry helpers
def dp(pts, eps):
    """Douglas-Peucker on a list of (x,y)."""
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy) or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L
        if d > dmax: dmax, idx = d, i
    if dmax > eps:
        return dp(pts[:idx + 1], eps)[:-1] + dp(pts[idx:], eps)
    return [pts[0], pts[-1]]

def dp_ring(pts, eps):
    """Douglas-Peucker for a closed ring (pts WITHOUT the repeated closing point)."""
    if len(pts) <= 4: return pts
    k = max(range(1, len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = dp(pts[:k + 1], eps); b = dp(pts[k:] + [pts[0]], eps)
    return a[:-1] + b[:-1]

def flat(pts, nd=1):
    out = []
    for x, y in pts:
        out.append(round(x, nd)); out.append(round(y, nd))
    return out

def parse_shape(s):
    return [tuple(map(float, p.split(","))) for p in s.split()]

# --------------------------------------------------------------------------- net
net = ET.parse(P("osm.net.xml")).getroot()
loc = net.find("location")
ox, oy = map(float, loc.get("netOffset").split(","))
bx0, by0, bx1, by1 = map(float, loc.get("convBoundary").split(","))

junc = {j.get("id"): (float(j.get("x")), float(j.get("y")), j.get("type")) for j in net.findall("junction")}

edges, eidx = [], {}
for e in net.findall("edge"):
    if e.get("function") == "internal": continue
    lanes = e.findall("lane")
    if "passenger" not in (lanes[0].get("allow") or "passenger"): continue
    eidx[e.get("id")] = len(edges)
    shapes = []
    for ln in lanes:
        pts = dp(parse_shape(ln.get("shape")), 0.25)
        shapes.append(flat(pts))
    jx, jy, _ = junc.get(e.get("to"), (0, 0, ""))
    fx, fy, _ = junc.get(e.get("from"), (0, 0, ""))
    edges.append(dict(
        id=e.get("id"), ty=e.get("type") or "x", p=int(e.get("priority") or 0), n=len(lanes),
        v=round(float(lanes[0].get("speed")), 2), l=round(float(lanes[0].get("length")), 1),
        s=shapes, j=[round(jx, 1), round(jy, 1)], f=[round(fx, 1), round(fy, 1)], nx=[]))
types = sorted({e["ty"] for e in edges}); tix = {t: i for i, t in enumerate(types)}
for e in edges: e["ty"] = tix[e["ty"]]

# traffic lights
tl_idx, tls = {}, []
for t in net.findall("tlLogic"):
    tl_idx[t.get("id")] = len(tls)
    tls.append(dict(id=t.get("id"), off=int(float(t.get("offset") or 0)),
                    ph=[[int(float(p.get("duration"))), p.get("state")] for p in t.findall("phase")], x=0, y=0, _n=0))

# connections (edge level, lane masks, signal links)
trans = collections.OrderedDict()
for c in net.findall("connection"):
    a, b = c.get("from"), c.get("to")
    if a not in eidx or b not in eidx: continue
    k = (eidx[a], eidx[b])
    t = trans.setdefault(k, dict(mask=0, tl=-1, link=-1))
    t["mask"] |= 1 << int(c.get("fromLane"))
    if c.get("tl") in tl_idx and t["tl"] < 0:
        t["tl"] = tl_idx[c.get("tl")]; t["link"] = int(c.get("linkIndex"))
for (a, b), t in trans.items():
    edges[a]["nx"].append([b, t["mask"], t["tl"], t["link"]])
    if t["tl"] >= 0:
        T = tls[t["tl"]]; T["x"] += edges[a]["j"][0]; T["y"] += edges[a]["j"][1]; T["_n"] += 1
for T in tls:
    n = T.pop("_n") or 1; T["x"] = round(T["x"] / n, 1); T["y"] = round(T["y"] / n, 1)

# --------------------------------------------------------------------------- routing (offline, SUMO default metric: travel time)
def route(src, dst):
    s = eidx[src] if isinstance(src, str) else src
    d = eidx[dst] if isinstance(dst, str) else dst
    pq = [(0, s)]; dist = {s: 0}; prev = {}
    while pq:
        c, u = heapq.heappop(pq)
        if u == d: break
        if c > dist[u]: continue
        for v, *_ in edges[u]["nx"]:
            nc = c + edges[v]["l"] / edges[v]["v"]
            if nc < dist.get(v, 1e18): dist[v] = nc; prev[v] = u; heapq.heappush(pq, (nc, v))
    if d not in dist: return None
    r = [d]
    while r[-1] != s: r.append(prev[r[-1]])
    return r[::-1]

routes = {
    "main":  route("66113514#0", "842961266#4"),        # main_stubborn / main_smart / trucks / AMBULANCE_01
    "bg1":   route("559496356#0", "32124266#10"),
    "bg2":   route("447570217#0", "-132150622#0"),
    "bg3":   route("1289157642#0", "5170043#8"),
    "bus":   route("66113514#0", "-132150622#0"),
}
print("routes:", {k: (len(v) if v else None) for k, v in routes.items()})

# ambient routes: real trips from osm.trips.xml (reachable ones only)
ambient = []
for t in ET.parse(P("osm.trips.xml")).getroot().findall("trip"):
    a, b = t.get("from"), t.get("to")
    if a in eidx and b in eidx:
        r = route(a, b)
        if r and 14 <= len(r) <= 70: ambient.append(r)
    if len(ambient) >= 220: break
print("ambient routes:", len(ambient))

# bus stops
stops = []
for b in ET.parse(P("s.add.xml")).getroot().findall("busStop"):
    lane = b.get("lane"); e, l = lane.rsplit("_", 1)
    if e in eidx:
        stops.append(dict(id=b.get("id"), e=eidx[e], lane=int(l), a=float(b.get("startPos")), b=float(b.get("endPos"))))

# --------------------------------------------------------------------------- OSM backdrop
nodes = {}; ways = []
for ev, el in ET.iterparse(P("map.osm"), events=("end",)):
    if el.tag == "node":
        nodes[el.get("id")] = (float(el.get("lat")), float(el.get("lon")))
        el.clear()
    elif el.tag == "way":
        tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
        refs = [n.get("ref") for n in el.findall("nd")]
        ways.append((tags, refs)); el.clear()
def xy(ref):
    lat, lon = nodes[ref]; E, N = utm(lat, lon)
    return (E + ox, N + oy)
def inside(p, m=40): return -m <= p[0] <= bx1 + m and -m <= p[1] <= by1 + m
def q(pts): return [int(round(v * 2)) for p in pts for v in p]        # half-metre integers

buildings, parks, water, pois = [], [], [], []
for tags, refs in ways:
    if any(r not in nodes for r in refs): continue
    closed = len(refs) > 3 and refs[0] == refs[-1]
    if "building" in tags and closed:
        pts = [xy(r) for r in refs[:-1]]
        if any(inside(p) for p in pts): buildings.append(q(dp_ring(pts, 0.4)))
    elif closed and (tags.get("leisure") in ("park", "pitch", "playground") or tags.get("landuse") in ("grass", "recreation_ground", "cemetery") or tags.get("natural") in ("wood", "scrub")):
        pts = [xy(r) for r in refs[:-1]]
        if any(inside(p) for p in pts): parks.append(q(dp_ring(pts, 1.0)))
    elif closed and tags.get("natural") == "water":
        pts = [xy(r) for r in refs[:-1]]
        if any(inside(p) for p in pts): water.append(q(dp_ring(pts, 1.0)))
    if tags.get("amenity") in ("school", "kindergarten", "clinic", "hospital", "university", "theatre", "place_of_worship") and closed:
        pts = [xy(r) for r in refs[:-1]]
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        if inside((cx, cy), 0): pois.append(dict(k=tags["amenity"], n=tags.get("name", ""), x=round(cx, 1), y=round(cy, 1)))
print("buildings", len(buildings), "parks", len(parks), "pois", len(pois))

# --------------------------------------------------------------------------- write
data = dict(
    meta=dict(w=round(bx1, 1), h=round(by1, 1), edges=len(edges), tls=len(tls), junctions=len(junc),
              lanes=sum(e["n"] for e in edges), osmNodes=len(nodes), buildings=len(buildings),
              km=round(sum(e["l"] * e["n"] for e in edges) / 1000, 1), types=types),
    edges=edges, tls=tls, stops=stops, routes=routes, ambient=ambient,
    buildings=buildings, parks=parks, water=water, pois=pois,
    code=open(P("code"), encoding="utf-8").read().splitlines())      # the TraCI script, shown verbatim on the page
out = P(os.path.join("assets", "data.js"))
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    f.write("// generated by tools/build_data.py from the SUMO files of this repo - do not edit\n")
    f.write("window.ILIO=" + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n")
print("wrote", out, round(os.path.getsize(out) / 1024), "KB")
