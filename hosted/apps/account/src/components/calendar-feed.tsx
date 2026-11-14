import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CALENDAR_FEED_WEEKS_AHEAD,
  CALENDAR_FEED_WEEKS_BACK,
  type CalendarFeed,
} from "@trainstack/contract";
import { useRef, useState } from "react";

import { api, queryClient } from "../api";
import {
  calendarFeedQueryKey,
  feedUrl,
  googleCalendarUrl,
  outlookUrl,
  subscribeUrl,
  whatSubscribersSee,
} from "../lib/calendar-feed";

const serverUrl = import.meta.env.VITE_SERVER_URL;

function useFeedChange<Input>(change: (input: Input) => Promise<CalendarFeed | null>) {
  return useMutation({
    mutationFn: change,
    scope: { id: "calendar-feed" },
    onSuccess: (feed) => queryClient.setQueryData(calendarFeedQueryKey, { feed }),
  });
}

export function CalendarFeedSettings() {
  const feed = useQuery({
    queryKey: calendarFeedQueryKey,
    queryFn: () => api.calendarFeed.get({}),
  });
  return (
    <section aria-labelledby="calendar-feed-title" className="settings-section calendar-feed">
      <h2 id="calendar-feed-title" className="section-title">
        Calendar feed
      </h2>
      <p className="lede">
        See your training next to everything else in Apple Calendar, Google Calendar or Outlook.
        Your calendar app fetches it from a private address, and Trainstack gets no access to your
        calendar.
      </p>
      {feed.isPending ? (
        <p className="lede" aria-busy="true">
          Loading…
        </p>
      ) : feed.isError ? (
        <div className="calendar-feed-state" role="alert">
          <p className="notice">Your calendar feed did not load.</p>
          <button type="button" className="secondary compact" onClick={() => feed.refetch()}>
            Try again
          </button>
        </div>
      ) : feed.data.feed ? (
        <FeedOn feed={feed.data.feed} />
      ) : (
        <FeedOff />
      )}
    </section>
  );
}

function Contents({
  withActivities,
  disabled,
  onChange,
}: {
  withActivities: boolean;
  disabled: boolean;
  onChange: (withActivities: boolean) => void;
}) {
  return (
    <fieldset className="feed-contents" disabled={disabled}>
      <legend className="setting-name">What the feed shows</legend>
      <label className="toggle-row">
        <input
          type="radio"
          name="calendar-feed-contents"
          checked={!withActivities}
          onChange={() => onChange(false)}
        />
        <span>
          <span className="setting-name">Planned workouts</span>
          <span className="setting-help">
            Workouts, notes and rest days you planned, each on its day
          </span>
        </span>
      </label>
      <label className="toggle-row">
        <input
          type="radio"
          name="calendar-feed-contents"
          checked={withActivities}
          onChange={() => onChange(true)}
        />
        <span>
          <span className="setting-name">Planned workouts and activities</span>
          <span className="setting-help">
            Also what you did, at the time you did it, with its distance and load
          </span>
        </span>
      </label>
    </fieldset>
  );
}

function WhatSubscribersSee({ withActivities }: { withActivities: boolean }) {
  return (
    <div className="feed-privacy">
      <p className="setting-name">Anyone with the address can see, without signing in:</p>
      <ul>
        {whatSubscribersSee({
          withActivities,
          weeksBack: CALENDAR_FEED_WEEKS_BACK,
          weeksAhead: CALENDAR_FEED_WEEKS_AHEAD,
        }).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="setting-help">
        It never shows your routes or where you were, or the heart rate, power or other readings
        your activities recorded. Calendar services such as Google keep a copy on their servers.
        Keep the address private like a password, and make a new one if it gets out.
      </p>
    </div>
  );
}

function FeedOff() {
  const [withActivities, setWithActivities] = useState(false);
  const turnOn = useFeedChange(() => api.calendarFeed.newAddress({ withActivities }));
  return (
    <>
      <Contents
        withActivities={withActivities}
        disabled={turnOn.isPending}
        onChange={setWithActivities}
      />
      <WhatSubscribersSee withActivities={withActivities} />
      <div className="feed-actions">
        <button
          type="button"
          className="primary compact"
          onClick={() => turnOn.mutate(undefined)}
          disabled={turnOn.isPending}
        >
          {turnOn.isPending ? "Turning on…" : "Turn on the calendar feed"}
        </button>
      </div>
      {turnOn.isError && <p className="notice">The feed was not turned on. Try again.</p>}
    </>
  );
}

function FeedOn({ feed }: { feed: CalendarFeed }) {
  const url = feedUrl(serverUrl, feed.path);
  const [copied, setCopied] = useState(false);
  const renewDialog = useRef<HTMLDialogElement>(null);
  const offDialog = useRef<HTMLDialogElement>(null);
  const setActivities = useFeedChange((withActivities: boolean) =>
    api.calendarFeed.setActivities({ withActivities }),
  );
  const renew = useFeedChange(() => api.calendarFeed.newAddress({}));
  const turnOff = useFeedChange(async () => {
    await api.calendarFeed.turnOff({});
    return null;
  });
  const withActivities = setActivities.isPending
    ? (setActivities.variables ?? feed.withActivities)
    : feed.withActivities;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="feed-address">
        <label className="setting-name" htmlFor="calendar-feed-address">
          Address
        </label>
        <div className="feed-address-row">
          <input
            id="calendar-feed-address"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            spellCheck={false}
          />
          <button type="button" className="secondary compact" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="setting-help">
          Add it to your calendar app as a subscription. Most apps fetch it every hour or so; Google
          Calendar can take up to a day.
        </p>
        <div className="feed-links">
          <a className="link-button secondary compact" href={subscribeUrl(url)}>
            Add to Apple Calendar
          </a>
          <a
            className="link-button secondary compact"
            href={googleCalendarUrl(url)}
            target="_blank"
            rel="noreferrer"
          >
            Add to Google Calendar
          </a>
          <a
            className="link-button secondary compact"
            href={outlookUrl(url)}
            target="_blank"
            rel="noreferrer"
          >
            Add to Outlook.com
          </a>
        </div>
      </div>
      <Contents
        withActivities={withActivities}
        disabled={setActivities.isPending}
        onChange={(next) => setActivities.mutate(next)}
      />
      {setActivities.isError && <p className="notice">The feed was not changed. Try again.</p>}
      <WhatSubscribersSee withActivities={withActivities} />
      <div className="feed-actions">
        <button
          type="button"
          className="secondary compact"
          onClick={() => renewDialog.current?.showModal()}
        >
          New address…
        </button>
        <button
          type="button"
          className="secondary compact danger"
          onClick={() => offDialog.current?.showModal()}
        >
          Turn off…
        </button>
      </div>
      <dialog
        ref={renewDialog}
        className="confirm"
        aria-labelledby="renew-feed-title"
        onClose={() => renew.reset()}
      >
        <h2 id="renew-feed-title">Make a new address?</h2>
        <p className="lede">
          The current address stops working at once, so calendars subscribed to it stop getting your
          training. Add the new address to the calendars you want to keep it in.
        </p>
        {renew.isError && <p className="notice">No new address was made. Try again.</p>}
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => renewDialog.current?.close()}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={renew.isPending}
            onClick={() =>
              renew.mutate(undefined, { onSuccess: () => renewDialog.current?.close() })
            }
          >
            {renew.isPending ? "Making…" : "Make a new address"}
          </button>
        </div>
      </dialog>
      <dialog
        ref={offDialog}
        className="confirm"
        aria-labelledby="feed-off-title"
        onClose={() => turnOff.reset()}
      >
        <h2 id="feed-off-title">Turn off the calendar feed?</h2>
        <p className="lede">
          The address stops working at once, and calendars subscribed to it stop getting your
          training. Turning it on again makes a new address.
        </p>
        {turnOff.isError && <p className="notice">The feed is still on. Try again.</p>}
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => offDialog.current?.close()}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            disabled={turnOff.isPending}
            onClick={() => turnOff.mutate(undefined)}
          >
            {turnOff.isPending ? "Turning off…" : "Turn off"}
          </button>
        </div>
      </dialog>
    </>
  );
}
