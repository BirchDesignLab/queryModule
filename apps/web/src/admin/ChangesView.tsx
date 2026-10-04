import { diffConfig } from "@querymodule/core/config";
import { VisuallyHidden } from "@querymodule/web-ui";
import { type ReactNode, useContext, useId, useMemo } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useDraft } from "./builder-store.js";
import {
  buildChangeGroups,
  type ChangeDeps,
  type ChangeEntry,
  type ChangeGroup,
  type ChangeValue,
  labelGroup,
  missingLabels,
  ownerName,
} from "./changes.js";
import { ChecksContext, own, type ShippedBundles } from "./checks.js";
import { useLabelText } from "./controls.js";
import type { JsonObject } from "./draft.js";
import { useItemName } from "./FormTab.js";
import { languageName } from "./LabelOverlay.js";
import { useConditionWords } from "./RulesEditor.js";
import { useLiveDoc } from "./use-cached-config.js";

/**
 * What a locale is served now for a label key (the shipped text, or the live overlay's): "" when
 * nothing, null while the bundles are not loaded.
 */
function servedText(served: ShippedBundles | null, locale: string, key: string): string | null {
  if (served === null) return null;
  // Own properties only: a key named like an object member ("constructor") is not served text.
  const bundle = locale === "en" ? served.en : own(served.perLocale, locale);
  if (bundle === undefined) return null;
  const text = own(bundle, key);
  return typeof text === "string" ? text : "";
}

/**
 * Changes (item 4): what the draft changes against the live config, grouped by query type, list,
 * command and quick access. Read-only: nothing here writes, and each entry opens its item in the
 * builder. Plain names lead; keys are in hidden text. It adds no live region of its own.
 */
export function ChangesView({
  doc,
  onOpen,
}: {
  doc: JsonObject;
  /**
   * Opens an item in the Form view and puts focus in it (a user action, so focus may move). Without
   * it the list is for reading only, as in the publish dialog.
   */
  onOpen?: (pointer: string) => void;
}) {
  const t = useT();
  const translator = useTranslator();
  const { doc: live, check } = useLiveDoc();
  const { labels } = useDraft();
  const { issues, status, served } = useContext(ChecksContext);
  const labelText = useLabelText();
  const itemName = useItemName();
  const headingId = useId();
  const language = useMemo(
    () => (locale: string) => languageName(locale, translator.locale),
    [translator.locale],
  );
  const deps = useMemo<ChangeDeps>(() => ({ t, labelText, itemName }), [t, labelText, itemName]);
  const groups = useMemo<ChangeGroup[]>(() => {
    if (live === null) return [];
    const list = buildChangeGroups(diffConfig(live, doc), live, doc, deps);
    const overlay = labelGroup(
      Object.entries(labels).flatMap(([locale, texts]) =>
        Object.entries(texts).map(([key, text]) => ({
          locale,
          key,
          text,
          // The live text of that language (shipped, or the live overlay's; M1 exit Q1): "" when
          // it has none, unknown until the bundles load.
          shipped: servedText(served, locale, key),
        })),
      ),
      language,
      t,
    );
    return overlay === null ? list : [...list, overlay];
  }, [live, doc, deps, labels, served, language, t]);
  const missing = useMemo(
    () =>
      missingLabels(
        issues
          .filter((i) => i.key === "config.missingLabel")
          .map((i) => ({
            labelKey: String(i.params.labelKey ?? ""),
            locale: String(i.params.locale ?? ""),
            pointer: i.pointer,
          })),
        doc,
        language,
        (pointer) => ownerName(doc, pointer, deps),
      ),
    [issues, doc, language, deps],
  );
  return (
    <section className="qm-diff" aria-labelledby={headingId} aria-busy={check === "checking"}>
      <h3 className="qm-editor__title" id={headingId}>
        {t("admin.diff.title")}
      </h3>
      <p className="qm-diff__note">
        {t(onOpen === undefined ? "admin.diff.noteStatic" : "admin.diff.note")}
      </p>
      {check === "checking" && <p className="qm-diff__note">{t("admin.diff.checking")}</p>}
      {check === "failed" && <p className="qm-diff__note">{t("admin.diff.failed")}</p>}
      {live === null ? (
        <p>{t("admin.diff.noLive")}</p>
      ) : (
        groups.length === 0 &&
        check !== "checking" && <p data-testid="diff-empty">{t("admin.diff.noChanges")}</p>
      )}
      {groups.map((group) => (
        <GroupView key={group.id} group={group} onOpen={onOpen} />
      ))}
      {status === "ready" && missing.length > 0 && (
        <section className="qm-diff__group">
          <h4 className="qm-diff__title">{t("admin.diff.missing.title")}</h4>
          <p className="qm-diff__note">{t("admin.diff.missing.note")}</p>
          <ul className="qm-diff__list">
            {missing.map((row) => (
              <li key={row.labelKey}>
                <Row onOpen={onOpen === undefined ? undefined : () => onOpen(row.target)}>
                  <span className="qm-diff__what">{row.owner}</span>
                  <span className="qm-diff__values">
                    {t("admin.diff.missing.in", { languages: row.languages.join(", ") })}
                  </span>
                  <VisuallyHidden>{row.labelKey}</VisuallyHidden>
                </Row>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function GroupView({ group, onOpen }: { group: ChangeGroup; onOpen?: (pointer: string) => void }) {
  return (
    <section className="qm-diff__group">
      <h4 className="qm-diff__title">
        {group.title}
        <VisuallyHidden> {group.keyText}</VisuallyHidden>
      </h4>
      {group.sections.map((s) => (
        <div key={s.id} className="qm-diff__section">
          {s.title !== null && (
            <h5 className="qm-diff__subtitle">
              {s.title}
              {s.keyText !== "" && <VisuallyHidden> {s.keyText}</VisuallyHidden>}
            </h5>
          )}
          <ul className="qm-diff__list">
            {s.entries.map((entry) => (
              <li key={entry.id}>
                <EntryButton entry={entry} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** An entry row: a button that opens its item, or plain text where the list is for reading. */
function Row({ onOpen, children }: { onOpen: (() => void) | undefined; children: ReactNode }) {
  if (onOpen === undefined)
    return <div className="qm-diff__entry qm-diff__entry--static">{children}</div>;
  return (
    <button type="button" className="qm-button qm-button--ghost qm-diff__entry" onClick={onOpen}>
      {children}
    </button>
  );
}

function EntryButton({
  entry,
  onOpen,
}: {
  entry: ChangeEntry;
  onOpen?: (pointer: string) => void;
}) {
  const t = useT();
  return (
    <Row onOpen={onOpen === undefined ? undefined : () => onOpen(entry.target)}>
      <span className="qm-badge qm-diff__kind">{t(`admin.diff.kind.${entry.kind}`)}</span>
      <span className="qm-diff__what">{entry.what}</span>
      <span className="qm-diff__values">
        {entry.before !== undefined && (
          <span className="qm-diff__side">
            <span className="qm-diff__tag">{t("admin.diff.was")}</span>{" "}
            <Value value={entry.before} />
          </span>
        )}
        {entry.after !== undefined && (
          <span className="qm-diff__side">
            <span className="qm-diff__tag">{t("admin.diff.now")}</span>{" "}
            <Value value={entry.after} />
          </span>
        )}
      </span>
      <VisuallyHidden>{entry.keyText}</VisuallyHidden>
    </Row>
  );
}

function Value({ value }: { value: ChangeValue }) {
  if ("text" in value) return <span className="qm-diff__value">{value.text}</span>;
  return <RuleSentence rule={value.rule} type={value.type} />;
}

/** A rule as the editor writes it: a sentence in plain words. */
function RuleSentence({ rule, type }: { rule: JsonObject; type: JsonObject }) {
  const words = useConditionWords(type);
  return <span className="qm-diff__sentence">{words.rule(rule)}</span>;
}
