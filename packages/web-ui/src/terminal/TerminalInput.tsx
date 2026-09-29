import type { JSX, ReactNode, Ref } from "react";
import { useId } from "react";

export interface TerminalInputProps {
  id: string;
  label: string;
  /** terminal.description with the site delimiter, already resolved. */
  description: string;
  value: string;
  onChange(text: string): void;
  /** The terminal form's native submit (Enter in the input, or the Submit button). */
  onSubmit(): void;
  /** Resolved error texts, shown after a submit attempt. */
  errors: readonly string[];
  /** "n fields not shown", or null. */
  unshown: string | null;
  /** Accessible name of the error list (terminal.errorsLabel, resolved). */
  errorsLabel: string;
  /** Source checkboxes and Submit, as in QueryForm. */
  children?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}

/** Terminal command line (FR-055, FR-056, spec 6.2 "Terminal errors"): text and focus survive a submit. */
export function TerminalInput({
  id,
  label,
  description,
  value,
  onChange,
  onSubmit,
  errors,
  unshown,
  errorsLabel,
  children,
  inputRef,
}: TerminalInputProps): JSX.Element {
  const base = useId();
  const descriptionId = `${base}-description`;
  const unshownId = `${base}-unshown`;
  const errorsId = `${base}-errors`;
  const hasErrors = errors.length > 0;
  const describedBy = [
    descriptionId,
    unshown === null ? null : unshownId,
    hasErrors ? errorsId : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
  return (
    <form
      noValidate
      data-terminal
      data-shortcut-context="terminal"
      className="qm-terminal"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="qm-field">
        <label htmlFor={id} className="qm-field__label">
          {label}
        </label>
        <input
          ref={inputRef}
          id={id}
          name={id}
          type="text"
          className="qm-field__input qm-terminal__input"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          value={value}
          aria-invalid={hasErrors ? "true" : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <p id={descriptionId} className="qm-field__description">
          {description}
        </p>
        {unshown === null ? null : (
          <p id={unshownId} className="qm-field__description">
            {unshown}
          </p>
        )}
        {hasErrors ? (
          <ul id={errorsId} aria-label={errorsLabel} className="qm-terminal__errors">
            {errors.map((text, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an ordered, non-reordering list of resolved texts
              <li key={index} className="qm-field__error">
                {text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {children}
    </form>
  );
}
