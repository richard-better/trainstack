-------------------- MODULE HealthQueue --------------------
EXTENDS Naturals
VARIABLES file, pending, continuation, saved, running
vars == <<file, pending, continuation, saved, running>>
Init == /\ file = FALSE /\ pending = FALSE /\ continuation = FALSE
        /\ saved = FALSE /\ running = TRUE
PersistFile == /\ running /\ ~file /\ file' = TRUE /\ continuation' = TRUE
               /\ UNCHANGED <<pending, saved, running>>
Enqueue == /\ running /\ continuation /\ pending' = TRUE /\ continuation' = FALSE
           /\ UNCHANGED <<file, saved, running>>
Crash == /\ running /\ running' = FALSE /\ continuation' = FALSE
         /\ UNCHANGED <<file, pending, saved>>
Launch == /\ ~running /\ running' = TRUE
          /\ UNCHANGED <<file, pending, continuation, saved>>
SavePending == /\ running /\ pending /\ saved' = TRUE /\ pending' = FALSE
               /\ UNCHANGED <<file, continuation, running>>
ReceiveSameFile == /\ file /\ running /\ UNCHANGED vars
Next == PersistFile \/ Enqueue \/ Crash \/ Launch \/ SavePending \/ ReceiveSameFile
Spec == Init /\ [][Next]_vars /\ WF_vars(Launch) /\ SF_vars(Enqueue) /\ SF_vars(SavePending)
TypeOK == \A b \in {file, pending, continuation, saved, running}: b \in BOOLEAN
PendingHasFile == pending => file
QueuedEventuallySaved == pending ~> saved
RecordedEventuallySaved == file ~> saved
===========================================================
