-------------------- MODULE LibrarySync --------------------
EXTENDS Naturals
CONSTANT Devices
VARIABLES local, cloud, pending, removed, deletedOnServer, bootstrapped
vars == <<local, cloud, pending, removed, deletedOnServer, bootstrapped>>
Init == /\ local = [d \in Devices |-> TRUE] /\ cloud = TRUE
        /\ pending = [d \in Devices |-> "None"] /\ removed = FALSE
        /\ deletedOnServer = FALSE /\ bootstrapped = [d \in Devices |-> FALSE]
Remove(d) == /\ ~removed /\ local[d]
             /\ local' = [local EXCEPT ![d] = FALSE]
             /\ pending' = [pending EXCEPT ![d] = "Delete"] /\ removed' = TRUE
             /\ UNCHANGED <<cloud, deletedOnServer, bootstrapped>>
Bootstrap(d) == /\ ~bootstrapped[d]
                /\ bootstrapped' = [bootstrapped EXCEPT ![d] = TRUE]
                /\ pending' = [pending EXCEPT ![d] = IF local[d] THEN "Save" ELSE @]
                /\ UNCHANGED <<local, cloud, removed, deletedOnServer>>
Send(d) == /\ pending[d] # "None"
           /\ cloud' = IF pending[d] = "Delete" THEN FALSE ELSE cloud \/ local[d]
           /\ deletedOnServer' = (deletedOnServer \/ pending[d] = "Delete")
           /\ pending' = [pending EXCEPT ![d] = "None"]
           /\ UNCHANGED <<local, removed, bootstrapped>>
Fetch(d) == /\ local[d] # cloud /\ local' = [local EXCEPT ![d] = cloud]
            /\ UNCHANGED <<cloud, pending, removed, deletedOnServer, bootstrapped>>
Next == \E d \in Devices: Remove(d) \/ Bootstrap(d) \/ Send(d) \/ Fetch(d)
Spec == Init /\ [][Next]_vars /\ \A d \in Devices:
        WF_vars(Bootstrap(d)) /\ WF_vars(Send(d)) /\ WF_vars(Fetch(d))
TypeOK == /\ local \in [Devices -> BOOLEAN] /\ cloud \in BOOLEAN
          /\ pending \in [Devices -> {"None", "Save", "Delete"}]
          /\ removed \in BOOLEAN /\ deletedOnServer \in BOOLEAN
          /\ bootstrapped \in [Devices -> BOOLEAN]
Convergence == <>[](\A d \in Devices: local[d] = cloud)
NoResurrection == deletedOnServer => ~cloud
============================================================
