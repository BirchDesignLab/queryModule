import { useContext, useId, useMemo } from "react";
import { useT } from "../app/i18n-context.js";
import { ChecksContext } from "./checks.js";
import { type JsonObject, parseRawDraft } from "./draft.js";
import { lineOf, pointerLines } from "./issues.js";

export interface RawState {
  text: string;
  parseError: string | null;
}

export function RawTab({
  raw,
  setRaw,
  onRawDoc,
}: {
  raw: RawState;
  setRaw(next: RawState): void;
  onRawDoc(doc: JsonObject): void;
}) {
  const t = useT();
  const uid = useId();
  const { text, parseError } = raw;
  const checks = useContext(ChecksContext);
  const errorId = `${uid}-error`;
  const lines = useMemo(() => pointerLines(text), [text]);
  const onEdit = (next: string) => {
    const parsed = parseRawDraft(next);
    setRaw({ text: next, parseError: parsed.ok ? null : parsed.message });
    if (parsed.ok) onRawDoc(parsed.doc);
  };
  return (
    <div>
      <label htmlFor={`${uid}-area`}>{t("admin.config.raw.label")}</label>
      <textarea
        id={`${uid}-area`}
        rows={24}
        cols={80}
        spellCheck={false}
        value={text}
        aria-invalid={parseError !== null}
        aria-describedby={errorId}
        onChange={(e) => onEdit(e.target.value)}
      />
      <div id={errorId}>
        {parseError !== null && <p>{t("admin.config.raw.parseError", { message: parseError })}</p>}
        {parseError === null && checks.issues.length > 0 && (
          <ul>
            {checks.issues.map((issue) => {
              const line = lineOf(lines, issue.pointer);
              const message = `${issue.pointer}: ${t(issue.key, issue.params)}`;
              return (
                <li key={`${issue.pointer}:${issue.key}:${JSON.stringify(issue.params)}`}>
                  {line === undefined
                    ? message
                    : t("admin.config.raw.line", { line: String(line), message })}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
