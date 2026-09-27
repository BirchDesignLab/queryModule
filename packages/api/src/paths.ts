import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface BundledPaths {
  configDir: string;
  migrationsDir: string;
  webDist: string | null;
}

const first = (c: string[]): string | null => c.find((p) => existsSync(p)) ?? null;

// fromDir is /app/dist (server) or /app/scripts/ops (ops scripts) in the image, packages/api/src in the repo
export function bundledPaths(fromDir: string = import.meta.dirname): BundledPaths {
  const configDir = first([resolve(fromDir, "../config"), resolve(fromDir, "../../config")]);
  const migrationsDir = first([resolve(fromDir, "../drizzle"), resolve(fromDir, "../../drizzle")]);
  if (!configDir || !migrationsDir) {
    throw new Error("bundled config or migrations directory not found");
  }
  const webDist = first([
    resolve(fromDir, "../web"),
    resolve(fromDir, "../../web"),
    resolve(fromDir, "../../../apps/web/dist"),
  ]);
  return { configDir, migrationsDir, webDist };
}
