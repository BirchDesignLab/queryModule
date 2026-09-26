import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCss } from "../src/css";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "generated", "tokens.css");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buildCss());
console.log("wrote packages/tokens/generated/tokens.css");
