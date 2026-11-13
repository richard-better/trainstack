-------------------- MODULE LibrarySync --------------------
EXTENDS Naturals
CONSTANT Devices
Commands == {"SaveRide", "DeleteRide", "SaveDeleted"}
VARIABLES local, cloud, deletedRecord, knowsDeleted, pending, removed, bootstrapped,
          serverDeleted
vars == <<local, cloud, deletedRecord, knowsDeleted, pending, removed, bootstrapped,
          serverDeleted>>
Init == /\ local = [d \in Devices |-> TRUE] /\ cloud = TRUE /\ deletedRecord = FALSE
        /\ knowsDeleted = [d \in Devices |-> FALSE]
        /\ pending = [d \in Devices |-> {}] /\ removed = FALSE
        /\ bootstrapped = [d \in Devices |-> FALSE] /\ serverDeleted = FALSE
Remove(d) == /\ ~removed /\ local[d]
             /\ local' = [local EXCEPT ![d] = FALSE]
             /\ knowsDeleted' = [knowsDeleted EXCEPT ![d] = TRUE]
             /\ pending' = [pending EXCEPT ![d] = @ \cup {"DeleteRide", "SaveDeleted"}]
             /\ removed' = TRUE
             /\ UNCHANGED <<cloud, deletedRecord, bootstrapped, serverDeleted>>
DeleteOnServer == /\ ~serverDeleted /\ serverDeleted' = TRUE /\ removed' = TRUE
                  /\ UNCHANGED <<local, cloud, deletedRecord, knowsDeleted, pending, bootstrapped>>
DropDeletedOnServer(d) == /\ serverDeleted /\ local[d] /\ ~knowsDeleted[d]
                          /\ local' = [local EXCEPT ![d] = FALSE]
                          /\ knowsDeleted' = [knowsDeleted EXCEPT ![d] = TRUE]
                          /\ pending' = [pending EXCEPT ![d] = @ \cup {"DeleteRide", "SaveDeleted"}]
                          /\ UNCHANGED <<cloud, deletedRecord, removed, bootstrapped,
                                         serverDeleted>>
SendsRide(d) == local[d] /\ ~knowsDeleted[d]
Bootstrap(d) == /\ ~bootstrapped[d]
                /\ bootstrapped' = [bootstrapped EXCEPT ![d] = TRUE]
                /\ pending' = [pending EXCEPT ![d] = @
                     \cup (IF SendsRide(d) THEN {"SaveRide"} ELSE {})
                     \cup (IF knowsDeleted[d] THEN {"SaveDeleted"} ELSE {})]
                /\ UNCHANGED <<local, cloud, deletedRecord, knowsDeleted, removed, serverDeleted>>
Send(d, command) ==
  /\ command \in pending[d]
  /\ cloud' = CASE command = "SaveRide" -> cloud \/ SendsRide(d)
                [] command = "DeleteRide" -> FALSE
                [] OTHER -> cloud
  /\ deletedRecord' = (deletedRecord \/ command = "SaveDeleted")
  /\ pending' = [pending EXCEPT ![d] = @ \ {command}]
  /\ UNCHANGED <<local, knowsDeleted, removed, bootstrapped, serverDeleted>>
FetchDeleted(d) == /\ deletedRecord /\ ~knowsDeleted[d]
                   /\ knowsDeleted' = [knowsDeleted EXCEPT ![d] = TRUE]
                   /\ local' = [local EXCEPT ![d] = FALSE]
                   /\ pending' = [pending EXCEPT ![d] = @ \cup {"DeleteRide"}]
                   /\ UNCHANGED <<cloud, deletedRecord, removed, bootstrapped, serverDeleted>>
FetchRide(d) == /\ cloud /\ ~local[d] /\ "DeleteRide" \notin pending[d]
                /\ IF knowsDeleted[d]
                   THEN /\ pending' = [pending EXCEPT ![d] = @ \cup {"DeleteRide"}]
                        /\ UNCHANGED local
                   ELSE /\ local' = [local EXCEPT ![d] = TRUE]
                        /\ UNCHANGED pending
                /\ UNCHANGED <<cloud, deletedRecord, knowsDeleted, removed, bootstrapped,
                               serverDeleted>>
FetchRideGone(d) == /\ ~cloud /\ local[d]
                    /\ local' = [local EXCEPT ![d] = FALSE]
                    /\ UNCHANGED <<cloud, deletedRecord, knowsDeleted, pending, removed,
                                   bootstrapped, serverDeleted>>
Next == \/ DeleteOnServer
        \/ \E d \in Devices:
             \/ Remove(d) \/ DropDeletedOnServer(d) \/ Bootstrap(d) \/ FetchDeleted(d)
             \/ FetchRide(d) \/ FetchRideGone(d) \/ \E command \in Commands: Send(d, command)
Spec == Init /\ [][Next]_vars /\ \A d \in Devices:
        /\ WF_vars(Bootstrap(d)) /\ WF_vars(FetchDeleted(d)) /\ WF_vars(FetchRide(d))
        /\ WF_vars(FetchRideGone(d)) /\ WF_vars(DropDeletedOnServer(d))
        /\ \A command \in Commands: WF_vars(Send(d, command))
TypeOK == /\ local \in [Devices -> BOOLEAN] /\ cloud \in BOOLEAN
          /\ deletedRecord \in BOOLEAN /\ knowsDeleted \in [Devices -> BOOLEAN]
          /\ pending \in [Devices -> SUBSET Commands]
          /\ removed \in BOOLEAN /\ bootstrapped \in [Devices -> BOOLEAN]
          /\ serverDeleted \in BOOLEAN
ADeviceThatKnowsOfTheDeletionNeverHoldsTheRide ==
  \A d \in Devices: knowsDeleted[d] => ~local[d]
Convergence == <>[](\A d \in Devices: local[d] = cloud)
DeletionOnTheServerReachesICloud == <>[](serverDeleted => deletedRecord)
DeletedRideEventuallyGoneForGood ==
  <>[](removed => (~cloud /\ \A d \in Devices: ~local[d]))
============================================================
