import type { CDPSession, Page } from "@playwright/test";
import { test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Keystroke cost of the query panel (opt-in measurement, not a gate): node scripts/perf/e2e-perf.ts
//
// For each input, click or change event the page records the time from the event's capture phase to
// the first macrotask after it, with a forced style and layout pass: React's render, commit and
// effects, plus style and layout, without the wait for the next frame. That is "the cost of one
// commit". It runs at 1x and at 4x CPU throttling (CDP Emulation.setCPUThrottlingRate). A frame is
// about 16 ms, so a commit above that at 4x drops frames on a slow vehicle laptop.
//
// The runner builds the app with React's profiling renderer, so a fake DevTools hook can read the
// render time (fiber actualDuration) and count of every commit; a CPU profile of the 4x run lists the
// functions with the most self time. Results print as `PERF {json}` and `PROFILE {json}` lines, and go
// to E2E_PERF_OUT (a file) when that is set.

test.skip(process.env.QM_PERF === undefined, "opt-in: set QM_PERF=1 (the runner does)");

interface Row {
  persona: string;
  rate: number;
  action: string;
  events: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  commitsPerEvent: number;
  renderMsPerEvent: number;
}

const rows: Row[] = [];
const profiles: Array<{ persona: string; action: string; top: Array<[string, number]> }> = [];

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __perf?: { samples: number[]; t0: number; commits: number[] };
      __commits?: number[];
    };
    if (w.__perf !== undefined) return;
    const perf = { samples: [] as number[], t0: 0, commits: w.__commits ?? [] };
    w.__perf = perf;
    for (const type of ["input", "click", "change"]) {
      window.addEventListener(type, () => (perf.t0 = performance.now()), true);
      window.addEventListener(type, () => {
        const started = perf.t0;
        setTimeout(() => {
          void document.body.offsetHeight;
          perf.samples.push(performance.now() - started);
        }, 0);
      });
    }
  });
}

/** Takes what the probe has recorded since the last drain. */
async function drain(page: Page): Promise<{ samples: number[]; commits: number[] }> {
  await page.waitForTimeout(100);
  return page.evaluate(() => {
    const p = (window as unknown as { __perf: { samples: number[]; commits: number[] } }).__perf;
    const out = { samples: p.samples.slice(), commits: p.commits.slice() };
    p.samples.length = 0;
    p.commits.length = 0;
    return out;
  });
}

function record(
  persona: string,
  rate: number,
  action: string,
  all: { samples: number[]; commits: number[] },
): void {
  const sorted = [...all.samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const round = (n: number) => Math.round(n * 10) / 10;
  const events = Math.max(1, sorted.length);
  const row: Row = {
    persona,
    rate,
    action,
    events: sorted.length,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
    commitsPerEvent: round(all.commits.length / events),
    renderMsPerEvent: round(all.commits.reduce((a, b) => a + Math.max(0, b), 0) / events),
  };
  rows.push(row);
  console.log(`PERF ${JSON.stringify(row)}`);
}

async function cpuTop(cdp: CDPSession, run: () => Promise<void>): Promise<Array<[string, number]>> {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await run();
  const { profile } = (await cdp.send("Profiler.stop")) as {
    profile: {
      nodes: Array<{
        id: number;
        callFrame: { functionName: string; url: string; lineNumber: number };
      }>;
      samples: number[];
      timeDeltas: number[];
    };
  };
  const byId = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
  const self = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const frame = byId.get(id);
    if (frame === undefined) return;
    const file = frame.url.split("/").pop() ?? "";
    const key = `${frame.functionName || "(anonymous)"} ${file}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  return [...self.entries()]
    .filter(([key]) => !key.startsWith("(idle)") && !key.startsWith("(program)"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([key, ms]) => [key, Math.round(ms * 10) / 10]);
}

const PERSONAS = [
  { name: "dispatcher", email: "dispatcher@example.test", viewport: { width: 1366, height: 768 } },
  { name: "officer", email: "officer@example.test", viewport: { width: 1024, height: 768 } },
] as const;

for (const persona of PERSONAS) {
  for (const rate of [1, 4] as const) {
    test.describe(`${persona.name} at ${rate}x CPU`, () => {
      test.use({ viewport: persona.viewport });

      test("typing, quick access, subtype, typing beside 20 request rows", async ({ page }) => {
        // A minimal DevTools hook: React calls it after each commit; the profiling renderer fills
        // in the root fiber's actualDuration (the render phase's time).
        await page.addInitScript(() => {
          const commits: number[] = [];
          (window as unknown as { __commits: number[] }).__commits = commits;
          (
            window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }
          ).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
            supportsFiber: true,
            isDisabled: false,
            renderers: new Map(),
            inject() {
              return 1;
            },
            onCommitFiberRoot(_id: number, root: { current: { actualDuration?: number } }) {
              commits.push(root.current.actualDuration ?? -1);
            },
            onPostCommitFiberRoot() {},
            onCommitFiberUnmount() {},
            onScheduleFiberRoot() {},
            checkDCE() {},
          };
        });
        await signIn(page, seededUser(persona.email));
        const nav = page.getByRole("group", { name: "Quick access" });
        await nav.waitFor();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        await installProbe(page);
        const plate = page.getByLabel("Plate", { exact: true });
        await drain(page);

        const typing = async (label: string) => {
          const all = { samples: [] as number[], commits: [] as number[] };
          const pass = async () => {
            await plate.fill("");
            await drain(page);
            await plate.pressSequentially("ZZ-0001", { delay: 30 });
            const d = await drain(page);
            all.samples.push(...d.samples);
            all.commits.push(...d.commits);
          };
          const run = async () => {
            for (let i = 0; i < 4; i++) await pass();
          };
          if (rate === 4)
            profiles.push({ persona: persona.name, action: label, top: await cpuTop(cdp, run) });
          else await run();
          record(persona.name, rate, label, all);
        };

        // 1. Typing into a field, four passes of seven characters.
        await typing("type a plate character");

        // 2. Switching quick access (four types, three cycles).
        const switching = async () => {
          for (let cycle = 0; cycle < 3; cycle++)
            for (const name of ["Person", "Property", "Wanted check", "Vehicle"]) {
              await nav.getByRole("button", { name, exact: true }).click();
              await page.waitForTimeout(80);
            }
        };
        await drain(page);
        if (rate === 4)
          profiles.push({
            persona: persona.name,
            action: "switch quick access",
            top: await cpuTop(cdp, switching),
          });
        else await switching();
        record(persona.name, rate, "switch quick access", await drain(page));

        // 3. Switching the subtype on Property (every option of the type field's segmented control).
        await nav.getByRole("button", { name: "Property", exact: true }).click();
        await page.waitForTimeout(150);
        const options = page.locator(".qm-type-fields .qm-seg__option");
        const count = await options.count();
        await drain(page);
        const subtypes = async () => {
          for (let cycle = 0; cycle < 3; cycle++)
            for (let i = 0; i < count; i++) {
              await options.nth(i).click();
              await page.waitForTimeout(80);
            }
        };
        if (rate === 4)
          profiles.push({
            persona: persona.name,
            action: "switch subtype",
            top: await cpuTop(cdp, subtypes),
          });
        else await subtypes();
        record(persona.name, rate, `switch subtype (${count} options)`, await drain(page));

        // 4. Typing again with 20 rows in the requests list.
        await nav.getByRole("button", { name: "Vehicle", exact: true }).click();
        for (let i = 0; i < 20; i++) {
          await plate.fill(`ZZ-${String(i).padStart(4, "0")}`);
          const sent = page.waitForResponse(
            (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
          );
          await plate.press("Enter");
          await sent;
        }
        await drain(page);
        await typing("type a plate character, 20 rows listed");
      });
    });
  }
}

test.afterAll(async () => {
  for (const p of profiles) console.log(`PROFILE ${JSON.stringify(p)}`);
  const out = process.env.E2E_PERF_OUT;
  if (out === undefined || out === "" || rows.length === 0) return;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, JSON.stringify({ rows, profiles }, null, 2));
});
