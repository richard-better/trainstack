import { useId } from "react";

export function PeriodPicker<Key extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { key: Key; label: string }[];
  value: Key;
  onChange: (key: Key) => void;
}) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label
          key={option.key}
          className="segment"
          data-checked={option.key === value || undefined}
        >
          <input
            type="radio"
            name={name}
            value={option.key}
            checked={option.key === value}
            onChange={() => onChange(option.key)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
