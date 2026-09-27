import { execSync } from "node:child_process";

/**
 * Formats generated OpenAPI type source through biome so the generator script and the
 * drift test produce (and compare) identically formatted output, without either one
 * importing `node:child_process` from `packages/client/src` (S1, B1 carry-forward #178:
 * no Node globals/`node:` imports in shipped `src`). Lives in `scripts/`, which is already
 * exempt from that constraint.
 */
export function formatApiTypes(source: string): string {
  return execSync("pnpm exec biome format --stdin-file-path=openapi-types.ts -", {
    input: source,
    encoding: "utf8",
  });
}
