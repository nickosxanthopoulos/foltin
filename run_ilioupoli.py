import os
import sys
import traci
import math


# Ensure SUMO is in your system path
if 'SUMO_HOME' in os.environ:

    tools = os.path.join(os.environ['SUMO_HOME'], 'tools')
    sys.path.append(tools)
else:
    sys.exit("Please declare environment variable 'SUMO_HOME'")

# Dynamically find the config file in the same folder as this script
script_dir = os.path.dirname(os.path.abspath(__file__))
config_path = os.path.join(script_dir, "ilioupoli.sumocfg.cfg")

# ==========================================
# ΕΠΙΛΟΓΗ ΣΕΝΑΡΙΟΥ (S0, S1, S2, ή S3)
# ==========================================
CURRENT_SCENARIO = "S2"  # Άλλαξε αυτό σε S1, S2 ή S3

sumoBinary = "sumo-gui"
sumoCmd = [sumoBinary, "-c", config_path]

# --- Εφαρμογή S1: Αύξηση κίνησης 30% ---
if CURRENT_SCENARIO == "S1":
    sumoCmd.extend(["--scale", "0.9", "--time-to-teleport", "-1"])
    print("[SCENARIO] S1 Active: Kinisi ayksimeni kata 30% apo to Baseline (Teleports Disabled)")
elif CURRENT_SCENARIO == "S2":
    sumoCmd.extend(["--scale", "0.8", "--time-to-teleport", "150"])
    print("[SCENARIO] S2 Active: Atyxhma sth deksia lwrida")
elif CURRENT_SCENARIO == "S3":
    # Βάζουμε teleport 150 αντί για -1 για να αποφύγουμε το μόνιμο gridlock
    sumoCmd.extend(["--scale", "0.8", "--time-to-teleport", "150"]) 
    print("[SCENARIO] S3 Active: One-lane construction (Erga)")
elif CURRENT_SCENARIO == "S0":
    sumoCmd.extend(["--scale", "0.7", "--time-to-teleport", "-1"])
    print("[SCENARIO] S0 Active: Baseline off-peak traffic 70%")
else:
    print(f"[SCENARIO] {CURRENT_SCENARIO} Active: Normal traffic")

# ==========================================
# OUTPUT FILES (per scenario) - needed for delays & economic costs
# tripinfo: one line per vehicle (duration, timeLoss, waitingTime, vType, fuel)
# ==========================================
out_dir = os.path.join(script_dir, "output")
os.makedirs(out_dir, exist_ok=True)
sumoCmd.extend([
    "--tripinfo-output", os.path.join(out_dir, f"tripinfo_{CURRENT_SCENARIO}.xml"),
    "--tripinfo-output.write-unfinished", "true",   # vehicles still driving at the end are also written
    "--device.emissions.probability", "1",          # adds fuel / CO2 per vehicle to tripinfo
    "--summary-output", os.path.join(out_dir, f"summary_{CURRENT_SCENARIO}.xml"),
    "--statistic-output", os.path.join(out_dir, f"statistics_{CURRENT_SCENARIO}.xml"),
])

traci.start(sumoCmd)

ambulance_start_time = -1
ambulance_entered = False
bus_entered = False
step = 0
active_tls = ""
bus_start_time = -1


obstacle_created = False 
truck_entered = False 

AMBULANCE_ID = "AMBULANCE_01"
AMBULANCE_DEPART = 1900
ambulance_added = False
ambulance_arrived = False
bus_id = None   # first bus that really enters (city_bus.0 may be removed by --scale)

while step < 6000:
    traci.simulationStep()

    # ==================================================
    # AMBULANCE SPAWN (TraCI) - not affected by --scale
    # ==================================================
    if step == AMBULANCE_DEPART and not ambulance_added:
        try:
            amb_route = traci.simulation.findRoute("66113514#0", "842961266#4", "ambulance_type")
            if amb_route.edges:
                traci.route.add("ambulance_route", amb_route.edges)
                traci.vehicle.add(
                    vehID=AMBULANCE_ID,
                    routeID="ambulance_route",
                    typeID="ambulance_type",
                    departLane="free",
                    departPos="free",
                    departSpeed="0"   # "max" needs a big gap and fails in heavy traffic
                )
                ambulance_added = True
                print(f"[INFO] AMBULANCE_01 added to the insertion queue at step {step}")
            else:
                print(f"[AMBULANCE ERROR] No route found for ambulance_type!")
        except Exception as e:
            print(f"[AMBULANCE ERROR] Step {step}: {e}")

    # Warn if the ambulance is waiting to enter because the first road is full
    if ambulance_added and not ambulance_entered and step > AMBULANCE_DEPART and step % 30 == 0:
        if AMBULANCE_ID in traci.simulation.getPendingVehicles():
            print(f"[WARNING] Step {step}: AMBULANCE_01 still waiting to enter "
                  f"({step - AMBULANCE_DEPART}s) - entry road 66113514#0 is full")

    # ==================================================
    # DYNAMIC FREIGHT TRUCK FLOW (80 trucks / hour)
    # ==================================================
    if step > 0 and step <= 3600 and step % 45 == 0:
        truck_id = f"trucks_main_{step}"
        try:
            route_id = "main_truck_route"
            
            # 1. Ελέγχουμε αν η διαδρομή υπάρχει ήδη (Safe method)
            if route_id not in traci.route.getIDList():
                route = traci.simulation.findRoute("66113514#0", "842961266#4", "freight_truck")
                if route.edges:
                    traci.route.add(route_id, route.edges)
            
            # 2. Αν η διαδρομή μπήκε επιτυχώς, βάζουμε το όχημα
            if route_id in traci.route.getIDList():
                traci.vehicle.add(
                    vehID=truck_id, 
                    routeID=route_id, 
                    typeID="freight_truck",
                    departLane="free", 
                    departPos="free", 
                    departSpeed="max"
                )
                traci.vehicle.setColor(truck_id, (139, 69, 19, 255)) 
                
        except Exception as e:
            # Αν κάτι πάει στραβά, τυπώνει το λάθος στο terminal αντί να κρασάρει το SUMO!
            print(f">>> [TRUCK ERROR] Λάθος στο Step {step}: {e}")
    
    active_vehicles = traci.vehicle.getIDList()
    arrived_vehicles = traci.simulation.getArrivedIDList()
    # === TRACKER ΓΙΑ ΤΑ FREIGHT TRUCKS ===
    if step == 20:
        pending = list(traci.simulation.getPendingVehicles())
        print(f"\n[DEBUG] Oxhmata sthn oura anamonhs (Pending) sto step 20: {pending}\n")
    if not truck_entered:
        for veh_id in active_vehicles:
            if veh_id.startswith("trucks_main"):
                truck_entered = True
                print(f"\n==================================================")
                print(f"[INFO] Το prwto fortigo ({veh_id}) mphke sto simulation sto step {step}!")
                print(f"==================================================\n")
                break

    # Βάζουμε >= 1000 για να περιμένει μέχρι να εμφανιστεί το ΠΡΩΤΟ διαθέσιμο αμάξι
    if CURRENT_SCENARIO == "S2" and step >= 1000 and not obstacle_created:
            cars_on_edge = traci.edge.getLastStepVehicleIDs("436872460")
            
            if len(cars_on_edge) > 0:
                unlucky_car = cars_on_edge[0]
                try:
                    # Πάμε το αμάξι δεξιά, το σταματάμε και του ανάβουμε αλάρμ
                    traci.vehicle.changeLane(unlucky_car, 0, 0)
                    traci.vehicle.setSpeedMode(unlucky_car, 0)
                    traci.vehicle.setSpeed(unlucky_car, 0.0)
                    traci.vehicle.setColor(unlucky_car, (255, 0, 0, 255))
                    traci.vehicle.setSignals(unlucky_car, 3)
                    
                    print(f"[SCENARIO S2] ATYXHMA: Το όχημα {unlucky_car} τράκαρε και έμεινε ακινητοποιημένο!")
                    obstacle_created = True
                except:
                    pass

        # ==========================================
        # S3: ONE-LANE CONSTRUCTION (Έργα στο δρόμο)
        # ==========================================
    if CURRENT_SCENARIO == "S3" and step == 1000:
        try:
            # Απλά απαγορεύει την κυκλοφορία στη λωρίδα (σαν να μπήκαν κώνοι)
            traci.lane.setDisallowed("436872467#0_0", ["all"])
            print(f"[SCENARIO S3] ERGA: H δεξιά λωρίδα έκλεισε στο step {step} λόγω έργων!")
        except:
            pass
    # === TRACKER ΓΙΑ ΤΟ ΛΕΩΦΟΡΕΙΟ (first bus that really enters) ===
    if not bus_entered:
        for veh_id in traci.simulation.getDepartedIDList():
            if veh_id.startswith("city_bus"):
                bus_id = veh_id
                bus_entered = True
                bus_start_time = step
                print(f"\n==================================================")
                print(f"[INFO] To lewforeio ({bus_id}) mphke sto step {step}")
                break

    if bus_id is not None and bus_id in arrived_vehicles:
        bus_duration = step - bus_start_time  # <--- Ypologizei th diarkeia
        print(f"\n==================================================")
        print(f"[INFO] To lewforeio eftase ston proorismo tou sto step {step}")
        print(f"--> Synolikos Xronos Lewforeiou: {bus_duration} deuterolepta.") # <--- Typwnei to apotelesma
        print(f"==================================================\n") 
        
        if active_tls != "":
            try:
                traci.trafficlight.setProgram(active_tls, "0")
                active_tls = ""
            except traci.exceptions.TraCIException:
                pass



    # 1. ELEGKHOS EISODOU KAI EKSODOU ASTHENOFOROU
    if "AMBULANCE_01" in active_vehicles and not ambulance_entered:
        ambulance_start_time = step
        ambulance_entered = True
        print(f"\n==================================================")
        print(f"[INFO] >>> TO ASTHENOFORO (AMBULANCE_01) MPHKE STO SIMULATION STO STEP {step}! <<<")
        print(f"==================================================\n")

    if "AMBULANCE_01" in arrived_vehicles:
        ambulance_arrived = True
        total_time = step - ambulance_start_time
        print(f"\n==================================================")
        print(f"!!! TO ASTHENOFORO (AMBULANCE_01) EFTASE STON PROORISMO TOU !!!")
        print(f"--> Synolikos Xronos Diadromhs: {total_time} deuterolepta (Step {step}).")
        print(f"==================================================\n")


    # 2. DYNAMIKO GREEN WAVE
    if "AMBULANCE_01" in active_vehicles:
        upcoming_tls = traci.vehicle.getNextTLS("AMBULANCE_01")
        
        if step % 50 == 0:
            print(f"[DEBUG Step {step}] Epomena fanaria asthenoforou: {upcoming_tls}")
            
        if len(upcoming_tls) > 0:
            next_tls_info = upcoming_tls[0]
            tls_id = next_tls_info[0]       
            tls_index = next_tls_info[1]    
            distance = next_tls_info[2]     

            if distance < 400.0:
                try:
                    if active_tls != "" and active_tls != tls_id:
                        traci.trafficlight.setProgram(active_tls, "0")
                    
                    active_tls = tls_id
                    
                    # ΑΥΤΗ ΕΙΝΑΙ Η ΓΡΑΜΜΗ ΠΟΥ ΕΛΕΙΠΕ:
                    current_state = list(traci.trafficlight.getRedYellowGreenState(tls_id))
                    
                    if current_state[tls_index] not in ('G', 'g'):
                        # 1. Κρατάμε τα υπόλοιπα φανάρια ως έχουν (για να μην παγιδευτούν τα οχήματα που ήδη διασχίζουν τον κόμβο)
                        new_state = current_state.copy()
            
                        # 2. Κάνουμε ΠΡΑΣΙΝΟ ΜΟΝΟ τη λωρίδα του ασθενοφόρου
                        new_state[tls_index] = 'G'
            
                        # 3. Το εφαρμόζουμε
                        new_state_str = "".join(new_state)
                        traci.trafficlight.setRedYellowGreenState(tls_id, new_state_str)
                        print(f"  [GREEN WAVE] Forced Prasino sto fanari {tls_id} (Apostash: {distance:.1f}m)")
                        
                except traci.exceptions.TraCIException:
                    pass

    elif active_tls != "":
        try:
            traci.trafficlight.setProgram(active_tls, "0")
            active_tls = ""
        except traci.exceptions.TraCIException:
            pass

        # ============================================
    # 3. Statistika katastashs kykloforias
    # 3. Statistika katastashs kykloforias
    if step % 100 == 0:
        stopped_cars = 0
        total_delay = 0
        
        for veh_id in active_vehicles:
            try:
                wait_time = traci.vehicle.getWaitingTime(veh_id)
                if wait_time > 0:
                    stopped_cars += 1
                    total_delay += wait_time
            except traci.exceptions.TraCIException:
                pass
                
        print(f"Step {step}: {len(active_vehicles)} total cars. "
              f"{stopped_cars} stopped (Total delay: {total_delay}s).")
    step += 1

if not ambulance_entered:
    print("[WARNING] AMBULANCE_01 NEVER entered the network in this run!")
elif not ambulance_arrived:
    print(f"[WARNING] AMBULANCE_01 entered at step {ambulance_start_time} but did NOT arrive before step {step}")

traci.close()
print("Simulation finished.")