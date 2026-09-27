import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderApiTypes } from "../src/api/render-api-types.js";

const dir = new URL("../src/api/generated/", import.meta.url);
mkdirSync(dir, { recursive: true });
const outFile = new URL("openapi-types.ts", dir);
writeFileSync(outFile, await renderApiTypes());
// openapi-typescript's own output style does not match the repo's biome config (2-space
// indent, one-per-line unions); format in place so the committed file passes `pnpm lint`
// without a biome.json exclusion (out of this task's file list; W6 #85, ADR-0007).
execSync(`pnpm exec biome format --write ${JSON.stringify(fileURLToPath(outFile))}`, {
  stdio: "inherit",
});
console.log("wrote src/api/generated/openapi-types.ts");
