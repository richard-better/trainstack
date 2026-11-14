import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api, queryClient } from "../api";
import { athleteSettingsQueryKey, browserTimeZone, timeZoneName } from "../lib/time-zone";

export function useAthleteSettings() {
  return useQuery({
    queryKey: athleteSettingsQueryKey,
    queryFn: () => api.settings.get({}),
    staleTime: 60_000,
  });
}

export function useSetTimeZone() {
  return useMutation({
    mutationFn: (timeZone: string) => api.settings.setTimeZone({ timeZone }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: athleteSettingsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["training"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      ]);
    },
  });
}

export function TimeZoneFromBrowser() {
  const settings = useAthleteSettings();
  const setTimeZone = useSetTimeZone();
  const tried = useRef(false);
  useEffect(() => {
    const browser = browserTimeZone();
    if (tried.current || !browser || settings.data?.timeZone !== null) return;
    tried.current = true;
    setTimeZone.mutate(browser);
  }, [settings.data, setTimeZone]);
  return null;
}

const dismissedKey = (stored: string, browser: string) => `time-zone-kept:${stored}:${browser}`;

function wasKept(stored: string, browser: string) {
  try {
    return window.localStorage.getItem(dismissedKey(stored, browser)) === "1";
  } catch {
    return false;
  }
}

function keep(stored: string, browser: string) {
  try {
    window.localStorage.setItem(dismissedKey(stored, browser), "1");
  } catch {
    return;
  }
}

export function useTimeZoneDifference() {
  const settings = useAthleteSettings();
  const stored = settings.data?.timeZone ?? null;
  const browser = browserTimeZone();
  return stored !== null && browser !== null && stored !== browser ? { stored, browser } : null;
}

export function TimeZoneOffer({ where }: { where: "training" | "calendar" | "settings" }) {
  const difference = useTimeZoneDifference();
  const setTimeZone = useSetTimeZone();
  const [kept, setKept] = useState(false);
  if (!difference) return null;
  const { stored, browser } = difference;
  if (where !== "settings" && (kept || wasKept(stored, browser))) return null;
  return (
    <div className="time-zone-offer" role="status">
      <p className="lede">
        Your days end at midnight in {timeZoneName(stored)}, but this browser is in{" "}
        {timeZoneName(browser)}. Changing it decides the day of activities that arrive from now on
        without their own local time, and when today ends. Activities already here keep their day.
      </p>
      <div className="time-zone-actions">
        <button
          type="button"
          className="secondary compact"
          onClick={() => setTimeZone.mutate(browser)}
          disabled={setTimeZone.isPending}
        >
          {setTimeZone.isPending ? "Changing…" : `Use ${timeZoneName(browser)}`}
        </button>
        {where !== "settings" && (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              keep(stored, browser);
              setKept(true);
            }}
          >
            Keep {timeZoneName(stored)}
          </button>
        )}
      </div>
      {setTimeZone.isError && <p className="notice">The time zone was not changed. Try again.</p>}
    </div>
  );
}

export function TimeZoneSetting() {
  const settings = useAthleteSettings();
  const stored = settings.data?.timeZone ?? null;
  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <p className="setting-name">Time zone</p>
          <p className="setting-help">
            Where your days end, for today and for activities without their own local time
          </p>
        </div>
        <div className="setting-value">
          {stored === null ? (
            <span className="muted">{settings.isPending ? "…" : "Not set, so UTC"}</span>
          ) : (
            <strong>{stored.replaceAll("_", " ")}</strong>
          )}
        </div>
      </div>
      <TimeZoneOffer where="settings" />
    </>
  );
}
