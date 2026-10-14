import type { ContrastContext } from "@querymodule/core/config";
import { contrastFailures, contrastRatio } from "./contrast";
import { TOKEN_NAMES, type TokenName, tokenValue } from "./tokens";

/**
 * The token lookups behind the contrast checks (spec 4.1, UX-011), as validateSiteConfig takes
 * them. One copy for the web builder and, in a follow-up, the API loader. An override that is not
 * #rrggbb is skipped (the contrast maths throws on one); the theme section's own check flags it.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

const hexOnly = (overrides: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(overrides).filter(([, v]) => HEX.test(v)));

export const tokensContrast: ContrastContext = {
  value: (token, mode, overrides) => {
    const v = Object.hasOwn(overrides, token)
      ? overrides[token]
      : (TOKEN_NAMES as readonly string[]).includes(token)
        ? tokenValue(token as TokenName, mode)
        : undefined;
    // Non-colour values (scale tokens, bad overrides) are skipped, never thrown on.
    return typeof v === "string" && HEX.test(v) ? v : undefined;
  },
  ratio: contrastRatio,
  failures: (mode, overrides) =>
    contrastFailures(mode, hexOnly(overrides)).map((f) => ({
      fg: f.pair.fg,
      bg: f.pair.bg,
      min: f.pair.min,
      ratio: f.ratio,
    })),
};
