import type { ClientSiteConfig } from "@querymodule/core/config";
import { TerminalInput } from "@querymodule/web-ui";
import { useT } from "../app/i18n-context.js";
import { terminalExample } from "./terminal-example.js";
import type { TerminalModel } from "./use-terminal.js";

/** The id of the pane's heading; the aside that holds the pane is named by it. */
export function terminalPaneTitleId(idPrefix: string): string {
  return `${idPrefix}-terminal-pane-title`;
}

interface ReferenceRow {
  code: string;
  /** The command as typed, from its code and the labels of its positions, joined by the site's delimiter. */
  syntax: string;
  typeLabel: string;
}

/**
 * One row per command the site defines (BR-001, FR-051): its code, the labels of its positions in
 * order, and the query type it runs. From the config alone, never from typed values.
 */
function referenceRows(
  config: ClientSiteConfig,
  t: (key: string) => string,
): readonly ReferenceRow[] {
  return config.commands.map((command) => {
    const type = config.queryTypes.find((q) => q.code === command.queryType);
    const names = command.positions.map((position) => {
      const key = typeof position === "string" ? position : position.field;
      const labelKey = type?.fields.find((f) => f.key === key)?.labelKey;
      return labelKey === undefined ? key : t(labelKey);
    });
    return {
      code: command.code,
      syntax: [command.code, ...names].join(config.terminal.delimiter),
      typeLabel: type === undefined ? command.queryType : t(type.labelKey),
    };
  });
}

/**
 * The terminal beside the results (FR-050, UX-014, spec 6.2): a Command input over the same draft
 * as the form, its problems, and a reference of the site's commands. Enter in the input runs the
 * command; the form keeps the Run button and the sources.
 */
export function TerminalPane({
  idPrefix,
  config,
  terminal,
}: {
  idPrefix: string;
  config: ClientSiteConfig;
  terminal: TerminalModel;
}) {
  const t = useT();
  const example = terminalExample(config, t);
  const rows = referenceRows(config, t);
  const referenceId = `${idPrefix}-terminal-reference`;
  // A site lists every command: the list scrolls inside the pane, so it is a named region a
  // keyboard user can focus (spec 6.4), as the result table is. The heading stays outside it.
  const list = (
    // biome-ignore lint/a11y/useSemanticElements: the heading stays outside the scroll, so the region wraps only the list
    <div
      className="qm-terminal-pane__scroll"
      role="region"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable
      tabIndex={0}
      aria-label={t("terminalPane.referenceRegion")}
    >
      <ul aria-labelledby={referenceId} className="qm-terminal-pane__list">
        {rows.map((row) => (
          <li key={row.code} className="qm-terminal-pane__row">
            <code className="qm-terminal-pane__syntax">{row.syntax}</code>
            <span className="qm-terminal-pane__type">{row.typeLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <>
      <h2 id={terminalPaneTitleId(idPrefix)}>{t("terminalPane.title")}</h2>
      <p className="qm-terminal-pane__note">{t("terminalPane.hint")}</p>
      <TerminalInput
        id={`${idPrefix}-terminal`}
        label={t("terminal.label")}
        description={
          example === null
            ? t("terminal.descriptionPlain")
            : t("terminal.descriptionExample", { example })
        }
        value={terminal.text}
        onChange={terminal.setText}
        onSubmit={terminal.submitTerminal}
        errors={terminal.errors}
        unshown={terminal.unshown}
        errorsLabel={t("terminal.errorsLabel")}
        inputRef={terminal.inputRef}
      />
      {terminal.errors.length === 0 ? (
        <p className="qm-terminal-pane__note">{t("terminalPane.noProblems")}</p>
      ) : null}
      {rows.length === 0 ? null : (
        <section className="qm-terminal-pane__reference">
          <h3 id={referenceId} className="qm-terminal-pane__subheading">
            {t("terminalPane.referenceTitle")}
          </h3>
          {list}
        </section>
      )}
    </>
  );
}
