---
title: Today and readiness
summary: What the Today page shows, how readiness is worked out, and what its suggestions do.
section: Start
order: 2
---

**Today** is the first page you see after signing in. It shows how ready you are to train, the
sessions planned for today with a suggestion for each, and today's check-in.

![Today after a poor night: readiness, the reasons, and a suggestion to rest](/help-images/today.png)

## Readiness

Readiness says how ready you are on four levels:

| Level     | What it says                              |
| --------- | ----------------------------------------- |
| **Ready** | Nothing points against your plan.         |
| **Fair**  | Some strain. Go easier on the hard parts. |
| **Low**   | Run down. Keep today easy.                |
| **Poor**  | Rest today.                               |

It reads up to three things, and lists every one it used:

- _Your check-in_, against your own usual: each rating one point below what you usually answer
  over the last 28 days counts against readiness, two points below counts double. Your usual needs
  at least 7 check-ins; until then it is 3, "Normal". A rating above your usual is shown, but does
  not make up for strain elsewhere.
- _Your sleep, resting heart rate and HRV_, if Ride sends them from Apple Health, each against
  your own usual: sleep an hour short of your average over the last 28 days counts against
  readiness, two hours short counts double; a resting heart rate 5 beats above your 28-day average
  counts, 10 above counts double; HRV well below its range over the last 60 days counts, far below
  counts double. Each needs a few weeks of nights before it counts (7 for sleep and resting heart
  rate, 14 for HRV). Together they never take readiness below **Fair** on their own, so a bad
  night eases a hard session; a bad night and a check-in that says so too can take it further.
  Each line says the night's value and your usual, such as "Slept 4 h 18 min, usually 7 h 34 min".
- _Your training load_, as it stood last night: deep fatigue against your fitness, fitness
  rising fast, and hard days in a row. It needs about 12 weeks of training in Trainstack before it
  says anything, and on its own it never takes readiness below **Fair**: how you feel decides
  whether a hard block is too much.

Illness and injury come first. Ill today, or injured so you cannot train, is **Poor**, and every
session is rest. Ill in the last week, it is no better than **Fair**; injured and training less,
no better than **Low**.

Readiness also says how sure it is. With no check-in today it comes from training and what your
devices measured, and is low confidence; check in, and it reads your answers. A day without
measured sleep, resting heart rate or HRV says which it did not have. To have them measured, turn
on Import from Health in Ride (Settings, then Account); see
[Getting activities in](/help/add-activities#apple-health).

The level is a rule of thumb from what you told it and what you did, not a diagnosis or medical
advice.

## Suggestions for today's plan

Once readiness has a level, each workout still to do today gets a suggestion, from its intensity
and your readiness. Until then, with no check-in today, no illness in the last week and less
than about 12 weeks of training, readiness says **Not enough to go on**, and there are no suggestions: check in, and they appear.

| Readiness | Easy session | Moderate session | Hard session  |
| --------- | ------------ | ---------------- | ------------- |
| Ready     | As planned   | As planned       | As planned    |
| Fair      | As planned   | As planned       | Ease it       |
| Low       | As planned   | Ease it          | Swap for easy |
| Poor      | Rest         | Rest             | Rest          |

Nothing changes unless you choose it:

- **Edit the session** opens it, to hold the hard parts at the low end of their targets or cut a
  repeat.
- **Swap for an easy session** skips it with a note saying why, and puts an easy ride, run or swim
  of up to an hour on today instead.
- **Skip it** marks it skipped, with the reason.

Both show on your [calendar](/help/plan-your-week) like any other change, and you can undo them
there with **Mark not skipped** and **Delete**.

## Check in from Today

Under today's plan, Today asks "How do you feel today?" until you have checked in, and readiness
updates as soon as you save. See [The daily check-in](/help/check-in).

## Not supported yet

- Readiness does not change your plan by itself, and there are no training plans that adapt.
- No sleep, resting heart rate or HRV from Whoop, Oura or Garmin directly. A watch or ring whose
  app saves them to Apple Health reaches readiness through Ride.
- No readiness in Ride.
