# @trainstack/zones

Thresholds, training zones and the dated history of an athlete's settings, shared by the API
and the web app. It has no dependencies and runs in Workers and the browser. The numbers match
Ride's `ZoneModel` in `apps/ride/RideKit/Sources/RideData`: `test/zones.test.ts` and
`test/profile.test.ts` hold the values of Ride's `ZoneTests` and `ZoneHistoryTests`. Change both
sides together.

## Thresholds

| Threshold                      | Metric       | Unit                                           |
| ------------------------------ | ------------ | ---------------------------------------------- |
| `lactate_threshold_heart_rate` | `heart_rate` | beats per minute                               |
| `max_heart_rate`               | `heart_rate` | beats per minute                               |
| `resting_heart_rate`           | `heart_rate` | beats per minute                               |
| `aerobic_threshold_heart_rate` | `heart_rate` | beats per minute                               |
| `ftp`                          | `power`      | watts                                          |
| `aerobic_threshold_power`      | `power`      | watts                                          |
| `threshold_pace`               | `pace`       | seconds per 1000 m running, per 100 m swimming |

A swimmer's critical swim speed is their swimming `threshold_pace`.

## Zone models

`zoneModels` follows Friel's "Quick guide to setting zones", Coggan's "Training and Racing with
a Power Meter", and the usual critical swim speed bands. Each model names the thresholds it is
drawn from, and `zoneLimits` turns them into limits: the last value in each zone but the top
one. Pace zones run from slow to fast, so their limits fall. Values round half away from zero,
as Swift's `rounded()` does. An athlete's own limits (`customLimits`) replace the model's while
set.

## History

A setting is a dated change (`SettingChange`): a threshold, how a metric's zones are drawn, a
sport keeping its own zones, a sport being listed, weight, or a threshold test. `profileOn`
applies every change up to a day, so an old activity is analysed with the settings that held
on its day. Before the first day on which a change to zones took effect, that first day's
settings hold. As in Ride's `ZoneHistory`, listing a sport counts as such a change and a weight
does not, since Ride keeps weight outside its zone history. Weight follows the same rule on its own.
Changes on the same day apply in a fixed order, whatever order they arrive in: sports listed,
then defaults, then a sport keeping its own zones, then the sport's own settings.

`sport: null` is the default every sport uses until it keeps its own heart rate or power
zones. Pace zones always belong to a sport. A sport that is not a known one (`knownSports`) has
heart rate and power zones.
