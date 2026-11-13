export const zoneMetrics = ["heart_rate", "power", "pace"] as const;

export type ZoneMetric = (typeof zoneMetrics)[number];

export const isZoneMetric = (word: string): word is ZoneMetric =>
  (zoneMetrics as readonly string[]).includes(word);

export const isDescending = (metric: ZoneMetric) => metric === "pace";

export const metricUnits: Record<ZoneMetric, string> = {
  heart_rate: "beats per minute",
  power: "watts",
  pace: "seconds per pace distance of the sport",
};

export type Threshold = {
  metric: ZoneMetric;
  name: string;
  abbreviation: string;
  min: number;
  max: number;
};

export const thresholds = {
  lactate_threshold_heart_rate: {
    metric: "heart_rate",
    name: "lactate threshold heart rate",
    abbreviation: "LTHR",
    min: 80,
    max: 220,
  },
  max_heart_rate: {
    metric: "heart_rate",
    name: "max heart rate",
    abbreviation: "max HR",
    min: 100,
    max: 230,
  },
  resting_heart_rate: {
    metric: "heart_rate",
    name: "resting heart rate",
    abbreviation: "resting HR",
    min: 25,
    max: 99,
  },
  aerobic_threshold_heart_rate: {
    metric: "heart_rate",
    name: "aerobic threshold heart rate",
    abbreviation: "AeT HR",
    min: 60,
    max: 210,
  },
  ftp: { metric: "power", name: "FTP", abbreviation: "FTP", min: 50, max: 600 },
  aerobic_threshold_power: {
    metric: "power",
    name: "aerobic threshold power",
    abbreviation: "AeT power",
    min: 30,
    max: 500,
  },
  threshold_pace: {
    metric: "pace",
    name: "threshold pace",
    abbreviation: "threshold pace",
    min: 30,
    max: 900,
  },
} as const satisfies Record<string, Threshold>;

export type ThresholdName = keyof typeof thresholds;

export const isThresholdName = (word: string): word is ThresholdName =>
  Object.hasOwn(thresholds, word);

export const isValidThresholdValue = (name: ThresholdName, value: number) =>
  Number.isInteger(value) && value >= thresholds[name].min && value <= thresholds[name].max;

export type ThresholdValues = Partial<Record<ThresholdName, number>>;
