// Retakes the README and reader-doc screenshots (docs/assets/shots/) on a local production build
// with the mock sources and the seeded demo users, then turns the terminal recording into a GIF.
// Mock data only: the spec types synthetic values (ZZ-0001, WANTED) and publishes nothing.
//   E2E_PORT=<free port> node scripts/docs/shots.mjs
// Needs ffmpeg on PATH for the GIF; without it the PNGs are still taken and the .webm is kept.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, "docs/assets/shots");
const shell = process.platform === "win32";

const run = spawnSync("pnpm", ["e2e", "docs-shots.spec.ts", "--project=chromium"], {
  cwd: root,
  stdio: "inherit",
  shell,
  env: { ...process.env, DOCS_SHOTS_DIR: out },
});
if (run.status !== 0) process.exit(run.status ?? 1);
rmSync(resolve(out, ".video"), { recursive: true, force: true });

const webm = resolve(out, "query-flow.webm");
const gif = resolve(out, "query-flow.gif");
if (!existsSync(webm)) {
  console.error("shots: no recording was saved");
  process.exit(1);
}
// Two passes through one filter graph: a palette built from the clip, then the clip mapped onto it.
// 12 fps and 960 px wide keep the GIF small enough for a README while the text still reads.
const filter =
  "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", filter, gif], {
  stdio: "inherit",
});
if (ff.error !== undefined || ff.status !== 0) {
  console.error("shots: ffmpeg failed or is not on PATH; the recording stays as query-flow.webm");
  process.exit(1);
}
rmSync(webm);
console.log(`shots: wrote ${out}`);
