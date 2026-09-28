import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isLocaleBundle, type LocaleBundle } from "@querymodule/client";

// jsdom's global URL breaks `new URL(relative, import.meta.url)` passed straight to readFileSync
// under the "web" jsdom test environment (T20/IC1 precedent); resolve via node:path instead.
const enJsonPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/config/locales/en.json",
);
const parsed: unknown = JSON.parse(readFileSync(enJsonPath, "utf8"));
if (!isLocaleBundle(parsed)) throw new Error("en.json is not a locale bundle");

/** The shipped English bundle, so tests exercise real keys (Task 10). */
export const EN_BUNDLE: LocaleBundle = parsed;
