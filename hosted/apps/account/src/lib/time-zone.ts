export const athleteSettingsQueryKey = ["settings", "athlete"] as const;

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export const timeZoneName = (timeZone: string) => timeZone.split("/").at(-1)!.replaceAll("_", " ");

export function todayIn(timeZone: string | null, now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
