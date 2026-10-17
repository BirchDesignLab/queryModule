import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shortReference } from "@querymodule/web-ui";
import { describe, expect, it } from "vitest";

// BW3 polish leftover (#642): the e2e helper mirrors web-ui's `shortReference` because the e2e project
// cannot import that package (its barrel holds .tsx files and the project sets no `jsx`). This pins the
// mirror to the production rule: the same body, and the same answer for a UUIDv7 and for a short ID.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** `function shortReference(<param>: string): string { return <expr>; }` with the parameter named `id`. */
function bodyOf(source: string): string {
  const m =
    /export function shortReference\((\w+): string\): string \{\s*return ([^;]+);\s*\}/.exec(
      source,
    );
  if (m === null) throw new Error("shortReference not found in the source");
  return (m[2] as string).replaceAll(m[1] as string, "id").replace(/\s+/g, " ");
}

describe("the e2e shortReference mirror", () => {
  const web = bodyOf(read("../../../../packages/web-ui/src/panel/RequestList.tsx"));
  const e2e = bodyOf(read("../../e2e/helpers.ts"));

  it("has the same body as the production rule", () => {
    expect(e2e).toBe(web);
  });

  it("the production rule is the last eight characters", () => {
    expect(shortReference("0198a1b2-3c4d-7e5f-8a9b-0c1d2e3f4a5b")).toBe("2e3f4a5b");
    expect(shortReference("ZZ-0001")).toBe("ZZ-0001");
  });
});
