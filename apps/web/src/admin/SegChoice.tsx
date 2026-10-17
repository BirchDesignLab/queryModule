import { type KeyboardEvent, useRef } from "react";

/**
 * A segmented choice (mockup v5): native radios in one segmented track, the label drawing each
 * segment (the pattern of the web-ui SegField). The browser gives one Tab stop, and Left, Right,
 * Up and Down move and select; Home and End jump to the first and last here. Focus follows the
 * selection and never moves otherwise. The card preview's Values and the card row's Show in use it.
 */
export function SegChoice<T extends string>({
  label,
  name,
  value,
  options,
  names,
  onChange,
}: {
  /** The group's visible name (the legend). */
  label: string;
  /** The radios' shared name: unique on the page. */
  name: string;
  value: T;
  options: readonly T[];
  names: Readonly<Record<T, string>>;
  onChange(value: T): void;
}) {
  const refs = useRef<Partial<Record<T, HTMLInputElement | null>>>({});
  const jump = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = (e.key === "Home" ? options[0] : options[options.length - 1]) ?? value;
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <fieldset className="qm-segchoice">
      <legend>{label}</legend>
      <div className="qm-seg qm-seg--options qm-seg--fill">
        {options.map((o) => (
          <label key={o} className="qm-seg__option">
            <input
              ref={(el) => {
                refs.current[o] = el;
              }}
              type="radio"
              name={name}
              checked={value === o}
              onChange={() => onChange(o)}
              onKeyDown={jump}
            />
            <span>{names[o]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
