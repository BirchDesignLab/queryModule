import { BUNDLED_LOCALES } from "@querymodule/config";

const t = (key: string): string => BUNDLED_LOCALES.en[key] ?? key;

export function Shell() {
  return (
    <div className="qm-shell">
      <header className="qm-shell__header">
        <h1>{t("app.title")}</h1>
      </header>
      <main id="main" className="qm-shell__main" />
    </div>
  );
}
