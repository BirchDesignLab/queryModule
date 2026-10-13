import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const en: Record<string, string> = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../config/locales/en.json"),
    "utf8",
  ),
);

describe("NFR-001 result card strings (spec 6.2)", () => {
  it("every key the primitives read exists", () => {
    const single = [
      ...["critical", "warning", "info"].flatMap((s) => [`severity.${s}`, `severity.word.${s}`]),
      "result.showDetail",
      "result.hideDetail",
      "result.keywordSeverity",
      "result.noMapping",
      "result.diagnostics",
    ];
    const plural = ["result.moreItems", "result.rowCount"].flatMap((k) => [
      `${k}.one`,
      `${k}.other`,
    ]);
    expect([...single, ...plural].filter((k) => !(k in en))).toEqual([]);
  });
  it("the no-card note matches the approved design wording", () => {
    expect(en["result.noMapping"]).toBe(
      "No card is set up for this result, so every field shows under its path.",
    );
  });
});
