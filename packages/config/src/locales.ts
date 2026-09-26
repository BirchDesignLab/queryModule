import en from "../locales/en.json" with { type: "json" };

/** Locale bundles shipped in the image; volumes may add more (spec 5.8). */
export const BUNDLED_LOCALES: { en: Record<string, string> } = { en };
