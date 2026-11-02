-------------------- MODULE HealthQueue --------------------
EXTENDS Naturals
VARIABLES file, pending, storing, saved, running
vars == <<file, pending, storing, saved, running>>
Init == /\ file = FALSE /\ pending = FALSE /\ storing = FALSE
        /\ saved = FALSE /\ running = TRUE
QueueBeforeStoring == /\ running /\ ~file /\ ~pending /\ ~saved
                      /\ pending' = TRUE /\ storing' = TRUE
                      /\ UNCHANGED <<file, saved, running>>
StoreFile == /\ running /\ storing /\ file' = TRUE /\ storing' = FALSE
             /\ UNCHANGED <<pending, saved, running>>
Crash == /\ running /\ running' = FALSE /\ storing' = FALSE
         /\ UNCHANGED <<file, pending, saved>>
Launch == /\ ~running /\ running' = TRUE
          /\ UNCHANGED <<file, pending, storing, saved>>
SavePending == /\ running /\ pending /\ ~storing
               /\ saved' = file /\ pending' = FALSE
               /\ UNCHANGED <<file, storing, running>>
Next == QueueBeforeStoring \/ StoreFile \/ Crash \/ Launch \/ SavePending
Spec == Init /\ [][Next]_vars /\ WF_vars(Launch) /\ SF_vars(StoreFile) /\ SF_vars(SavePending)
TypeOK == \A b \in {file, pending, storing, saved, running}: b \in BOOLEAN
AStoredRideIsQueuedOrSaved == file => (pending \/ saved)
RecordedEventuallySaved == file ~> saved
===========================================================
