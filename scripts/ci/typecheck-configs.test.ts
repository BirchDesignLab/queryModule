import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #85 item 2: vite and vitest config files sat outside tsc -b (each package's
// tsconfig includes only src). typecheck-configs/tsconfig.json covers them, and
// the root tsconfig references it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

function configFiles(): string[] {
  const out = ["vitest.config.ts"];
  for (const dir of ["packages", "apps"])
    for (const pkg of readdirSync(resolve(root, dir)))
      for (const f of ["vite.config.ts", "vitest.config.ts"])
        try {
          readFileSync(resolve(root, dir, pkg, f));
          out.push(`${dir}/${pkg}/${f}`);
        } catch {}
  return out.sort();
}

describe("typecheck-configs (#85)", () => {
  it("the root tsconfig references typecheck-configs", () => {
    const refs = (json("tsconfig.json").references as Array<{ path: string }>).map((r) => r.path);
    expect(refs).toContain("typecheck-configs");
  });

  it("includes every vite and vitest config file in the workspace", () => {
    const include = (json("typecheck-configs/tsconfig.json").include as string[]).map((p) =>
      p.replace(/^\.\.\//, ""),
    );
    expect(configFiles().length).toBeGreaterThan(5);
    for (const f of configFiles()) expect(include, f).toContain(f);
  });
});
