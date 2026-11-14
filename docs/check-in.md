# Daily check-in

An athlete tells TrainStack how they feel each day: how they slept, how fresh, sore, stressed and
happy they are, whether they are ill or injured, and anything else in a note. It is the first part
of the recovery picture in section 4 of the roadmap (#64), and the only one that needs no device.
Daily readiness (`packages/readiness`, the web app's Today page) reads it against the athlete's
own usual. Sleep, resting heart rate and HRV from Apple Health, Whoop and Oura, and plan
adaptation come later and read what this stores.

The contract is `checkIns` in `packages/contract/src/check-ins.ts`; the server is
`hosted/apps/api/src/check-ins/`.

## What is asked, and why

### Five ratings on one scale

| Item     | 1               | 2                      | 3      | 4            | 5             |
| -------- | --------------- | ---------------------- | ------ | ------------ | ------------- |
| sleep    | Hardly slept    | Restless               | Normal | Good         | Very restful  |
| energy   | Exhausted       | More tired than normal | Normal | Fresh        | Very fresh    |
| soreness | Very sore       | Sorer than normal      | Normal | Feeling good | Feeling great |
| stress   | Highly stressed | Stressed               | Normal | Relaxed      | Very relaxed  |
| mood     | Very low        | Low                    | Normal | Good         | Very positive |

- **The items** are those of the wellness questionnaire of McLean and others (2010), the most used
  short form in team and endurance sport: fatigue, sleep quality, general muscle soreness, stress
  and mood. Fatigue is asked as energy, so that higher is better on every item and it is not
  mistaken for the fatigue line of training load it is shown beside. Four of them are also the Hooper index (Hooper and Mackinnon 1995; sleep quality,
  fatigue, stress, soreness), which TrainingPeaks and Garmin's daily metrics follow, so a later
  Hooper-style sum can be read from what is stored.
- **One scale, 1 to 5, higher is better, 3 is normal for the athlete.** McLean's 5-point scale
  with a worded anchor at each point is kept. Its middle point is made "Normal" on every item, so
  the scale is the same everywhere and an ordinary day is the middle. Hooper uses 1 to 7 with
  higher worse; a 5-point scale with words at every point is quicker to answer on a phone.
- **Sleep is the athlete's own judgement.** Measured sleep comes later from devices and is kept
  apart, because subjective sleep quality and measured sleep answer different questions.
- **Why subjective measures at all.** Saw, Main and Gastin (2016) reviewed 56 studies and found
  that athlete self-reported measures responded to changes in training load with better
  sensitivity and consistency than the common objective ones (blood markers, heart rate). They are
  most useful against the athlete's own normal, which is why 3 is "Normal" and not a fixed
  standard.

Each rating can be left unrated, stored as null. Nothing is filled in by the server.

### States that are not ratings

- **Ill**, with a kind in plain words: a cold, cough or sore throat (`respiratory`), stomach or
  gut (`stomach`), a fever or aching all over (`fever`), or something else (`other`). This is a
  simplified grouping by what the athlete notices, informed by the illness classification of the
  IOC's 2020 consensus on recording injury and illness in sport (Bahr and others 2020, tables 7
  and 9), which records illness by organ system and by symptom; it is not a diagnosis.
- **Injured**, with a body area and what it lets them do. Areas are the IOC 2020 body areas
  (head, neck, shoulder, upper arm, elbow, forearm, wrist, hand, chest, upper back, lower back,
  abdomen, hip and groin, thigh, knee, lower leg, ankle, foot). What it lets them do follows the
  OSTRC questionnaire on health problems (Clarsen and others 2013, 2020): trains fully, trains
  less, or cannot train.
- **A note**, up to 1000 characters, in the athlete's words.

Nothing is diagnosed. Readiness reads these answers and says what it read and why, with every
weight and threshold in `packages/readiness/README.md`; its suggestions change nothing unless the
athlete acts on them. Plan adaptation, later, must do the same.

## Storage and sync

- One check-in per athlete per calendar day (`check_in`, keyed by athlete and day), for today or
  any day before it in the athlete's time zone. The day is the same calendar day as the calendar
  and training load use.
- A check-in is kept whole: a write or a removal replaces the day's check-in when its `updatedAt`
  is later than the last edit to that day. Of a write and a removal at the same moment, the removal
  wins; of two writes at the same moment, the server keeps the same one in either order. A removal
  leaves a tombstone, so a stale device cannot bring a removed check-in back. Whole-day, not
  per-item: the athlete answers the day as one form, and merging items from two devices would make
  a check-in nobody entered.
- `range` returns only the days that have a check-in, earliest first, for up to the same span as
  `training.load`, so a page lays the two side by side by day.

## Privacy

It is health data the athlete gives about themselves. Only the athlete can read it today. It is in
their account export (`data/check_in/`), and deleting the account deletes it. The server stores
what the athlete entered, infers nothing from it, and sends it nowhere; request logs carry the path,
not the answers.

## Sources

- McLean BD, Coutts AJ, Kelly V, McGuigan MR, Cormack SJ. Neuromuscular, endocrine, and perceptual
  fatigue responses during different length between-match microcycles in professional rugby league
  players. _Int J Sports Physiol Perform_. 2010;5(3):367-383.
- Hooper SL, Mackinnon LT. Monitoring overtraining in athletes. _Sports Med_. 1995;20(5):321-327.
- Saw AE, Main LC, Gastin PB. Monitoring the athlete training response: subjective self-reported
  measures trump commonly used objective measures: a systematic review. _Br J Sports Med_.
  2016;50(5):281-291.
- Bahr R, Clarsen B, Derman W, and others. International Olympic Committee consensus statement:
  methods for recording and reporting of epidemiological data on injury and illness in sport 2020.
  _Br J Sports Med_. 2020;54(7):372-389.
- Clarsen B, Myklebust G, Bahr R. Development and validation of a new method for the registration of
  overuse injuries in sports injury epidemiology: the Oslo Sports Trauma Research Centre (OSTRC)
  overuse injury questionnaire. _Br J Sports Med_. 2013;47(8):495-502. Clarsen B and others. Improved
  reporting of overuse injuries and health problems in sport: an update of the OSTRC questionnaires.
  _Br J Sports Med_. 2020;54(7):390-396.
