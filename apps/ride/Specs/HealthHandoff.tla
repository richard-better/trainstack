-------------------- MODULE HealthHandoff --------------------
EXTENDS Naturals, FiniteSets
VARIABLES origin, watch, claimed, messages, recorded, pending, queued, health,
          queriedAbsent, phoneAlive, watchAlive, connected, endSent
vars == <<origin, watch, claimed, messages, recorded, pending, queued, health,
          queriedAbsent, phoneAlive, watchAlive, connected, endSent>>
Init == /\ origin \in {"Phone", "Mac", "PhoneOnly"}
        /\ watch = IF origin = "PhoneOnly" THEN "Absent" ELSE "Running"
        /\ claimed = FALSE /\ messages = {} /\ recorded = FALSE
        /\ pending = FALSE /\ queued = FALSE /\ health = 0
        /\ queriedAbsent = FALSE /\ phoneAlive = TRUE /\ watchAlive = TRUE
        /\ connected = TRUE /\ endSent = FALSE
Claim == /\ phoneAlive /\ connected /\ watch = "Running" /\ "Recorded" \notin messages
         /\ (origin = "Mac" \/ ~recorded)
         /\ messages' = messages \cup {"Recorded"}
         /\ UNCHANGED <<origin, watch, claimed, recorded, pending, queued, health,
                        queriedAbsent, phoneAlive, watchAlive, connected, endSent>>
Record == /\ ~recorded /\ recorded' = TRUE /\ pending' = (origin # "Mac")
          /\ queued' = (origin # "Mac")
          /\ UNCHANGED <<origin, watch, claimed, messages, health, queriedAbsent,
                         phoneAlive, watchAlive, connected, endSent>>
SyncMac == /\ origin = "Mac" /\ recorded /\ ~queued /\ phoneAlive
           /\ queued' = TRUE /\ pending' = TRUE
           /\ UNCHANGED <<origin, watch, claimed, messages, recorded, health,
                          queriedAbsent, phoneAlive, watchAlive, connected, endSent>>
SendEnd == /\ recorded /\ phoneAlive /\ ~endSent /\ origin # "Mac"
           /\ endSent' = TRUE
           /\ messages' = IF connected THEN messages \cup {"Ended"} ELSE messages
           /\ UNCHANGED <<origin, watch, claimed, recorded, pending, queued, health,
                          queriedAbsent, phoneAlive, watchAlive, connected>>
DeliverClaim == /\ "Recorded" \in messages /\ watchAlive /\ connected
                /\ claimed' = IF watch = "Running" THEN TRUE ELSE claimed
                /\ UNCHANGED <<origin, watch, messages, recorded, pending, queued, health,
                               queriedAbsent, phoneAlive, watchAlive, connected, endSent>>
WatchSavesItself == origin # "Phone" /\ ~claimed
FinishWatch == /\ watch = "Running" /\ watchAlive
               /\ watch' = "Ended" /\ health' = health + IF WatchSavesItself THEN 1 ELSE 0
               /\ UNCHANGED <<origin, claimed, messages, recorded, pending, queued,
                              queriedAbsent, phoneAlive, watchAlive, connected, endSent>>
WatchGivesUpOnASilentPhone ==
  /\ watch = "Running" /\ watchAlive /\ origin = "Phone" /\ (recorded \/ ~phoneAlive)
  /\ watch' = "Ended"
  /\ UNCHANGED <<origin, claimed, messages, recorded, pending, queued, health,
                 queriedAbsent, phoneAlive, watchAlive, connected, endSent>>
DeliverEnd == /\ "Ended" \in messages /\ connected /\ FinishWatch
UserEndsWatch == FinishWatch
Drop == /\ messages # {} /\ \E m \in messages: messages' = messages \ {m}
        /\ UNCHANGED <<origin, watch, claimed, recorded, pending, queued, health,
                       queriedAbsent, phoneAlive, watchAlive, connected, endSent>>
Query == /\ pending /\ phoneAlive /\ ~queriedAbsent
         /\ queriedAbsent' = (health = 0) /\ pending' = (health = 0)
         /\ UNCHANGED <<origin, watch, claimed, messages, recorded, queued, health,
                        phoneAlive, watchAlive, connected, endSent>>
Save == /\ pending /\ phoneAlive /\ queriedAbsent
        /\ health' = health + 1 /\ pending' = FALSE /\ queriedAbsent' = FALSE
        /\ UNCHANGED <<origin, watch, claimed, messages, recorded, queued,
                       phoneAlive, watchAlive, connected, endSent>>
PhoneCrash == /\ phoneAlive /\ phoneAlive' = FALSE /\ queriedAbsent' = FALSE
              /\ UNCHANGED <<origin, watch, claimed, messages, recorded, pending, queued,
                             health, watchAlive, connected, endSent>>
PhoneLaunch == /\ ~phoneAlive /\ phoneAlive' = TRUE
               /\ UNCHANGED <<origin, watch, claimed, messages, recorded, pending, queued,
                              health, queriedAbsent, watchAlive, connected, endSent>>
WatchCrash == /\ watchAlive /\ watchAlive' = FALSE /\ claimed' = FALSE
              /\ UNCHANGED <<origin, watch, messages, recorded, pending, queued, health,
                             queriedAbsent, phoneAlive, connected, endSent>>
WatchRecover == /\ ~watchAlive /\ watchAlive' = TRUE
                /\ UNCHANGED <<origin, watch, claimed, messages, recorded, pending, queued,
                               health, queriedAbsent, phoneAlive, connected, endSent>>
ConnectionChange == /\ connected' = ~connected
                    /\ UNCHANGED <<origin, watch, claimed, messages, recorded, pending, queued,
                                   health, queriedAbsent, phoneAlive, watchAlive, endSent>>
Next == Claim \/ Record \/ SyncMac \/ SendEnd \/ DeliverClaim \/ DeliverEnd \/ UserEndsWatch
        \/ WatchGivesUpOnASilentPhone
        \/ Drop \/ Query \/ Save \/ PhoneCrash \/ PhoneLaunch \/ WatchCrash \/ WatchRecover
        \/ ConnectionChange
Spec == Init /\ [][Next]_vars /\ WF_vars(PhoneLaunch) /\ WF_vars(WatchRecover)
        /\ SF_vars(WatchGivesUpOnASilentPhone)
        /\ SF_vars(SyncMac) /\ SF_vars(Query) /\ SF_vars(Save)
TypeOK == /\ origin \in {"Phone", "Mac", "PhoneOnly"}
          /\ watch \in {"Absent", "Running", "Ended"}
          /\ messages \subseteq {"Recorded", "Ended"} /\ health \in 0..2
          /\ \A b \in {claimed, recorded, pending, queued, queriedAbsent, phoneAlive,
                       watchAlive, connected, endSent}: b \in BOOLEAN
PendingHasRecording == pending => recorded
NoDuplicatesForPhoneRides == origin # "Mac" => health <= 1
RecordedEventuallySaved == recorded ~> (health > 0)
WatchEventuallyEndsAfterAPhoneRide == (recorded /\ origin = "Phone") ~> (watch # "Running")
==============================================================
