import { useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import { Section } from "./GenericForm.js";

export function LabelOverlayEditor({
  locales,
  idPrefix,
}: {
  locales: readonly string[];
  idPrefix: string;
}) {
  const t = useT();
  const services = useServices();
  const { labels } = useDraft();
  const store = configDraftStore(services);
  return (
    <Section name={t("admin.config.labels.title")}>
      {() =>
        locales.map((locale) => (
          <LocaleLabels
            key={locale}
            locale={locale}
            idPrefix={idPrefix}
            entries={labels[locale] ?? {}}
            onSet={(key, text) => store.getState().setLabel(locale, key, text)}
          />
        ))
      }
    </Section>
  );
}

function LocaleLabels({
  locale,
  idPrefix,
  entries,
  onSet,
}: {
  locale: string;
  idPrefix: string;
  entries: Readonly<Record<string, string>>;
  onSet(key: string, text: string): void;
}) {
  const t = useT();
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const keyId = `${idPrefix}-label-key-${locale}`;
  const textId = `${idPrefix}-label-text-${locale}`;
  return (
    <fieldset>
      <legend>{locale}</legend>
      {Object.entries(entries).map(([k, v]) => {
        const id = `${idPrefix}-label-${locale}-${k}`;
        return (
          <div key={k}>
            <label htmlFor={id}>{k}</label>{" "}
            <input id={id} type="text" value={v} onChange={(e) => onSet(k, e.target.value)} />
          </div>
        );
      })}
      <div>
        <label htmlFor={keyId}>{t("admin.config.labels.key", { locale })}</label>{" "}
        <input id={keyId} type="text" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <div>
        <label htmlFor={textId}>{t("admin.config.labels.text", { locale })}</label>{" "}
        <input id={textId} type="text" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <button
        type="button"
        className="qm-button"
        disabled={key.trim() === ""}
        onClick={() => {
          onSet(key.trim(), text);
          setKey("");
          setText("");
        }}
      >
        {t("admin.config.labels.add", { locale })}
      </button>
    </fieldset>
  );
}
