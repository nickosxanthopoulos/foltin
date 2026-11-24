"""
monte_carlo.py  -  Monte Carlo runner for the Ilioupoli SUMO model
===================================================================

Runs every scenario N times (default 30) with a different random seed, headless
(no GUI), and writes one results table per scenario.

Timeline of EVERY run
    0    - 3600 s  warm-up   : S0A traffic (70 %) so the network is already full of cars
    3600 - 7200 s  scenario  : S0A (70 %) or S0B (+30 % -> 91 %) + optional disruption
    7200 - 9000 s  clearance : no new cars, vehicles already inside may finish
    Only vehicles that DEPART inside the scenario hour (3600-7200) are measured.

Scenarios
    S0A           normal traffic (off-peak)
    S0A_CRASH     normal traffic + crash on the main road
    S0A_WORKS     normal traffic + roadworks (right lane closed)
    S0B           +30 % traffic (peak)
    S0B_CRASH     peak traffic + crash on the main road
    S0B_WORKS     peak traffic + roadworks

What changes randomly in each run (Monte Carlo)
    - SUMO seed (driver imperfection, departure lanes ...)
    - Arrival times of all cars: Poisson process (period="exp(..)") instead of fixed spacing
    - CRASH: which edge of the main road, start time, and how long the road is blocked
    Run i uses the SAME seed and the SAME crash in S0A_CRASH and S0B_CRASH, so the
    scenarios are compared fairly (common random numbers).

Usage (from the project folder, SUMO_HOME must be set)
    python monte_carlo.py                         # all 6 scenarios x 30 runs
    python monte_carlo.py --runs 5 --jobs 4       # quick test, 4 SUMO instances in parallel
    python monte_carlo.py --scenarios S0B S0B_CRASH
    python monte_carlo.py --gui --single S0B_CRASH 1   # watch ONE run in sumo-gui

Output (folder output/mc/)
    <SCENARIO>/tripinfo_<run>.xml   raw SUMO output, one line per vehicle
    <SCENARIO>/run_<run>.json       crash, ambulance and statistics of that run
    mc_runs.csv                     one row per run (all scenarios)
    mc_summary.csv                  mean / std / 95 % CI per scenario  -> the comparison table
    mc_results.json                 same data for the website
"""
import argparse
import csv
import json
import math
import os
import random
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed

if "SUMO_HOME" in os.environ:
    sys.path.append(os.path.join(os.environ["SUMO_HOME"], "tools"))
else:
    sys.exit("Please declare environment variable 'SUMO_HOME'")

import traci      # noqa: E402
import sumolib    # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "ilioupoli.sumocfg.cfg")
BASE_ROUTES = os.path.join(HERE, "osm.rou.xml")
OUT = os.path.join(HERE, "output", "mc")

# --------------------------------------------------------------------------- settings
WARMUP_END = 3600          # end of warm-up (s)
SCEN_END = 7200            # end of the measured scenario hour (s)
SIM_END = 10800            # extra hour so queued vehicles can still enter and finish
WARMUP_SCALE = 0.7         # S0A traffic level used for the warm-up
TELEPORT = 300             # --time-to-teleport, the SAME for every scenario (fair comparison)

MAIN_FROM, MAIN_TO = "66113514#0", "842961266#4"   # main commuting road
AMB_ID = "AMBULANCE_01"
AMB_DEPART = WARMUP_END + 900      # ambulance enters 15 min into the scenario hour
AMB_ENTRY_RETRY = 15               # s: if it cannot enter, try the next edge of the route


WORKS_LANE = "436872467#0_0"       # roadworks: right lane closed for the whole scenario hour

# crash Monte Carlo ranges
CRASH_START = (WARMUP_END + 300, WARMUP_END + 1200)   # crash happens 5-20 min into the scenario
CRASH_DURATION = (900, 2400)                          # road blocked for 15-40 min
CRASH_MIN_EDGE_LEN = 50.0                             # only edges long enough for a queue

SCENARIOS = {
    "S0A":       dict(scale=0.70, crash=False, works=False, label="Normal traffic (70 %)"),
    "S0A_CRASH": dict(scale=0.70, crash=True,  works=False, label="Normal traffic + crash"),
    "S0A_WORKS": dict(scale=0.70, crash=False, works=True,  label="Normal traffic + roadworks"),
    "S0B":       dict(scale=0.91, crash=False, works=False, label="Peak traffic (+30 %)"),
    "S0B_CRASH": dict(scale=0.91, crash=True,  works=False, label="Peak traffic + crash"),
    "S0B_WORKS": dict(scale=0.91, crash=False, works=True,  label="Peak traffic + roadworks"),
}

# vehicle type -> group used in the results
GROUP = {"normal_car": "car", "smart_car": "car", "bus_type": "bus",
         "freight_truck": "truck", "ambulance_type": "ambulance"}
GROUPS = ["car", "bus", "truck", "ambulance", "all"]

# DEMAND at 100 % (veh / hour) - overrides the numbers in osm.rou.xml (from/to and vTypes are still read there).
# Calibrated on the measured capacity of the main road: ~870 veh/h normally, ~650 veh/h with the roadworks
# (quick test, Nov 2026). Main road total at 100 % = 1000 veh/h ->
#   S0A (x0.70) =  700 veh/h  ~ 80 % of capacity  -> traffic flows
#   S0B (x0.91) =  910 veh/h  > capacity           -> peak-hour queues
#   WORKS: capacity drops to ~650 veh/h            -> clearly worse than without roadworks
DEMAND_VPH = {
    "main_stubborn": 600,     # main road, drivers that keep their route  (65 % of the main cars)
    "main_smart":    320,     # main road, drivers with GPS rerouting     (35 %)
    "trucks_main":    80,     # freight trucks on the main road (was 720/h + 80/h TraCI before)
    "bg_traffic_1":  460,     # neighbourhood traffic (unchanged)
    "bg_traffic_2":  460,
    "bg_traffic_3":  480,
    "city_bus":       10,
}

# flows / trips of osm.rou.xml that are NOT copied (old tests, ambulance is added by TraCI)
SKIP_IDS = {"trucks_main_TEST", "THE_GHOST_TRUCK", "AMBULANCE_01"}


def seed_of(run):
    return 1000 + run


# --------------------------------------------------------------------------- demand file
def write_demand(scenario, path):
    """Copy the vTypes of osm.rou.xml and rebuild the flows in two periods
    (warm-up at 70 %, scenario hour at the scenario level) with Poisson arrivals."""
    sc = SCENARIOS[scenario]["scale"]
    root = ET.parse(BASE_ROUTES).getroot()
    out = ET.Element("routes")
    for vt in root.iter("vType"):
        out.append(vt)
    flows = []
    for fl in root.iter("flow"):
        if fl.get("id") in SKIP_IDS:
            continue
        b0, b1 = float(fl.get("begin", 0)), float(fl.get("end", 3600))
        # (period start, period end, scale): warm-up + scenario hour
        for tag, p0, p1, scale in (("wu", 0, WARMUP_END, WARMUP_SCALE), ("sc", WARMUP_END, SCEN_END, sc)):
            begin = max(p0, b0) if tag == "wu" else p0     # e.g. bus flow starts at 1200 in the warm-up
            if tag == "wu" and begin >= p1:
                continue
            f = ET.Element("flow", dict(fl.attrib))
            f.set("id", f"{fl.get('id')}_{tag}")
            f.set("begin", f"{begin:g}")
            f.set("end", f"{p1:g}")
            if fl.get("id") in DEMAND_VPH:                       # calibrated demand (see DEMAND_VPH)
                for k in ("vehsPerHour", "probability", "number", "period"):
                    f.attrib.pop(k, None)
                f.set("vehsPerHour", str(DEMAND_VPH[fl.get("id")]))
            if "vehsPerHour" in f.attrib:
                rate = float(f.attrib.pop("vehsPerHour")) * scale / 3600.0      # veh / s
                f.set("period", f"exp({rate:.6f})")                              # Poisson arrivals
            elif "probability" in f.attrib:
                f.set("probability", f"{float(f.get('probability')) * scale:.4f}")
            elif "number" in f.attrib:
                f.set("number", str(max(1, round(int(f.get("number")) * scale))))
            flows.append((begin, f))
    for _, f in sorted(flows, key=lambda x: x[0]):          # SUMO wants sorted departures
        out.append(f)
    ET.indent(out) if hasattr(ET, "indent") else None
    ET.ElementTree(out).write(path, encoding="utf-8", xml_declaration=True)


# --------------------------------------------------------------------------- one SUMO run
def run_single(scenario, run, gui=False):
    cfg = SCENARIOS[scenario]
    seed = seed_of(run)
    rng = random.Random(seed)            # crash randomness: same in S0A_CRASH and S0B_CRASH
    odir = os.path.join(OUT, scenario)
    os.makedirs(odir, exist_ok=True)
    demand = os.path.join(odir, f"demand_{run}.rou.xml")
    write_demand(scenario, demand)
    tripinfo = os.path.join(odir, f"tripinfo_{run}.xml")
    stats = os.path.join(odir, f"statistics_{run}.xml")

    cmd = [sumolib.checkBinary("sumo-gui" if gui else "sumo"), "-c", CONFIG,
           "--route-files", demand,
           "--seed", str(seed),
           "--begin", "0", "--end", str(SIM_END),
           "--time-to-teleport", str(TELEPORT),
           "--tripinfo-output", tripinfo,
           "--tripinfo-output.write-unfinished", "true",
           "--device.emissions.probability", "1",
           "--statistic-output", stats,
           "--no-step-log", "true", "--no-warnings", "true"]
    if gui:
        cmd += ["--start", "true"]
    label = f"{scenario}_{run}"
    traci.start(cmd, label=label)
    con = traci.getConnection(label)

    info = dict(scenario=scenario, run=run, seed=seed)
    main_edges = None
    crash = None
    if cfg["crash"]:
        crash = dict(edge=None, start=rng.uniform(*CRASH_START), duration=rng.uniform(*CRASH_DURATION),
                     done=False, vehicle=None, actual_start=None, tries=0)
    amb = dict(phase="wait", id=None, k=0, try_t=None, entered=None, arrived=None, entry_edge=None, ids=[])
    active_tls = ""
    works_done = False

    step = 0
    while step < SIM_END:
        con.simulationStep()
        t = con.simulation.getTime()

        if main_edges is None:
            r = con.simulation.findRoute(MAIN_FROM, MAIN_TO, "ambulance_type")
            main_edges = list(r.edges)
            if crash is not None:
                # candidate crash edges: on the main road, >= 2 lanes, long enough, not first/last edge
                cands = [e for e in main_edges[1:-1]
                         if not e.startswith(":") and con.edge.getLaneNumber(e) >= 2
                         and con.lane.getLength(e + "_0") >= CRASH_MIN_EDGE_LEN]
                crash["candidates"] = cands
                crash["edge"] = rng.choice(cands) if cands else None

        # ---------------- ambulance: added by TraCI so it can never be removed by scaling
        if amb["phase"] == "wait" and t >= AMB_DEPART:
            _amb_add(con, amb, main_edges, t)
        elif amb["phase"] == "pending":
            if amb["id"] in con.simulation.getDepartedIDList():
                amb["phase"], amb["entered"] = "in", t
                amb["entry_edge"] = main_edges[amb["k"]]
            elif t - amb["try_t"] >= AMB_ENTRY_RETRY and amb["k"] < min(12, len(main_edges) - 2):
                # entry edge blocked by the insertion queue -> remove and enter one edge further
                try:
                    con.vehicle.remove(amb["id"])
                except traci.exceptions.TraCIException:
                    pass
                amb["k"] += 1
                _amb_add(con, amb, main_edges, t)
        elif amb["phase"] == "in":
            if amb["id"] in con.simulation.getArrivedIDList():
                amb["phase"], amb["arrived"] = "done", t
            else:
                active_tls = _green_wave(con, amb["id"], active_tls)
        if amb["phase"] == "done" and active_tls:
            active_tls = _reset_tls(con, active_tls)

        # ---------------- roadworks: right lane closed during the scenario hour
        if cfg["works"] and not works_done and t >= WARMUP_END:
            try:
                con.lane.setDisallowed(WORKS_LANE, ["all"])
            except traci.exceptions.TraCIException as e:
                info["works_error"] = str(e)
            works_done = True

        # ---------------- crash: a vehicle stops on the chosen edge for 'duration' seconds
        if crash is not None and not crash["done"] and crash["edge"] and t >= crash["start"]:
            if _try_crash(con, crash, t):
                crash["done"] = True
            elif t - crash["start"] > 300 and crash["tries"] < 5 and len(crash["candidates"]) > 1:
                # no suitable car on that edge for 5 min -> pick another edge of the main road
                crash["tries"] += 1
                crash["edge"] = rng.choice([e for e in crash["candidates"] if e != crash["edge"]])
                crash["start"] = t

        # stop early when the network is empty after the demand period
        if t > SCEN_END and con.simulation.getMinExpectedNumber() == 0:
            break
        step += 1

    con.close()

    info["ambulance"] = dict(
        entered=amb["entered"], arrived=amb["arrived"], entry_edge=amb["entry_edge"],
        entry_wait=(amb["entered"] - AMB_DEPART) if amb["entered"] is not None else None,
        travel_time=(amb["arrived"] - amb["entered"]) if amb["arrived"] is not None else None,
        response_time=(amb["arrived"] - AMB_DEPART) if amb["arrived"] is not None else None)
    if crash is not None:
        info["crash"] = dict(edge=crash["edge"], vehicle=crash["vehicle"], start=crash["actual_start"],
                             duration=round(crash["duration"]), happened=crash["done"])
    info["statistics"] = _read_statistics(stats)
    info["metrics"] = analyse_tripinfo(tripinfo, amb["ids"])
    with open(os.path.join(odir, f"run_{run}.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, indent=1)
    try:
        os.remove(demand)
    except OSError:
        pass
    return info


def _amb_add(con, amb, main_edges, t):
    k = amb["k"]
    rid = f"amb_route_{k}"
    vid = AMB_ID if k == 0 else f"{AMB_ID}_e{k}"
    try:
        if rid not in con.route.getIDList():
            con.route.add(rid, main_edges[k:])
        con.vehicle.add(vid, rid, typeID="ambulance_type", departLane="free",
                        departPos="free", departSpeed="0")
        con.vehicle.setColor(vid, (255, 0, 0, 255))
        amb.update(phase="pending", id=vid, try_t=t)
        amb["ids"].append(vid)
    except traci.exceptions.TraCIException:
        amb.update(phase="pending", id=vid, try_t=t)


def _try_crash(con, crash, t):
    edge = crash["edge"]
    for vid in con.edge.getLastStepVehicleIDs(edge):
        if vid.startswith(AMB_ID) or vid.startswith("city_bus"):
            continue
        try:
            lane = con.vehicle.getLaneIndex(vid)
            pos = con.vehicle.getLanePosition(vid)
            v = con.vehicle.getSpeed(vid)
            length = con.lane.getLength(f"{edge}_{lane}")
            stop_pos = pos + v * v / (2 * 4.0) + 3.0          # a position the car can still brake for
            if stop_pos > length - 3.0:
                continue
            con.vehicle.setStop(vid, edge, pos=stop_pos, laneIndex=lane, duration=crash["duration"])
            con.vehicle.setColor(vid, (255, 0, 0, 255))
            con.vehicle.setSignals(vid, 3)
            crash["vehicle"], crash["actual_start"] = vid, t
            return True
        except traci.exceptions.TraCIException:
            continue
    return False


def _reset_tls(con, tls):
    try:
        con.trafficlight.setProgram(tls, "0")
    except traci.exceptions.TraCIException:
        pass
    return ""


def _green_wave(con, vid, active_tls):
    """Same green wave as run_ilioupoli.py: force green for the ambulance link < 400 m ahead."""
    try:
        nxt = con.vehicle.getNextTLS(vid)
    except traci.exceptions.TraCIException:
        return active_tls
    if not nxt:
        return _reset_tls(con, active_tls) if active_tls else ""
    tls_id, idx, dist, _ = nxt[0]
    if dist >= 400.0:
        return active_tls
    try:
        if active_tls and active_tls != tls_id:
            _reset_tls(con, active_tls)
        state = list(con.trafficlight.getRedYellowGreenState(tls_id))
        if state[idx] not in ("G", "g"):
            state[idx] = "G"
            con.trafficlight.setRedYellowGreenState(tls_id, "".join(state))
        return tls_id
    except traci.exceptions.TraCIException:
        return active_tls


def _read_statistics(path):
    out = {}
    try:
        root = ET.parse(path).getroot()
        v = root.find("vehicles")
        if v is not None:
            out.update({k: float(v.get(k, 0)) for k in ("loaded", "inserted", "running", "waiting")})
        tp = root.find("teleports")
        if tp is not None:
            out["teleports"] = float(tp.get("total", 0))
    except (OSError, ET.ParseError):
        pass
    return out


# --------------------------------------------------------------------------- tripinfo analysis
def analyse_tripinfo(path, amb_ids=()):
    """Per vehicle group: count, mean travel time, mean / total time loss, depart delay, CO2, fuel.
    Only vehicles that departed during the scenario hour are counted."""
    acc = {g: dict(n=0, unfinished=0, duration=0.0, timeLoss=0.0, waiting=0.0, departDelay=0.0,
                   routeLength=0.0, CO2_mg=0.0, fuel_mg=0.0) for g in GROUPS}
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag != "tripinfo":
            continue
        # count vehicles by the time they WANTED to leave (scheduled departure), not the time they managed
        # to enter: otherwise cars blocked at the entrance by a disruption would disappear from the results
        dep = float(el.get("depart", -1)) - float(el.get("departDelay", 0))
        if WARMUP_END <= dep < SCEN_END or el.get("id") in amb_ids:
            g = GROUP.get(el.get("vType"), "car")
            em = el.find("emissions")
            for key in (g, "all"):
                a = acc[key]
                a["n"] += 1
                a["unfinished"] += 1 if float(el.get("arrival", 0)) < 0 else 0
                a["duration"] += float(el.get("duration", 0))
                a["timeLoss"] += float(el.get("timeLoss", 0))
                a["waiting"] += float(el.get("waitingTime", 0))
                a["departDelay"] += float(el.get("departDelay", 0))
                a["routeLength"] += float(el.get("routeLength", 0))
                if em is not None:
                    a["CO2_mg"] += float(em.get("CO2_abs", 0))
                    a["fuel_mg"] += float(em.get("fuel_abs", 0))
        el.clear()
    res = {}
    for g, a in acc.items():
        n = a["n"]
        res[g] = dict(
            vehicles=n,
            unfinished=a["unfinished"],
            mean_travel_time_s=a["duration"] / n if n else None,
            mean_time_loss_s=a["timeLoss"] / n if n else None,
            total_time_loss_h=a["timeLoss"] / 3600.0,
            # TOTAL DELAY = waiting to enter the network + time lost inside it  -> use this for costs
            mean_total_delay_s=(a["timeLoss"] + a["departDelay"]) / n if n else None,
            total_delay_h=(a["timeLoss"] + a["departDelay"]) / 3600.0,
            mean_waiting_s=a["waiting"] / n if n else None,
            mean_depart_delay_s=a["departDelay"] / n if n else None,
            total_depart_delay_h=a["departDelay"] / 3600.0,
            total_km=a["routeLength"] / 1000.0,
            CO2_kg=a["CO2_mg"] / 1e6,
            fuel_kg=a["fuel_mg"] / 1e6)
    return res


# --------------------------------------------------------------------------- tables
RUN_FIELDS = ["vehicles", "unfinished", "mean_total_delay_s", "total_delay_h",
              "mean_travel_time_s", "mean_time_loss_s", "total_time_loss_h",
              "mean_depart_delay_s", "total_depart_delay_h", "total_km", "CO2_kg", "fuel_kg"]


def flatten(info):
    row = dict(scenario=info["scenario"], run=info["run"], seed=info["seed"])
    a = info.get("ambulance", {})
    row.update(amb_entry_wait_s=a.get("entry_wait"), amb_travel_time_s=a.get("travel_time"),
               amb_response_time_s=a.get("response_time"), amb_entry_edge=a.get("entry_edge"))
    c = info.get("crash")
    row.update(crash_edge=c["edge"] if c else "", crash_start_s=c["start"] if c else "",
               crash_duration_s=c["duration"] if c else "")
    st = info.get("statistics", {})
    row.update(teleports=st.get("teleports"), never_inserted=st.get("waiting"))
    for g in GROUPS:
        for k in RUN_FIELDS:
            row[f"{g}_{k}"] = info["metrics"].get(g, {}).get(k)
    return row


def summarise(rows):
    """mean, std and 95 % confidence interval of every numeric column per scenario."""
    out = []
    for sc in SCENARIOS:
        rs = [r for r in rows if r["scenario"] == sc]
        if not rs:
            continue
        for col in rs[0]:
            if col in ("scenario", "run", "seed", "crash_edge", "amb_entry_edge"):
                continue
            vals = [float(r[col]) for r in rs if r[col] not in (None, "")]
            if not vals:
                continue
            n = len(vals)
            m = sum(vals) / n
            sd = math.sqrt(sum((x - m) ** 2 for x in vals) / (n - 1)) if n > 1 else 0.0
            ci = 1.96 * sd / math.sqrt(n) if n > 1 else 0.0
            out.append(dict(scenario=sc, metric=col, runs=n, mean=round(m, 3), std=round(sd, 3),
                            ci95_low=round(m - ci, 3), ci95_high=round(m + ci, 3),
                            min=round(min(vals), 3), max=round(max(vals), 3)))
    return out


def write_tables():
    rows = []
    for sc in SCENARIOS:
        d = os.path.join(OUT, sc)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.startswith("run_") and fn.endswith(".json"):
                with open(os.path.join(d, fn), encoding="utf-8") as f:
                    rows.append(flatten(json.load(f)))
    if not rows:
        print("No finished runs found in", OUT)
        return
    rows.sort(key=lambda r: (list(SCENARIOS).index(r["scenario"]), r["run"]))
    with open(os.path.join(OUT, "mc_runs.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    summ = summarise(rows)
    with open(os.path.join(OUT, "mc_summary.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(summ[0]))
        w.writeheader()
        w.writerows(summ)
    with open(os.path.join(OUT, "mc_results.json"), "w", encoding="utf-8") as f:
        json.dump(dict(generated=time.strftime("%Y-%m-%d %H:%M"),
                       settings=dict(warmup_end=WARMUP_END, scenario_end=SCEN_END, warmup_scale=WARMUP_SCALE,
                                     teleport=TELEPORT, ambulance_depart=AMB_DEPART,
                                     crash_start=CRASH_START, crash_duration=CRASH_DURATION),
                       scenarios={k: v["label"] for k, v in SCENARIOS.items()},
                       runs=rows, summary=summ), f, indent=1)
    print(f"\nWrote {len(rows)} runs -> {os.path.join(OUT, 'mc_runs.csv')}")
    print(f"Comparison table      -> {os.path.join(OUT, 'mc_summary.csv')}")
    # short console table
    key = ["all_mean_total_delay_s", "all_total_delay_h", "amb_response_time_s", "all_CO2_kg", "never_inserted"]
    print(f"\n{'scenario':<11}" + "".join(f"{k:>24}" for k in key))
    for sc in SCENARIOS:
        line = f"{sc:<11}"
        for k in key:
            s = next((x for x in summ if x["scenario"] == sc and x["metric"] == k), None)
            line += f"{(str(s['mean']) + ' ±' + str(round(s['ci95_high'] - s['mean'], 1))) if s else '-':>24}"
        print(line)


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Monte Carlo runner for the Ilioupoli SUMO model")
    ap.add_argument("--runs", type=int, default=30, help="repetitions per scenario (default 30)")
    ap.add_argument("--scenarios", nargs="+", default=list(SCENARIOS), choices=list(SCENARIOS))
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) // 2),
                    help="SUMO instances in parallel")
    ap.add_argument("--single", nargs=2, metavar=("SCENARIO", "RUN"), help="run only one simulation")
    ap.add_argument("--gui", action="store_true", help="with --single: open sumo-gui")
    ap.add_argument("--tables", action="store_true", help="only rebuild the CSV / JSON tables")
    ap.add_argument("--force", action="store_true", help="re-run runs that are already finished")
    args = ap.parse_args()

    if args.tables:
        write_tables()
        return
    if args.single:
        info = run_single(args.single[0], int(args.single[1]), gui=args.gui)
        a = info["ambulance"]
        print(f"{args.single[0]} run {args.single[1]}: ambulance response {a['response_time']} s, "
              f"crash {info.get('crash')}, mean time loss {info['metrics']['all']['mean_time_loss_s']}")
        return

    jobs = [(sc, r) for sc in args.scenarios for r in range(1, args.runs + 1)
            if args.force or not os.path.exists(os.path.join(OUT, sc, f"run_{r}.json"))]
    print(f"{len(jobs)} simulations to run, {args.jobs} in parallel  (finished runs are skipped)")
    t0 = time.time()

    def launch(job):
        sc, r = job
        p = subprocess.run([sys.executable, os.path.abspath(__file__), "--single", sc, str(r)],
                           capture_output=True, text=True)
        return job, p.returncode, (p.stdout.strip().splitlines() or [""])[-1], p.stderr[-800:]

    done = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for fut in as_completed([ex.submit(launch, j) for j in jobs]):
            (sc, r), code, last, err = fut.result()
            done += 1
            el = time.time() - t0
            eta = el / done * (len(jobs) - done)
            status = last if code == 0 else "FAILED: " + err.strip().splitlines()[-1] if err.strip() else "FAILED"
            print(f"[{done}/{len(jobs)}] {sc} run {r}  ({el/60:.1f} min, ~{eta/60:.0f} min left)  {status}")
    write_tables()


if __name__ == "__main__":
    main()
