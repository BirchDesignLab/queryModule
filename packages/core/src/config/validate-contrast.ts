import { type DiagnosticSink, pointer } from "./diagnostic";
import { SEVERITIES, type SiteConfig, THEME_MODES } from "./schema";

type Mode = (typeof THEME_MODES)[number];
type Overrides = Readonly<Record<string, string>>;

/** Supplied by the API and CLI from the tokens package; core has no tokens dependency (spec 5.8). */
export interface ContrastContext {
  /** Token value for a theme mode after SiteConfig.theme.tokens overrides; undefined if unknown. */
  value(token: string, mode: Mode, overrides: Overrides): string | undefined;
  ratio(fgHex: string, bgHex: string): number;
  /** The tokens package's declared pairs that fail under the overrides for one mode. */
  failures(
    mode: Mode,
    overrides: Overrides,
  ): { fg: string; bg: string; min: number; ratio: number }[];
}

/** UX-011: severity text must reach 4.5:1 against its background. */
export const SEVERITY_MIN_RATIO = 4.5;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function checkContrast(config: SiteConfig, c: ContrastContext, out: DiagnosticSink): void {
  const tokens = config.theme?.tokens;
  for (const mode of THEME_MODES) {
    const overrides: Overrides = { ...tokens?.all, ...tokens?.[mode] };
    for (const severity of SEVERITIES) {
      const style = config.keywordSeverityStyles[severity];
      const fg = c.value(style.color, mode, overrides);
      const bg = c.value(style.background, mode, overrides);
      if (fg === undefined || bg === undefined) continue;
      const ratio = c.ratio(fg, bg);
      if (ratio < SEVERITY_MIN_RATIO) {
        out.error(pointer("keywordSeverityStyles", severity), "config.severityContrast", {
          severity,
          mode,
          ratio: round2(ratio),
        });
      }
    }
    for (const f of c.failures(mode, overrides)) {
      out.error("/theme/tokens", "config.themeContrast", {
        fg: f.fg,
        bg: f.bg,
        mode,
        min: f.min,
        ratio: round2(f.ratio),
      });
    }
  }
}
