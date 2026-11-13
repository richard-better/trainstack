export const fitEpochInUnixSeconds = 631_065_600;

export const MessageNumber = {
  fileId: 0,
  session: 18,
  lap: 19,
  record: 20,
  event: 21,
  workout: 26,
} as const;

export const CommonField = {
  timestamp: 253,
} as const;

export const FileIdField = {
  type: 0,
  manufacturer: 1,
  product: 2,
  serialNumber: 3,
  timeCreated: 4,
} as const;

export const RecordField = {
  positionLat: 0,
  positionLong: 1,
  altitude: 2,
  heartRate: 3,
  cadence: 4,
  distance: 5,
  speed: 6,
  power: 7,
  temperature: 13,
  enhancedSpeed: 73,
  enhancedAltitude: 78,
} as const;

export const EventField = {
  event: 0,
  eventType: 1,
  data: 3,
  eventGroup: 4,
} as const;

export const WorkoutField = {
  name: 8,
} as const;

export const SessionField = {
  startTime: 2,
  startPositionLat: 3,
  startPositionLong: 4,
  sport: 5,
  subSport: 6,
  totalElapsedTime: 7,
  totalTimerTime: 8,
  totalDistance: 9,
  totalCalories: 11,
  avgSpeed: 14,
  maxSpeed: 15,
  avgHeartRate: 16,
  maxHeartRate: 17,
  avgCadence: 18,
  maxCadence: 19,
  avgPower: 20,
  maxPower: 21,
  totalAscent: 22,
  totalDescent: 23,
  firstLapIndex: 25,
  numLaps: 26,
  normalizedPower: 34,
  trainingStressScore: 35,
  intensityFactor: 36,
  totalWork: 48,
  enhancedAvgSpeed: 124,
  enhancedMaxSpeed: 125,
} as const;

export const LapField = {
  startTime: 2,
  startPositionLat: 3,
  startPositionLong: 4,
  totalElapsedTime: 7,
  totalTimerTime: 8,
  totalDistance: 9,
  totalCalories: 11,
  avgSpeed: 13,
  maxSpeed: 14,
  avgHeartRate: 15,
  maxHeartRate: 16,
  avgCadence: 17,
  maxCadence: 18,
  avgPower: 19,
  maxPower: 20,
  totalAscent: 21,
  totalDescent: 22,
  lapTrigger: 24,
  sport: 25,
  normalizedPower: 33,
  subSport: 39,
  totalWork: 41,
  enhancedAvgSpeed: 110,
  enhancedMaxSpeed: 111,
} as const;

export const Scale = {
  time: 1000,
  distance: 100,
  speed: 1000,
  altitude: 5,
  trainingStressScore: 10,
  intensityFactor: 1000,
} as const;

export const altitudeOffsetMetres = 500;

export const degreesPerSemicircle = 180 / 2 ** 31;
