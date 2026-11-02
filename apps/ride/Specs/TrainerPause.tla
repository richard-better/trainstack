-------------------- MODULE TrainerPause --------------------
EXTENDS Naturals
VARIABLES connected, previouslyConnected, paused, pausedForTrainer, unsafeAdvance,
          resumedAutomatically
vars == <<connected, previouslyConnected, paused, pausedForTrainer, unsafeAdvance,
          resumedAutomatically>>
Init == /\ connected = TRUE /\ previouslyConnected = TRUE
        /\ paused = FALSE /\ pausedForTrainer = FALSE
        /\ unsafeAdvance = FALSE /\ resumedAutomatically = FALSE
ConnectionChange == /\ connected' = ~connected
                    /\ UNCHANGED <<previouslyConnected, paused, pausedForTrainer,
                                   unsafeAdvance, resumedAutomatically>>
Toggle == /\ paused' = ~paused /\ pausedForTrainer' = FALSE
          /\ UNCHANGED <<connected, previouslyConnected, unsafeAdvance, resumedAutomatically>>
Tick == LET dropped == previouslyConnected /\ ~connected /\ ~paused
            nowPaused == paused \/ dropped
        IN /\ paused' = nowPaused
           /\ pausedForTrainer' = (pausedForTrainer \/ dropped)
           /\ previouslyConnected' = connected
           /\ unsafeAdvance' = (unsafeAdvance \/ (~connected /\ ~nowPaused))
           /\ resumedAutomatically' = (resumedAutomatically \/ (paused /\ ~nowPaused))
           /\ UNCHANGED connected
Next == ConnectionChange \/ Toggle \/ Tick
Spec == Init /\ [][Next]_vars /\ WF_vars(Tick)
TypeOK == /\ connected \in BOOLEAN /\ previouslyConnected \in BOOLEAN
          /\ paused \in BOOLEAN /\ pausedForTrainer \in BOOLEAN
          /\ unsafeAdvance \in BOOLEAN /\ resumedAutomatically \in BOOLEAN
TrainerPauseIsPaused == pausedForTrainer => paused
OnlyRiderResumes == ~resumedAutomatically
NeverAdvanceDisconnected == ~unsafeAdvance
=============================================================
