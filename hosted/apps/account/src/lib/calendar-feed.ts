export const calendarFeedQueryKey = ["calendarFeed"] as const;

export const feedUrl = (serverUrl: string, path: string) =>
  `${serverUrl.replace(/\/+$/, "")}${path}`;

export const subscribeUrl = (url: string) => url.replace(/^https?:/, "webcal:");

export const googleCalendarUrl = (url: string) =>
  `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(subscribeUrl(url))}`;

export const outlookUrl = (url: string) =>
  `https://outlook.live.com/calendar/0/addfromweb?${new URLSearchParams({ url, name: "Trainstack" })}`;

export function whatSubscribersSee({
  withActivities,
  weeksBack,
  weeksAhead,
}: {
  withActivities: boolean;
  weeksBack: number;
  weeksAhead: number;
}) {
  return [
    `Your planned workouts from ${weeksBack} weeks ago to ${weeksAhead} weeks ahead: each one's day, sport, name, planned time, distance and load, its steps, and your notes on it`,
    "Notes and rest days you put on your calendar, with their text",
    "Whether you did, skipped or missed each workout, but not why you skipped it",
    ...(withActivities
      ? [
          `Your activities of the last ${weeksBack} weeks: sport, name as you wrote it, when you started, how long, distance and load`,
        ]
      : []),
  ];
}
