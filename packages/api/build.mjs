import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "../..");
const ops = readdirSync(resolve(root, "scripts/ops"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => resolve(root, "scripts/ops", f));
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: ["@libsql/*", "libsql"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};
await build({
  ...common,
  entryPoints: [resolve(import.meta.dirname, "src/main.ts")],
  outfile: resolve(import.meta.dirname, "dist/main.js"),
});
if (ops.length > 0)
  await build({ ...common, entryPoints: ops, outdir: resolve(import.meta.dirname, "dist/ops") });
