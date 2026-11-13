export type Recording = {
  startedAt: Date;
  elapsedSeconds: number;
  sport: string | null;
  distanceMetres: number | undefined;
};

const MIN_SHARED_FRACTION = 0.5;
const PIECE_FRACTION = 0.9;
const MIN_DURATION_RATIO = 0.5;
const MIN_DISTANCE_RATIO = 0.8;
const PIECE_DISTANCE_SLACK = 1.2;
const COMPARABLE_DURATION_RATIO = 0.8;

const sportFamilies: Record<string, string> = {
  indoor_cycling: "cycling",
  e_biking: "cycling",
  hiking: "walking",
};

const familyOf = (sport: string) => sportFamilies[sport] ?? sport;

const isIndoor = (sport: string | null) => sport === "indoor_cycling";

const sameSport = (a: string | null, b: string | null) =>
  a === null || b === null || familyOf(a) === familyOf(b);

const span = ({ startedAt, elapsedSeconds }: Recording) => ({
  start: startedAt.getTime(),
  end: startedAt.getTime() + elapsedSeconds * 1000,
  length: elapsedSeconds * 1000,
});

export function sharedMilliseconds(a: Recording, b: Recording) {
  const spanA = span(a);
  const spanB = span(b);
  return Math.max(0, Math.min(spanA.end, spanB.end) - Math.max(spanA.start, spanB.start));
}

export function isSameWorkout(a: Recording, b: Recording) {
  if (a.elapsedSeconds <= 0 || b.elapsedSeconds <= 0) return false;
  if (!sameSport(a.sport, b.sport)) return false;
  const [shorter, longer] = a.elapsedSeconds <= b.elapsedSeconds ? [a, b] : [b, a];
  const shorterLength = span(shorter).length;
  const shared = sharedMilliseconds(a, b);
  if (shared < MIN_SHARED_FRACTION * shorterLength) return false;
  const durationRatio = shorter.elapsedSeconds / longer.elapsedSeconds;
  const isPiece = shared >= PIECE_FRACTION * shorterLength;
  if (!isPiece && durationRatio < MIN_DURATION_RATIO) return false;
  return distancesAgree(shorter, longer, durationRatio >= COMPARABLE_DURATION_RATIO);
}

function distancesAgree(shorter: Recording, longer: Recording, comparable: boolean) {
  if (isIndoor(shorter.sport) || isIndoor(longer.sport)) return true;
  const shorterDistance = shorter.distanceMetres ?? 0;
  const longerDistance = longer.distanceMetres ?? 0;
  if (shorterDistance <= 0 || longerDistance <= 0) return true;
  if (!comparable) return shorterDistance <= longerDistance * PIECE_DISTANCE_SLACK;
  return (
    Math.min(shorterDistance, longerDistance) / Math.max(shorterDistance, longerDistance) >=
    MIN_DISTANCE_RATIO
  );
}
