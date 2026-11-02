-------------------- MODULE HealthDedupe --------------------
EXTENDS Naturals, FiniteSets
CONSTANT Devices
VARIABLES pending, phase, workouts
vars == <<pending, phase, workouts>>
Init == /\ pending = Devices /\ phase = [d \in Devices |-> "Idle"] /\ workouts = {}
Query(d) == /\ d \in pending /\ phase[d] = "Idle"
            /\ phase' = [phase EXCEPT ![d] = IF workouts = {} THEN "Save" ELSE "Done"]
            /\ pending' = IF workouts = {} THEN pending ELSE pending \ {d}
            /\ UNCHANGED workouts
Save(d) == /\ phase[d] = "Save"
           /\ workouts' = workouts \cup {"RideHash"} /\ phase' = [phase EXCEPT ![d] = "Done"]
           /\ pending' = pending \ {d}
Crash(d) == /\ phase[d] = "Save" /\ phase' = [phase EXCEPT ![d] = "Idle"]
            /\ UNCHANGED <<pending, workouts>>
Next == \E d \in Devices: Query(d) \/ Save(d) \/ Crash(d)
Spec == Init /\ [][Next]_vars /\ \A d \in Devices: SF_vars(Query(d)) /\ SF_vars(Save(d))
TypeOK == /\ pending \subseteq Devices /\ workouts \subseteq {"RideHash"}
          /\ phase \in [Devices -> {"Idle", "Save", "Done"}]
EventuallySaved == <>(workouts # {})
EventuallyDrained == <>(pending = {})
NoDuplicates == Cardinality(workouts) <= 1
============================================================
