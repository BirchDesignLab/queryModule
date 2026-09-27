import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("./", import.meta.url);
const FORBIDDEN = [
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /persistQueryClient/,
  /StoragePersister/,
  /AsyncStorage/,
  /zustand\/middleware/,
  /\bdocument\./,
  /\bwindow\./,
  /from "react-native"/,
];

describe("SEC-006 no persistent query data and no DOM in packages/client (spec 3, 6.7)", () => {
  it("no source file uses browser storage, persisters, the DOM or React Native", () => {
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    const offenders = files.flatMap((file) => {
      const text = readFileSync(new URL(file.replaceAll("\\", "/"), SRC), "utf8");
      return FORBIDDEN.filter((re) => re.test(text)).map((re) => `${file}: ${re.source}`);
    });
    expect(offenders).toEqual([]);
  });
});
