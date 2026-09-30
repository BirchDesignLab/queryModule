import { VisuallyHidden } from "@querymodule/web-ui";
import { useId, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import { controlId, Sect } from "./controls.js";

/** The locale whose text sits beside every other locale's row for reference. */
const REFERENCE_LOCALE = "en";

/**
 * Labels and translations (A-D2 item 2): one ruled section per draft locale. Each row is titled by
 * its label key in mono, the one place in the builder where keys are the title (developer ruling),
 * with the English text beside it; the input holds this locale's text. Everything else is plain.
 */
export function LabelOverlayEditor({
  locales,
  idPrefix,
}: {
  locales: readonly string[];
  idPrefix: string;
}) {
  const services = useServices();
  const { labels } = useDraft();
  const store = configDraftStore(services);
  const translator = useTranslator();
  // The English text a reader sees for a key: the draft's overlay, else the shipped text. Null when
  // it cannot be known here (the shipped English is not the loaded bundle).
  const englishText = (key: string): string | null => {
    const overlay = labels[REFERENCE_LOCALE]?.[key];
    if (overlay !== undefined) return overlay;
    if (translator.locale !== REFERENCE_LOCALE) return null;
    return translator.has(key) ? translator.t(key) : "";
  };
  return (
    <>
      {locales.map((locale) => (
        <LocaleLabels
          key={locale}
          locale={locale}
          idPrefix={idPrefix}
          entries={labels[locale] ?? {}}
          englishText={locale === REFERENCE_LOCALE ? undefined : englishText}
          onSet={(key, text) => store.getState().setLabel(locale, key, text)}
        />
      ))}
    </>
  );
}

function LocaleLabels({
  locale,
  idPrefix,
  entries,
  englishText,
  onSet,
}: {
  locale: string;
  idPrefix: string;
  entries: Readonly<Record<string, string>>;
  /** Absent in the reference locale itself, whose input is the English text. */
  englishText: ((key: string) => string | null) | undefined;
  onSet(key: string, text: string): void;
}) {
  const t = useT();
  const reasonId = useId();
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const keyId = controlId(idPrefix, ["labelKey", locale]);
  const textId = controlId(idPrefix, ["labelNew", locale]);
  const rows = Object.entries(entries);
  // A key that already has a row is edited there: adding it again would silently overwrite it.
  const exists = Object.hasOwn(entries, key.trim());
  const blocked = key.trim() === "" || exists;
  const add = () => {
    if (blocked) return;
    onSet(key.trim(), text);
    setKey("");
    setText("");
  };
  return (
    <Sect title={t("admin.labels.section", { locale })} hint={t("admin.labels.hint")}>
      {rows.length === 0 ? (
        <p className="qm-labels__empty">{t("admin.labels.empty")}</p>
      ) : (
        <ul className="qm-labels">
          {rows.map(([k, v]) => {
            const id = controlId(idPrefix, ["label", locale, k]);
            const english = englishText?.(k);
            const enId = `${id}-en`;
            return (
              <li key={k} className="qm-label-row">
                <label htmlFor={id} className="qm-label-row__key">
                  <code>{k}</code>
                </label>
                {english !== undefined && (
                  <p id={enId} className="qm-label-row__en">
                    <VisuallyHidden>{t("admin.labels.englishText")}</VisuallyHidden>{" "}
                    {english === null
                      ? t("admin.labels.englishUnknown")
                      : english === ""
                        ? t("admin.labels.englishNone")
                        : english}
                  </p>
                )}
                <input
                  id={id}
                  type="text"
                  className="qm-field__input qm-label-row__input"
                  value={v}
                  aria-describedby={english === undefined ? undefined : enId}
                  onChange={(e) => onSet(k, e.target.value)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="qm-labels__add">
        <div className="qm-labels__field">
          <label htmlFor={keyId}>{t("admin.labels.newKey")}</label>
          <input
            id={keyId}
            type="text"
            className="qm-field__input"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="qm-labels__field">
          <label htmlFor={textId}>{t("admin.labels.newText")}</label>
          <input
            id={textId}
            type="text"
            className="qm-field__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {/* aria-disabled keeps it focusable, and the reason is visible (spec 6.2). */}
        <button
          type="button"
          className="qm-button"
          aria-disabled={blocked ? "true" : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={add}
        >
          {t("admin.labels.add")}
        </button>
        {blocked && (
          <p className="qm-labels__reason" id={reasonId}>
            {t(exists ? "admin.labels.keyExists" : "admin.labels.needKey")}
          </p>
        )}
      </div>
    </Sect>
  );
}
