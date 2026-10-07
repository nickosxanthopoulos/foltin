# 
# foltin
Traffic Congestion Simulation

#Work Packages for Traffic Simulation 2026-2027

## WP1 protocol

## WP2 protocol -Mathematical Programming Module

**Add the cascade** impact of these disruptions in real time. 
Try to find a dataset that is connected to a crossroad, so we can have starting variables. After that we could maybe have the disruption scenarios done with Monte-Carlo Simulation . 
Find some disruptive scenarios examples


The academic paper validates that traffic is random and SUMO experiments are very insufficient,  so they use Monte-Carlo simulations to make 100 different scenarios. 
SUMO will be used anyways.

Generative AI can help define the 5 temperaments of drivers, speedFactor, accel ?  ? , 
**LOOK INTO QGIS**
## WP3 protocol - SUMO Baseline
Probabilistic Spawning: Instead of spawning vehicles at fixed, robotic intervals, the paper strongly recommends using probabilistic (randomized) departure processes to accurately create real-world traffic jams and platoons.

Strategic Sensor Placement: To feed accurate data into your Python scripts, the authors recommend using specific lane area detectors (E2) positioned carefully at intersections to measure physical queue lengths - this might not happen but its possible

<img width="826" height="342" alt="image" src="https://github.com/user-attachments/assets/f750b76e-6a19-4cab-b501-98c903f74559" />


<img width="884" height="678" alt="image" src="https://github.com/user-attachments/assets/583e47d3-0db3-47d1-91d5-cd586f02a6d3" />

SUMO function : vClass="emergency" for emergency vehicles like ambulances, high class people

It is highly recommended to:
The authors warn that automatically imported OpenStreetMap geometries often contain inconsistencies and unrealistic junction configurations. They recommend manually constructing the infrastructure using SUMO's -netedit- tool with satellite imagery as a background.

------ For our project we can use : https://dopravniinfo.gov.cz/en/, which is provided by mr. foltin, which provides updated timelines every 2 mins

=> CAREFUL!:!:!- For highway merges, they recommend using "unregulated" junctions so that simulated drivers merge assertively; otherwise, if configured as regulated, digital drivers will wait excessively for large gaps and artificially skew your congestion data. For merges you can use the "zipper" method, which is highly productive and loses less time in traffic.

To generate realistic traffic jams, the paper advises creating at least five distinct driver behavior groups with varying levels of aggressiveness (adjusting acceleration, deceleration, and lane-changing behavior) rather than using a single homogeneous driver profile.

                                                      -The previous might be done with monte carlo simulation-



FOR SUMO TO WORK WE NEED 3 DIFFERENT XML FILES:


1. The Network File (.net.xml) : physical geometry of intersection, can be drawn in -netedit-(graphical interface) and doesn't need to be written in code
.net.xml (The Map): Built visually in netedit, or generated automatically from OpenStreetMap data using a SUMO command-line tool called netconvert.

3. The Demand File (.rou.xml) : this will be definitely be written in code(who is driving and direction, routes, spawn rate of vehicles)
<img width="713" height="179" alt="image" src="https://github.com/user-attachments/assets/e5c2242b-934f-463e-b899-76e665e48345" />

4. The Configuration File (.sumocfg) : this is the master file, it will be able to take both of the above files(.net.xml , .rou.xml) aswell as other parameters like start/end times.

The driver's temperament(passive-aggressive) will be modified through a different Monte-Carlo Simulation with lets say 5 different scenarios. This will be shown in the .rou.xml file by changing the random seed. Some parameters that can be stored in this file can be the time the passenger leaves for work, and how they change lanes.

-IMPORTANT- This random driver shuffling happens in every single scenario you test (Baseline, Disrupted, and Mitigated). It proves to your professor that your results are not just a lucky coincidence based on one specific arrangement of cars.

<img width="691" height="536" alt="image" src="https://github.com/user-attachments/assets/64cdc835-4f23-473f-a68f-382de0830157" />

<img width="796" height="283" alt="image" src="https://github.com/user-attachments/assets/904c3715-89ad-47c2-94aa-8daeba269edd" />

NOW FOR THE DISRUPTIONS
-Physical Disruptions (Crash/Closure): You physically block a lane in the SUMO network using TraCI or Netedit for a specific amount of time.

-Weather Disruptions (Rainfall): You use TraCI to globally reduce the speed limits, lower the friction/acceleration parameters, and force drivers to leave larger safety gaps due to wet roads.

This could be determined with Monte-Carlo Simulation(higher difficulty but much nicer) - it can determine the ANNUAL cost of traffic disruptions.
==> Lets call this monte carlo simulation MC-disruptions and the other one that tracks the drivers temperament as MC-temperament.

**MICROSCOPIC ANALYSIS - Cordoning - Sub-networking :**  Υπολογίζει με ακρίβεια χιλιοστού και δευτερολέπτου τη συμπεριφορά κάθε οχήματος (επιτάχυνση, απόσταση ασφαλείας μέσω car-following μοντέλων, αλλαγή λωρίδας). Είναι εξαιρετικά λεπτομερές αλλά βαρύ υπολογιστικά.
 
<img width="759" height="149" alt="image" src="https://github.com/user-attachments/assets/d599f57a-0c7d-4ddc-8b07-c72dd6a25c52" />


**MESOSCOPIC ANALYSIS :**

<img width="797" height="414" alt="image" src="https://github.com/user-attachments/assets/576501b8-f745-44be-8b1a-252964db708c" />

CORDONING happens only when we need to solve the problem into sub-problems, so that it is not heavy programmatistika.


<img width="789" height="463" alt="image" src="https://github.com/user-attachments/assets/123a9151-956e-4440-bf0b-9c08916293e7" />

**PARATIRISEIS APO DIAFORA PEIRAMATA STO SUMO(BOLOGNA)** 
We can see that the simulation is running just right, infact for 1 real time hour (8.00-9.00) of our dataset vscode is running the simulation for 3600sec(60minsx60secs) which is absolutely correct. 

<img width="683" height="348" alt="image" src="https://github.com/user-attachments/assets/722b2f48-8d2e-4fd2-8c7b-977599b1afd5" />

Now that this is fine, i tried to implement an E2 detector, so we can detect how much saturation* is at a certain road lane. After implenting it we saw some Plhrothta(saturation%). Using this block of code we successfully added more cars into the timesteps (1500-1899) until our new addition the **AMBULANCE** got added. 
<flow id="traffic_jam" type="private" begin="1500" end="1899" number="60">
    <route edges="210 43[0] 43[1] 201 204a[0] 204b[0] 204[1][0] 204[1][1]"/>
</flow>

MY NEXT GOAL WILL BE TO MAKE THE TRAFFIC LIGHT FASTER AT THE EXACT LANE OF THE AMBULANCE SO THAT THE DELAY IS REDUCED FROM 4 sec ===> 3 sec ( 4 alerts means a duration of 4seconds for the ambulance to pass the route we set for it)

<img width="722" height="137" alt="image" src="https://github.com/user-attachments/assets/a6e5c64e-fe13-40f4-a523-2b8bb3c03843" />



## WP4 protocol - INFLUXDB & Grafana Dashboard
Graphs-Statistics of C02 Emissions and other measures.
Python starts solving and then takes the outputs that are visualized by InfluxDB and Grafana.
When SUMO and InfluxDB have to be connected Generative AI will take data from the E2 detector(think of it as a camera above the street on the SUMO simution that collects data) , extracts code from TraCl and pushes it to dashboard

Since you are already thinking in terms of multi-sensor data fusion, this would look fantastic on your Grafana dashboard for Work Package 4. You could have a live chart plotting "Sensor A Arrivals" vs. "Sensor B Departures," where a massive divergence between the two lines visually proves to your professor exactly when and where the accident happened.


## WP5 protocol - Socioeconomic calculations & GIS Analysis

Ready-Made Mitigation Strategies (WP6)Applying stochastic signal optimization to reduce the socio-economic costs of your disrupted intersection.

**LOOK INTO QGIS**
## WP6 protocol - Mitigation Tables, Strategies - Traffic Light Altering


**Max-Pressure Control:

A decentralized, reactive system that changes traffic lights dynamically based on which lane has the highest "pressure" (longest queue of waiting vehicles). 

SCOOT/SCATS:A coordinated approach that adapts the overall traffic light cycle length and green splits based on how saturated the lanes are. 

When comparing two different traffic controllers, you must evaluate them using identical random seeds. This ensures that the exact same "random" traffic demand is applied to both scenarios, proving that any improvement is strictly due to your smart traffic lights, not just a lucky dice roll.



===Resilience Matrix (Next move after the traffic light altering or any other proposal):
Shows how much less your delays/costs/dissatisfaction has changed:
In transportation engineering, a resilience matrix is a structured table used to evaluate how well a traffic network absorbs a shock and recovers from it. It allows engineers and city planners to see the exact value of a mitigation strategy at a glance.

To build it, you compare your performance indicators (like delay, emissions, and socio-economic cost) across three distinct states:

Baseline State: The network running normally on a standard day.

Disrupted State: The network suffering an unmanaged shock (e.g., a lane closure or accident).

- WHY THIS DOESNT WORK -

The "Fake" Saturation Problem: When there is a vehicle that has stopped directly on top of the sensor, it is translated by the sensor as if there is congestion in the lane and so the traffic light turns green by demand. The algorithm will try to hold the light green forever, permanently starving all cross-traffic.
Because SCOOT/SCATS adapts green splits based on how saturated the lanes are, a parked car registers as 100% saturation. It will continuously allocate the maximum possible green time to that empty lane every single cycle, wasting precious time.

<ins> What needs to happen:

Program a Maximum Green Constraint (e.g., a hard cap of 60 seconds) into your SUMO traffic lights. No matter how high the pressure gets, the system must force a phase change when the timer hits zero. Real-world systems also use "Detector Fault Logic"—if a sensor reads 100% occupancy for several minutes without a single gap, the system flags the sensor as broken and ignores it. Could be used but not really optimal as it's more mpakaliko and not truly optimal. 

Introducing the Discharge Rate: ( Python has to look at both queue length from the sensor + the discharge rate - secondary sensor)
For a lane that is blocked, the discharge rate is exactly zero 0 . This means that no cars pass the intersection and so the lane doesn't "discharge" . 

Python turns the light green for the jammed lane

Python waits 5 seconds to let drivers react

Pyhton asks "How many cars have crossed the line in the last 5 seconds?"

Sensor sends a signal that says "0 cars passed on the lane"

Python realizes that the lane is blocked and or the queue sensor is broken.

Python immediately executes a "Phase Abort." It cuts the green light short, triggers the yellow light, and gives the green light to the cross-traffic so the intersection does not go to waste.

What happens if 2 cars pass the blocking vehicle by switching lanes and then switch back into the blocked lane- the sensor counts 2 cars that passed by. If the light is green and the downstream sensor detects less than 15% of the upstream sensor's volume, flag a lane blockage and abort the green phase. - This has to be integrated - 

**Sensor A**
(The Upstream Detector): Placed at the beginning of the road segment, this sensor acts as the "Input." It counts those 15 cars entering the lane.

**Sensor B**
(The Downstream/Stop-Line Detector): Placed at the traffic light, this sensor acts as the "Output." It measures the actual discharge rate.

**The "Delta"** (Anomaly Trigger): Your Python script simply subtracts the output from the input. If Sensor A counts 15 cars, but Sensor B only counts 0 to 2 cars passing during a green phase, the mathematical delta rapidly spikes. The algorithm instantly knows there is a physical blockage trapped between Sensor A and Sensor B.

**I WOULD NEED TO ADD THE CASCADE IMPACT OF THESE DISRUPTIONS**

What happens in other roads that are connected, the current crossroad we are taking the research at. What happens to close buildings (universities, hospitals etc)

**LOOK INTO QGIS**




**HOW TO MAKE SUMO WORK**

<img width="796" height="227" alt="image" src="https://github.com/user-attachments/assets/864ab694-3b27-47ac-bd37-e7cff7357e68" />

<img width="891" height="375" alt="image" src="https://github.com/user-attachments/assets/a45f610c-5d07-43db-8f55-68a76e5fb1d2" />

