-------------------- MODULE HealthHandoff --------------------
EXTENDS Naturals, FiniteSets
VARIABLES origin, watch, claimed, messages, recorded, pending, queued, health,
          queriedAbsent, phoneAlive, watchAlive, connected, claimSent, endSent
vars == <<origin, watch, claimed, messages, recorded, pending, queued, health,
          queriedAbsent, phoneAlive, watchAlive, connected, claimSent, endSent>>
Init == /\ origin \in {"Phone", "Mac", "PhoneOnly"}
        /\ watch = IF origin = "PhoneOnly" THEN "Absent" ELSE "Running"
        /\ claimed = FALSE /\ messages = {} /\ recorded = FALSE
        /\ pending = FALSE /\ queued = FALSE /\ health = 0
        /\ queriedAbsent = FALSE /\ phoneAlive = TRUE /\ watchAlive = TRUE
        /\ connected = TRUE /\ claimSent = FALSE /\ endSent = FALSE
Claim == /\ phoneAlive /\ connected /\ watch = "Running" /\ ~claimSent
         /\ messages' = messages \cup {"Recorded"} /\ claimSent' = TRUE
         /\ UNCHANGED <<origin, watch, claimed, recorded, pending, queued, health,
                        queriedAbsent, phoneAlive, watchAlive, connected, endSent>>
Record == /\ ~recorded /\ recorded' = TRUE /\ pending' = (origin # "Mac")
          /\ queued' = (origin # "Mac")
          /\ UNCHANGED <<origin, watch, claimed, messages, health, queriedAbsent,
                         phoneAlive, watchAlive, connected, claimSent, endSent>>
SyncMac == /\ origin = "Mac" /\ recorded /\ ~queued /\ phoneAlive
           /\ queued' = TRUE /\ pending' = TRUE
           /\ UNCHANGED <<origin, watch, claimed, messages, recorded, health,
                          queriedAbsent, phoneAlive, watchAlive, connected, claimSent, endSent>>
SendEnd == /\ recorded /\ phoneAlive /\ ~endSent /\ origin # "Mac"
           /\ endSent' = TRUE
           /\ messages' = IF connected THEN messages \cup {"Ended"} ELSE messages
           /\ UNCHANGED <<origin, watch, claimed, recorded, pending, queued, health,
                          queriedAbsent, phoneAlive, watchAlive, connected, claimSent>>
DeliverClaim == /\ "Recorded" \in messages /\ watchAlive /\ connected
                /\ claimed' = IF watch = "Running" THEN TRUE ELSE claimed
                /\ UNCHANGED <<origin, watch, messages, recorded, pending, queued, health,
                               queriedAbsent, phoneAlive, watchAlive, connected, claimSent, endSent>>
FinishWatch == /\ watch = "Running" /\ watchAlive
               /\ watch' = "Ended" /\ health' = health + IF claimed THEN 0 ELSE 1
               /\ UNCHANGED <<origin, claimed, messages, recorded, pending, queued,
                              queriedAbsent, phoneAlive, watchAlive, connected, claimSent, endSent>>
DeliverEnd == /\ "Ended" \in messages /\ connected /\ FinishWatch
UserEndsWatch == FinishWatch
Drop == /\ messages # {} /\ \E m \in messages: messages' = messages \ {m}
        /\ UNCHANGED <<origin, watch, claimed, recorded, pending, queued, health,
                       queriedAbsent, phoneAlive, watchAlive, connected, claimSent, endSent>>
Query == /\ pending /\ phoneAlive /\ ~queriedAbsent
         /\ queriedAbsent' = (health = 0) /\ pending' = (health = 0)
         /\ UNCHANGED <<origin, watch, claimed, messages, recorded, queued, health,
                        phoneAlive, watchAlive, connected, claimSent, endSent>>
Save == /\ pending /\ phoneAlive /\ queriedAbsent
        /\ health' = health + 1 /\ pending' = FALSE /\ queriedAbsent' = FALSE
        /\ UNCHANGED <<origin, watch, claimed, messages, recorded, queued,
                       phoneAlive, watchAlive, connected, claimSent, endSent>>
PhoneCrash == /\ phoneAlive /\ phoneAlive' = FALSE /\ queriedAbsent' = FALSE
              /\ UNCHANGED <<origin, watch, claimed, messages, recorded, pending, queued,
                             health, watchAlive, connected, claimSent, endSent>>
PhoneLaunch == /\ ~phoneAlive /\ phoneAlive' = TRUE
               /\ UNCHANGED <<origin, watch, claimed, messages, recorded, pending, queued,
                              health, queriedAbsent, watchAlive, connected, claimSent, endSent>>
WatchCrash == /\ watchAlive /\ watchAlive' = FALSE /\ claimed' = FALSE
              /\ UNCHANGED <<origin, watch, messages, recorded, pending, queued, health,
                             queriedAbsent, phoneAlive, connected, claimSent, endSent>>
WatchRecover == /\ ~watchAlive /\ watchAlive' = TRUE
                /\ UNCHANGED <<origin, watch, claimed, messages, recorded, pending, queued,
                               health, queriedAbsent, phoneAlive, connected, claimSent, endSent>>
ConnectionChange == /\ connected' = ~connected
                    /\ UNCHANGED <<origin, watch, claimed, messages, recorded, pending, queued,
                                   health, queriedAbsent, phoneAlive, watchAlive, claimSent, endSent>>
Next == Claim \/ Record \/ SyncMac \/ SendEnd \/ DeliverClaim \/ DeliverEnd \/ UserEndsWatch
        \/ Drop \/ Query \/ Save \/ PhoneCrash \/ PhoneLaunch \/ WatchCrash \/ WatchRecover
        \/ ConnectionChange
Spec == Init /\ [][Next]_vars /\ WF_vars(PhoneLaunch) /\ WF_vars(WatchRecover)
        /\ SF_vars(SyncMac) /\ SF_vars(Query) /\ SF_vars(Save)
TypeOK == /\ origin \in {"Phone", "Mac", "PhoneOnly"}
          /\ watch \in {"Absent", "Running", "Ended"}
          /\ messages \subseteq {"Recorded", "Ended"} /\ health \in 0..2
          /\ \A b \in {claimed, recorded, pending, queued, queriedAbsent, phoneAlive,
                       watchAlive, connected, claimSent, endSent}: b \in BOOLEAN
PendingHasRecording == pending => recorded
NoDuplicates == health <= 1
RecordedEventuallySaved == recorded ~> (health > 0)
WatchEventuallyEnds == recorded ~> (watch # "Running")
==============================================================
