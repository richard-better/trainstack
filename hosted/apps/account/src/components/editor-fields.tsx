import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

type FieldErrors = { report: (id: string, invalid: boolean) => void };

const FieldErrorsContext = createContext<FieldErrors>({ report: () => {} });

export function useFieldErrors() {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const errors = useMemo<FieldErrors>(
    () => ({
      report: (id, bad) =>
        setInvalid((current) => {
          if (current.has(id) === bad) return current;
          const next = new Set(current);
          if (bad) next.add(id);
          else next.delete(id);
          return next;
        }),
    }),
    [],
  );
  return { invalid, errors };
}

export function FieldErrorsProvider({
  errors,
  children,
}: {
  errors: FieldErrors;
  children: ReactNode;
}) {
  return <FieldErrorsContext.Provider value={errors}>{children}</FieldErrorsContext.Provider>;
}

export type Parse<Value> = (text: string) => Value | null;

export function TextField<Value>({
  label,
  value,
  format,
  parse,
  onCommit,
  unit,
  hint,
  problem,
  inputMode,
  width,
  hideLabel,
}: {
  label: string;
  value: Value;
  format: (value: Value) => string;
  parse: Parse<Value>;
  onCommit: (value: Value) => void;
  unit?: string;
  hint?: string;
  problem?: string | undefined;
  inputMode?: "numeric" | "decimal" | "text";
  width?: number;
  hideLabel?: boolean;
}) {
  const id = useId();
  const { report } = useContext(FieldErrorsContext);
  const [text, setText] = useState(() => format(value));
  const parsed = parse(text);
  const invalid = parsed === null;

  const latest = useRef({ text, format, parse });
  latest.current = { text, format, parse };
  useEffect(() => {
    const { text: current, format: show, parse: read } = latest.current;
    if (Object.is(read(current), value)) return;
    setText(show(value));
  }, [value]);

  useEffect(() => {
    report(id, invalid);
    return () => report(id, false);
  }, [id, invalid, report]);

  const message = invalid ? (hint ?? "Enter a valid value") : problem;
  return (
    <label className="field editor-field" htmlFor={id}>
      <span className={hideLabel ? "visually-hidden" : undefined}>{label}</span>
      <span className="input-with-unit">
        <input
          id={id}
          value={text}
          inputMode={inputMode}
          style={width ? { width } : undefined}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-problem` : undefined}
          onBlur={() => {
            const committed = parse(text);
            if (committed !== null) setText(format(committed));
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setText(next);
            const committed = parse(next);
            if (committed !== null) onCommit(committed);
          }}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </span>
      {message && (
        <span id={`${id}-problem`} className="field-problem" role={invalid ? "alert" : undefined}>
          {message}
        </span>
      )}
    </label>
  );
}

export function Select<Value extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: Value;
  options: readonly (readonly [Value, string])[];
  onChange: (value: Value) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <label className="field editor-field" htmlFor={id}>
      <span className={hideLabel ? "visually-hidden" : undefined}>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as Value)}
      >
        {options.map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly (readonly [Value, string])[];
  onChange: (value: Value) => void;
}) {
  const name = useId();
  return (
    <fieldset className="editor-segmented">
      <legend className="field-legend">{label}</legend>
      <div className="segmented">
        {options.map(([key, title]) => (
          <label key={key} className="segment" data-checked={value === key || undefined}>
            <input
              type="radio"
              name={name}
              value={key}
              checked={value === key}
              onChange={() => onChange(key)}
              className="visually-hidden"
            />
            {title}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export const parseClock: Parse<number> = (text) => {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  const seconds = numbers.reduce((total, part) => total * 60 + part, 0);
  if (parts.length > 1 && numbers.slice(1).some((part) => part >= 60)) return null;
  return seconds;
};

export const formatClock = (seconds: number) => {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
};

export const parseNumber =
  (min: number, max: number, digits = 0): Parse<number> =>
  (text) => {
    const trimmed = text.trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const value = Number(trimmed);
    if (value < min || value > max) return null;
    return Number(value.toFixed(digits));
  };

export const formatNumber =
  (digits = 0) =>
  (value: number) =>
    Number(value.toFixed(digits)).toString();
