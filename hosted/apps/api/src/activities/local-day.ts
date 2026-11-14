import type { ActivityLocalDaySource } from "@trainstack/contract";

export const DEFAULT_TIME_ZONE = "UTC";

const OFFSET_ZONE = /^([+-])(\d{2}):(\d{2})$/;

export function offsetZone(utcOffsetSeconds: number) {
  const minutes = Math.round(Math.abs(utcOffsetSeconds) / 60);
  const sign = utcOffsetSeconds < 0 ? "-" : "+";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function isTimeZone(name: string) {
  if (OFFSET_ZONE.test(name) || name.startsWith("+") || name.startsWith("-")) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export function dayIn(zone: string, instant: Date) {
  const offset = OFFSET_ZONE.exec(zone);
  if (offset) {
    const minutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "-" ? -1 : 1);
    return isoDay(new Date(instant.getTime() + minutes * 60_000));
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type LocalDay = {
  day: string;
  source: ActivityLocalDaySource;
  zone: string | null;
};

export type StoredLocalDay = {
  localDay: string | null;
  localDaySource: ActivityLocalDaySource | null;
  localDayZone: string | null;
};

export function localDayOf({
  instant,
  fileUtcOffsetSeconds,
  stored,
  athleteTimeZone,
}: {
  instant: Date;
  fileUtcOffsetSeconds: number | undefined;
  stored: StoredLocalDay;
  athleteTimeZone: string | null;
}): LocalDay {
  if (stored.localDaySource === "athlete" && stored.localDay) {
    return { day: stored.localDay, source: "athlete", zone: stored.localDayZone };
  }
  if (fileUtcOffsetSeconds !== undefined) {
    const zone = offsetZone(fileUtcOffsetSeconds);
    return { day: dayIn(zone, instant), source: "file", zone };
  }
  if (stored.localDaySource && stored.localDayZone) {
    const zone = stored.localDayZone;
    return { day: dayIn(zone, instant), source: stored.localDaySource, zone };
  }
  const zone = athleteTimeZone ?? DEFAULT_TIME_ZONE;
  return { day: dayIn(zone, instant), source: "time_zone", zone };
}
