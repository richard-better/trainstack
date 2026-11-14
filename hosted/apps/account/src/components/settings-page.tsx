import type { SettingEntry, SettingWrite } from "@trainstack/contract";
import {
  basisThresholds,
  isThresholdName,
  isValidThresholdValue,
  limitsSettingZoneEnd,
  listedSports,
  type MetricZones,
  metricSettings,
  missingThresholds,
  type Profile,
  profileOn,
  type ThresholdName,
  thresholds,
  usesDefault,
  type ZoneMetric,
  type ZoneModelName,
  type ZoneSet,
  zoneMetricsFor,
  zoneModelGroups,
  zoneModels,
  zonesOf,
} from "@trainstack/zones";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import {
  addableSports,
  changeSummary,
  corrected,
  datedChanges,
  formatDay,
  formatValue,
  formatWeight,
  formatWithUnit,
  historyByDay,
  keyOf,
  latestDayOf,
  listOfWords,
  localDay,
  metricNames,
  metricTitles,
  modelTitle,
  parseValue,
  parseWeight,
  put,
  removal,
  scopeLabel,
  scopeSetUpOn,
  thresholdHelp,
  thresholdRange,
  thresholdTitle,
  thresholdWord,
  thresholdsOf,
  unitOf,
} from "../lib/settings";
import { AccountData } from "./account-data";
import { CalendarFeedSettings } from "./calendar-feed";
import { SaveStatus, SettingsWriter, useSettingsHistory, useWriter } from "./settings-data";
import { TimeZoneSetting } from "./time-zone";
import { ZoneScale, ZoneSwatch, zoneRange } from "./zones";
import { ThresholdSuggestions, useThresholdSuggestions } from "./threshold-suggestions";

export function SettingsPage({
  sport,
  metric,
  confirmDeleting,
}: {
  sport?: string;
  metric?: ZoneMetric;
  confirmDeleting?: boolean;
}) {
  const history = useSettingsHistory();
  return (
    <main className="content settings">
      <div className="page-head">
        <h1 className="page-title">Settings</h1>
      </div>
      {history.isPending ? (
        <div className="skeleton settings-skeleton" aria-busy="true" aria-label="Loading settings">
          <span className="bar" style={{ width: "40%" }} />
          <span className="bar tall" style={{ width: "70%" }} />
          <span className="bar tall" style={{ width: "60%" }} />
        </div>
      ) : history.isError ? (
        <div className="state" role="alert">
          <p className="state-title">Your settings did not load.</p>
          <p className="lede">Check your connection and try again.</p>
          <button type="button" className="secondary" onClick={() => history.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <SettingsWriter>
          <Settings entries={history.data.entries} sport={sport} metric={metric} />
        </SettingsWriter>
      )}
      <CalendarFeedSettings />
      <AccountData confirmDeleting={confirmDeleting} />
    </main>
  );
}

function Settings({
  entries,
  sport,
  metric,
}: {
  entries: SettingEntry[];
  sport?: string;
  metric?: ZoneMetric;
}) {
  const today = localDay(new Date());
  const profile = profileOn(datedChanges(entries), today);
  const listed = listedSports(profile);
  const scope = sport !== undefined && listed.includes(sport) ? sport : null;
  const metrics = zoneMetricsFor(profile, scope);
  const shown = metric !== undefined && metrics.includes(metric) ? metric : metrics[0]!;

  return (
    <>
      <SaveStatus />
      <div className="settings-layout">
        <div className="settings-main">
          <Weight profile={profile} entries={entries} today={today} />
          <section aria-labelledby="zones-title" className="settings-section">
            <h2 id="zones-title" className="section-title">
              Thresholds and zones
            </h2>
            <DetectedThresholds />
            <ScopeTabs listed={listed} scope={scope} today={today} />
            <ScopePanel
              key={`${scope}`}
              profile={profile}
              entries={entries}
              scope={scope}
              metrics={metrics}
              metric={shown}
              today={today}
            />
          </section>
        </div>
        <History entries={entries} today={today} />
      </div>
    </>
  );
}

function DetectedThresholds() {
  const suggestions = useThresholdSuggestions();
  return <ThresholdSuggestions suggestions={suggestions.data?.suggestions ?? []} />;
}

function Weight({
  profile,
  entries,
  today,
}: {
  profile: Profile;
  entries: SettingEntry[];
  today: string;
}) {
  const { save, saving } = useWriter();
  const [editing, setEditing] = useState(false);
  const since = latestDayOf(entries, (change) => change.kind === "weight", today);
  return (
    <section aria-labelledby="athlete-title" className="settings-section">
      <h2 id="athlete-title" className="section-title first">
        Athlete
      </h2>
      <div className="setting-row">
        <div className="setting-text">
          <p className="setting-name">Weight</p>
          <p className="setting-help">Used for power to weight</p>
        </div>
        <SettingValue
          value={profile.weightKg === null ? null : `${formatWeight(profile.weightKg)} kg`}
          since={since}
        />
        {!editing && (
          <button type="button" className="secondary compact" onClick={() => setEditing(true)}>
            {profile.weightKg === null ? "Set" : "Change"}
          </button>
        )}
      </div>
      {editing && (
        <DatedValueForm
          label="Weight"
          unit="kg"
          initial={profile.weightKg === null ? "" : formatWeight(profile.weightKg)}
          initialDay={today}
          today={today}
          inputMode="decimal"
          saving={saving}
          parse={(text) =>
            parseWeight(text) ?? "Enter your weight in kilograms, from 30 to 200, like 72.5."
          }
          onCancel={() => setEditing(false)}
          onSave={(kg, day) =>
            save([put(day, { kind: "weight", kg })], { onSaved: () => setEditing(false) })
          }
        />
      )}
      <TimeZoneSetting />
    </section>
  );
}

function SettingValue({ value, since }: { value: string | null; since: string | null }) {
  return (
    <div className="setting-value">
      {value === null ? <span className="muted">Not set</span> : <strong>{value}</strong>}
      {value !== null && since !== null && (
        <span className="setting-since">since {formatDay(since)}</span>
      )}
    </div>
  );
}

function ScopeTabs({
  listed,
  scope,
  today,
}: {
  listed: string[];
  scope: string | null;
  today: string;
}) {
  const { save, saving } = useWriter();
  const navigate = useNavigate();
  const addable = addableSports(listed);
  const scopes = [null, ...listed];
  return (
    <div className="scope-bar">
      <nav aria-label="Sports" className="scope-tabs">
        {scopes.map((each) => (
          <Link
            key={each ?? "default"}
            to="/settings"
            search={each === null ? {} : { sport: each }}
            className="scope-tab"
            aria-current={each === scope ? "page" : undefined}
          >
            {scopeLabel(each)}
          </Link>
        ))}
      </nav>
      {addable.length > 0 && (
        <label className="add-sport">
          <span className="visually-hidden">Add a sport</span>
          <select
            value=""
            disabled={saving}
            onChange={(event) => {
              const sport = event.target.value;
              if (!sport) return;
              save([put(today, { kind: "sport", sport, listed: true })], {
                onSaved: () => void navigate({ to: "/settings", search: { sport } }),
              });
            }}
          >
            <option value="">Add a sport…</option>
            {addable.map((sport) => (
              <option key={sport} value={sport}>
                {scopeLabel(sport)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function ScopePanel({
  profile,
  entries,
  scope,
  metrics,
  metric,
  today,
}: {
  profile: Profile;
  entries: SettingEntry[];
  scope: string | null;
  metrics: ZoneMetric[];
  metric: ZoneMetric;
  today: string;
}) {
  const { save, saving } = useWriter();
  const navigate = useNavigate();
  const own = scope === null || !usesDefault(profile, metric, scope);
  const settings = metricSettings(profile, metric, scope);
  const search = (each: ZoneMetric) =>
    scope === null ? { metric: each } : { sport: scope, metric: each };

  return (
    <div className="scope-panel">
      <div className="scope-head">
        <p className="lede">
          {scope === null
            ? "Every sport uses these until you add it and give it its own zones."
            : `Zones for your ${scopeLabel(scope).toLowerCase()} activities.`}
        </p>
        {scope !== null && (
          <button
            type="button"
            className="quiet"
            disabled={saving}
            onClick={() =>
              save([put(today, { kind: "sport", sport: scope, listed: false })], {
                onSaved: () => void navigate({ to: "/settings", search: {} }),
              })
            }
          >
            Remove {scopeLabel(scope).toLowerCase()}
          </button>
        )}
      </div>

      {metrics.length > 1 && (
        <nav aria-label="Zone metric" className="segmented">
          {metrics.map((each) => (
            <Link
              key={each}
              to="/settings"
              search={search(each)}
              className="segment"
              aria-current={each === metric ? "page" : undefined}
            >
              {metricTitles[each]}
            </Link>
          ))}
        </nav>
      )}

      {scope !== null && metric !== "pace" && (
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={!own}
            disabled={saving}
            onChange={(event) =>
              save([
                put(today, { kind: "own_zones", sport: scope, metric, own: !event.target.checked }),
              ])
            }
          />
          <span>
            <span className="setting-name">Use Default {metricNames[metric]} zones</span>
            <span className="setting-help">
              Turn off if your {metricNames[metric]} for {scopeLabel(scope).toLowerCase()} differs
              from your other sports
            </span>
          </span>
        </label>
      )}

      {own && settings && (
        <Thresholds
          settings={settings}
          entries={entries}
          scope={scope}
          metric={metric}
          today={today}
        />
      )}

      {settings && (
        <Zones settings={settings} scope={scope} metric={metric} own={own} today={today} />
      )}
    </div>
  );
}

function Thresholds({
  settings,
  entries,
  scope,
  metric,
  today,
}: {
  settings: MetricZones;
  entries: SettingEntry[];
  scope: string | null;
  metric: ZoneMetric;
  today: string;
}) {
  const used = new Set<ThresholdName>(basisThresholds(settings.model));
  const names = thresholdsOf(metric).toSorted((a, b) => Number(used.has(b)) - Number(used.has(a)));
  return (
    <div className="setting-group">
      <h3 className="group-title">Thresholds</h3>
      <ul className="setting-list">
        {names.map((threshold) => (
          <li key={threshold}>
            <ThresholdRow
              entries={entries}
              threshold={threshold}
              value={settings.thresholds[threshold] ?? null}
              used={used.has(threshold) && !settings.customLimits}
              since={latestDayOf(
                entries,
                (change) =>
                  change.kind === "threshold" &&
                  change.threshold === threshold &&
                  change.sport === scope,
                today,
              )}
              scope={scope}
              today={today}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThresholdRow({
  entries,
  threshold,
  value,
  used,
  since,
  scope,
  today,
}: {
  entries: SettingEntry[];
  threshold: ThresholdName;
  value: number | null;
  used: boolean;
  since: string | null;
  scope: string | null;
  today: string;
}) {
  const { save, saving } = useWriter();
  const [editing, setEditing] = useState(false);
  const { metric } = thresholds[threshold];
  const title = thresholdTitle(threshold, scope);
  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <p className="setting-name">
            {title}
            {used && <span className="badge">Sets your zones</span>}
          </p>
          <p className="setting-help">{thresholdHelp(threshold, scope)}</p>
        </div>
        <SettingValue
          value={value === null ? null : formatWithUnit(metric, value, scope)}
          since={since}
        />
        {!editing && (
          <button
            type="button"
            className="secondary compact"
            onClick={() => setEditing(true)}
            aria-label={`${value === null ? "Set" : "Change"} ${title}`}
          >
            {value === null ? "Set" : "Change"}
          </button>
        )}
      </div>
      {editing && (
        <DatedValueForm
          label={title}
          unit={unitOf(metric, scope)}
          initial={value === null ? "" : formatValue(metric, value)}
          initialDay={today}
          today={today}
          inputMode={metric === "pace" ? "text" : "numeric"}
          placeholder={metric === "pace" ? "m:ss" : undefined}
          saving={saving}
          parse={(text) => {
            const parsed = parseValue(metric, text);
            return parsed !== null && isValidThresholdValue(threshold, parsed)
              ? parsed
              : `Enter ${metric === "pace" ? "a pace as minutes:seconds" : "a whole number"} from ${thresholdRange(threshold, scope)}.`;
          }}
          onCancel={() => setEditing(false)}
          onSave={(parsed, day) =>
            save(
              [
                ...scopeSetUpOn(entries, day, scope, metric),
                put(day, { kind: "threshold", sport: scope, threshold, value: parsed }),
              ],
              {
                onSaved: () => setEditing(false),
              },
            )
          }
        />
      )}
    </>
  );
}

function DatedValueForm({
  label,
  unit,
  initial,
  initialDay,
  today,
  inputMode,
  placeholder,
  saving,
  parse,
  onSave,
  onCancel,
}: {
  label: string;
  unit: string;
  initial: string;
  initialDay: string;
  today: string;
  inputMode: "numeric" | "decimal" | "text";
  placeholder?: string;
  saving: boolean;
  parse: (text: string) => number | string;
  onSave: (value: number, day: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const [day, setDay] = useState(initialDay);
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parse(text);
    if (typeof parsed === "string") {
      setProblem(parsed);
      return;
    }
    if (!day || day > today) {
      setProblem("Pick a day no later than today.");
      return;
    }
    setProblem(null);
    onSave(parsed, day);
  }

  return (
    <form
      className="dated-form"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-value`}>{label}</label>
        <span className="input-with-unit">
          <input
            id={`${id}-value`}
            value={text}
            inputMode={inputMode}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(event) => setText(event.target.value)}
            aria-invalid={problem !== null}
            aria-describedby={problem ? `${id}-problem` : undefined}
            autoFocus
          />
          <span className="unit">{unit}</span>
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-day`}>From</label>
        <input
          id={`${id}-day`}
          type="date"
          value={day}
          max={today}
          required
          onChange={(event) => setDay(event.target.value)}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {problem && (
        <p id={`${id}-problem`} className="notice form-problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

function Zones({
  settings,
  scope,
  metric,
  own,
  today,
}: {
  settings: MetricZones;
  scope: string | null;
  metric: ZoneMetric;
  own: boolean;
  today: string;
}) {
  const { save, saving } = useWriter();
  const id = useId();
  const zones = zonesOf(settings);
  const custom = settings.customLimits !== null;
  const basis = listOfWords(
    basisThresholds(settings.model).map((name) => thresholdWord(name, scope)),
  );
  const caption = custom
    ? `Your own boundaries, based on ${modelTitle(settings.model)}`
    : `Worked out from your ${basis}`;
  const missing = missingThresholds(settings);
  const chooseModel = (model: ZoneModelName) =>
    save([put(today, { kind: "zones", sport: scope, metric, model, customLimits: null })]);

  return (
    <div className="setting-group">
      <h3 className="group-title">{own ? "Zones" : `Default ${metricNames[metric]} zones`}</h3>
      {!own && (
        <p className="lede">
          {scopeLabel(scope)} uses your{" "}
          <Link to="/settings" search={{ metric }}>
            Default {metricNames[metric]} zones
          </Link>
          .
        </p>
      )}
      <div className="setting-row model-row">
        <div className="setting-text">
          <label className="setting-name" htmlFor={`${id}-model`}>
            Zone model
          </label>
          <p className="setting-help" id={`${id}-caption`}>
            {caption}
          </p>
        </div>
        {own ? (
          <select
            id={`${id}-model`}
            className="model-select"
            value={custom ? "" : settings.model}
            disabled={saving}
            aria-describedby={`${id}-caption`}
            onChange={(event) => {
              const model = event.target.value;
              if (model in zoneModels) chooseModel(model as ZoneModelName);
            }}
          >
            {custom && (
              <option value="" disabled>
                Custom
              </option>
            )}
            {zoneModelGroups(metric, scope).map((group) => (
              <optgroup key={group.title} label={group.title}>
                {group.models.map((model) => (
                  <option key={model} value={model}>
                    {modelTitle(model)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <strong id={`${id}-model`}>{custom ? "Custom" : modelTitle(settings.model)}</strong>
        )}
      </div>
      {own && custom && (
        <button
          type="button"
          className="secondary restore"
          disabled={saving}
          onClick={() => chooseModel(settings.model)}
        >
          Go back to {zoneModels[settings.model].name} zones
        </button>
      )}
      {zones ? (
        <>
          <ZoneScale set={zones} thresholds={settings.thresholds} sport={scope} />
          <ZoneTable set={zones} settings={settings} scope={scope} editable={own} today={today} />
          {own && (
            <p className="setting-help zone-footnote">
              Change where a zone ends, and the next zone starts from it. Changing a threshold works
              every zone out again, unless they are your own.
            </p>
          )}
        </>
      ) : (
        <p className="lede missing">
          {missing.length > 0
            ? `Add your ${listOfWords(missing.map((name) => thresholdWord(name, scope)))} to see these zones.`
            : "These thresholds leave no room for every zone. Check that they are in order."}
        </p>
      )}
    </div>
  );
}

function ZoneTable({
  set,
  settings,
  scope,
  editable,
  today,
}: {
  set: ZoneSet;
  settings: MetricZones;
  scope: string | null;
  editable: boolean;
  today: string;
}) {
  const reference = isThresholdName(basisThresholds(settings.model)[0] ?? "")
    ? settings.thresholds[basisThresholds(settings.model)[0]!]
    : undefined;
  const percentOf = (value: number) =>
    reference ? `${Math.round((value / reference) * 100)}%` : "";
  return (
    <div className="table-scroll">
      <table className="zone-table">
        <thead>
          <tr>
            <th scope="col">Zone</th>
            <th scope="col" className="numeric">
              From
            </th>
            <th scope="col" className="numeric">
              To
            </th>
            {reference !== undefined && settings.model !== "karvonen" && (
              <th scope="col" className="numeric percent-column">
                % of {thresholds[basisThresholds(settings.model)[0]!].abbreviation}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {set.zones.map((zone) => (
            <tr key={zone.index}>
              <th scope="row">
                <ZoneSwatch zone={zone} count={set.zones.length} />
                <span className="zone-label">{zone.label}</span>
                <span className="zone-name">{zone.name}</span>
              </th>
              <td className="numeric">
                {zone.start === null ? (
                  <span className="muted">{set.descending ? "slower" : "0"}</span>
                ) : (
                  formatValue(set.metric, zone.start)
                )}
              </td>
              <td className="numeric">
                {zone.end === null ? (
                  <span className="muted">{set.descending ? "faster" : "and up"}</span>
                ) : editable ? (
                  <ZoneEndField set={set} index={zone.index} scope={scope} today={today} />
                ) : (
                  formatValue(set.metric, zone.end)
                )}
              </td>
              {reference !== undefined && settings.model !== "karvonen" && (
                <td className="numeric muted percent-column">
                  {zone.start === null
                    ? `${set.descending ? "over" : "under"} ${percentOf(set.zones[1]!.start!)}`
                    : zone.end === null
                      ? `${percentOf(zone.start)} ${set.descending ? "and faster" : "and up"}`
                      : `${percentOf(set.descending ? zone.end : zone.start)}-${percentOf(set.descending ? zone.start : zone.end)}`}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="visually-hidden">
        {set.zones
          .map(
            (zone) =>
              `Zone ${zone.label} ${zone.name}: ${zoneRange(set, zone, set.metric, scope)}.`,
          )
          .join(" ")}
      </p>
    </div>
  );
}

function ZoneEndField({
  set,
  index,
  scope,
  today,
}: {
  set: ZoneSet;
  index: number;
  scope: string | null;
  today: string;
}) {
  const { save, saving, settled } = useWriter();
  const zone = set.zones[index]!;
  const current = formatValue(set.metric, zone.end!);
  const [text, setText] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState({ current, settled });
  if (shown.current !== current || shown.settled !== settled) {
    setShown({ current, settled });
    setText(current);
    setProblem(null);
  }
  const id = useId();

  function commit() {
    if (text.trim() === current) return;
    const value = parseValue(set.metric, text);
    const limits = value === null ? null : limitsSettingZoneEnd(set, index, value);
    if (!limits) {
      setProblem(
        value === null
          ? set.metric === "pace"
            ? "Enter a pace as minutes:seconds."
            : "Enter a whole number."
          : "That leaves no room for a zone next to it.",
      );
      return;
    }
    setProblem(null);
    save([
      put(today, {
        kind: "zones",
        sport: scope,
        metric: set.metric,
        model: set.model,
        customLimits: limits,
      }),
    ]);
  }

  return (
    <span className="zone-end">
      <input
        className="zone-end-input"
        value={text}
        inputMode={set.metric === "pace" ? "text" : "numeric"}
        aria-label={`End of zone ${zone.label}, ${zone.name}`}
        aria-invalid={problem !== null}
        aria-describedby={problem ? `${id}-problem` : undefined}
        disabled={saving}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setText(current);
            setProblem(null);
          }
        }}
      />
      {problem && (
        <span id={`${id}-problem`} className="notice zone-end-problem" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}

function History({ entries, today }: { entries: SettingEntry[]; today: string }) {
  const days = historyByDay(entries);
  return (
    <aside className="settings-history" aria-labelledby="history-title">
      <h2 id="history-title" className="section-title first">
        History
      </h2>
      <p className="setting-help">
        Each activity uses the settings that held on its day. A change holds until a later change to
        the same setting, and activities from before the first change use the earliest settings.
      </p>
      {days.length === 0 ? (
        <p className="lede history-empty">
          No changes yet. Changes to your thresholds, zones and weight show here.
        </p>
      ) : (
        <ol className="history-days">
          {days.map(({ day, entries: changes }) => (
            <li key={day}>
              <h3 className="history-day">
                <time dateTime={day}>{formatDay(day)}</time>
              </h3>
              <ul className="history-changes">
                {changes.map((entry) => (
                  <HistoryEntry
                    entries={entries}
                    key={JSON.stringify(keyOf(entry.change))}
                    entry={entry}
                    today={today}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function HistoryEntry({
  entries,
  entry,
  today,
}: {
  entries: SettingEntry[];
  entry: SettingEntry;
  today: string;
}) {
  const { save, saving } = useWriter();
  const [editing, setEditing] = useState(false);
  const summary = changeSummary(entry.change);
  const editor = editorFor(entries, entry, today, saving, (writes) =>
    save(writes, { onSaved: () => setEditing(false) }),
  );
  return (
    <li className="history-change">
      <div className="history-line">
        <span>{summary}</span>
        <span className="history-actions">
          {editor && !editing && (
            <button
              type="button"
              className="quiet"
              onClick={() => setEditing(true)}
              aria-label={`Correct ${summary} on ${formatDay(entry.day)}`}
            >
              Correct
            </button>
          )}
          <button
            type="button"
            className="quiet danger"
            disabled={saving}
            onClick={() => save([removal(entry.day, keyOf(entry.change))])}
            aria-label={`Remove ${summary} on ${formatDay(entry.day)}`}
          >
            Remove
          </button>
        </span>
      </div>
      {editing && editor?.(() => setEditing(false))}
    </li>
  );
}

function editorFor(
  entries: SettingEntry[],
  entry: SettingEntry,
  today: string,
  saving: boolean,
  send: (writes: SettingWrite[]) => void,
): ((onCancel: () => void) => ReactNode) | null {
  const { change } = entry;
  if (change.kind === "weight") {
    return (onCancel) => (
      <DatedValueForm
        label="Weight"
        unit="kg"
        initial={formatWeight(change.kg)}
        initialDay={entry.day}
        today={today}
        inputMode="decimal"
        saving={saving}
        parse={(text) => parseWeight(text) ?? "Enter your weight in kilograms, from 30 to 200."}
        onCancel={onCancel}
        onSave={(kg, day) => send(corrected(entry, day, { kind: "weight", kg }))}
      />
    );
  }
  if (change.kind === "threshold" && isThresholdName(change.threshold)) {
    const threshold = change.threshold;
    const { metric } = thresholds[threshold];
    return (onCancel) => (
      <DatedValueForm
        label={`${scopeLabel(change.sport)} ${thresholdTitle(threshold, change.sport)}`}
        unit={unitOf(metric, change.sport)}
        initial={change.value === null ? "" : formatValue(metric, change.value)}
        initialDay={entry.day}
        today={today}
        inputMode={metric === "pace" ? "text" : "numeric"}
        placeholder={metric === "pace" ? "m:ss" : undefined}
        saving={saving}
        parse={(text) => {
          const parsed = parseValue(metric, text);
          return parsed !== null && isValidThresholdValue(threshold, parsed)
            ? parsed
            : `Enter a value from ${thresholdRange(threshold, change.sport)}.`;
        }}
        onCancel={onCancel}
        onSave={(value, day) =>
          send([
            ...scopeSetUpOn(entries, day, change.sport, metric),
            ...corrected(entry, day, { kind: "threshold", sport: change.sport, threshold, value }),
          ])
        }
      />
    );
  }
  return null;
}
