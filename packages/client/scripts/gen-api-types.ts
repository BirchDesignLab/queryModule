import { mkdirSync, writeFileSync } from "node:fs";
import { renderApiTypes } from "../src/api/render-api-types.js";

const dir = new URL("../src/api/generated/", import.meta.url);
mkdirSync(dir, { recursive: true });
// Raw openapi-typescript output: biome.json excludes src/api/generated (#190).
writeFileSync(new URL("openapi-types.ts", dir), await renderApiTypes());
console.log("wrote src/api/generated/openapi-types.ts");
