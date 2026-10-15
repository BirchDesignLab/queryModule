// Demo dry run: walks the demo runbook (docs/demo.md and docs/demo/m1-v1.md) against the production
// build, as the dispatcher, the officer, the admin and the implementer, BY KEYBOARD only (Tab,
// Shift+Tab, Enter, Space, arrows and the app's own shortcuts; never focus() or fill()). It takes
// screenshots, times the waits, and records every step that cannot be done by keyboard, every wait
// over 2 s, every console error and every failed request. It never fixes anything: the report is
// the input to a review of gaps.
//
//   E2E_PORT=3200 node scripts/demo/dry-run.ts
//
// Env: DRY_RUN_OUT (default .superpowers/sdd/2026-10-14-demo-dry-run), DRY_RUN_SKIP_BUILD=1 reuses
// the last build, DRY_RUN_ONLY=dispatcher-1366,officer-1024 limits the walks, DRY_RUN_STEPS=<regex>
// limits the steps (sign in always runs). Output: shots/*.png,
// report.json and report.md under DRY_RUN_OUT. Mock data only (ZZ- plates, TESTERSON).
/// <reference lib="dom" />
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { e2eTarget, probeHealth, runSeed, waitForReady } from "../dev/e2e-lib.ts";
import { ensureDevSecrets } from "../dev/secrets.ts";

// Playwright is a dependency of apps/web only, so it is loaded from there (as
// scripts/briefs/render-pdf.mjs does) and its types are not visible here. These are the parts of
// its API this script uses.
interface RoleOpts {
  name?: string | RegExp;
  exact?: boolean;
  level?: number;
  checked?: boolean;
  selected?: boolean;
}
interface Locator {
  count(): Promise<number>;
  first(): Locator;
  last(): Locator;
  isVisible(): Promise<boolean>;
  evaluate<R>(fn: (el: Element) => R): Promise<R>;
  getByRole(role: string, opts?: RoleOpts): Locator;
  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): Locator;
  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator;
  getByTestId(id: string): Locator;
  locator(selector: string): Locator;
  innerText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  waitFor(opts?: { state?: "visible" | "hidden"; timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
  ariaSnapshot(opts?: { timeout?: number }): Promise<string>;
}
interface PwRequest {
  method(): string;
  url(): string;
  failure(): { errorText: string } | null;
}
interface PwResponse {
  status(): number;
  url(): string;
  request(): PwRequest;
}
interface Page {
  goto(url: string): Promise<unknown>;
  reload(): Promise<unknown>;
  getByRole(role: string, opts?: RoleOpts): Locator;
  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): Locator;
  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator;
  getByTestId(id: string): Locator;
  locator(selector: string): Locator;
  evaluate<R>(fn: () => R): Promise<R>;
  screenshot(opts: { path: string }): Promise<unknown>;
  keyboard: {
    press(key: string): Promise<void>;
    type(text: string, opts?: { delay: number }): Promise<void>;
  };
  on(event: "console", cb: (m: { type(): string; text(): string }) => void): void;
  on(event: "crash", cb: () => void): void;
  on(event: "pageerror", cb: (e: Error) => void): void;
  on(event: "requestfailed", cb: (r: PwRequest) => void): void;
  on(event: "response", cb: (r: PwResponse) => void): void;
  route(
    url: string,
    handler: (route: {
      abort(): Promise<void>;
      continue(): Promise<void>;
      request(): { method(): string };
    }) => Promise<void>,
  ): Promise<void>;
  unroute(url: string): Promise<void>;
}
interface BrowserContext {
  newPage(): Promise<Page>;
  setOffline(offline: boolean): Promise<void>;
  close(): Promise<void>;
}
interface Browser {
  newContext(opts: {
    viewport: { width: number; height: number };
    baseURL: string;
  }): Promise<BrowserContext>;
  close(): Promise<void>;
}

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test") as {
  chromium: { launch: (opts?: { args: string[] }) => Promise<Browser> };
};

const outDir = resolve(root, process.env.DRY_RUN_OUT ?? ".superpowers/sdd/2026-10-14-demo-dry-run");
const shotsDir = resolve(outDir, "shots");
mkdirSync(shotsDir, { recursive: true });
const secrets = resolve(root, ".dev/secrets");
ensureDevSecrets(secrets);
const target = e2eTarget(process.env);
const SLOW_MS = 2000;
const stepFilter = process.env.DRY_RUN_STEPS
  ? new RegExp(process.env.DRY_RUN_STEPS, "i")
  : undefined;

type Kind = "keyboard" | "slow" | "console" | "network" | "failed" | "note";
interface Finding {
  walk: string;
  step: string;
  kind: Kind;
  detail: string;
}
interface Timing {
  walk: string;
  what: string;
  ms: number;
}
const findings: Finding[] = [];
const timings: Timing[] = [];

function seedPassword(email: string): string {
  const secret = readFileSync(resolve(secrets, "SEED_PASSWORD_SECRET"), "utf8").trim();
  return createHmac("sha256", secret).update(email.toLowerCase()).digest("base64url");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

// Submits stay under 30 a minute per user (the API's limit); 24 leaves room.
const submitTimes: number[] = [];
async function throttle(): Promise<void> {
  const now = Date.now();
  while (submitTimes.length > 0 && now - (submitTimes[0] ?? now) > 60_000) submitTimes.shift();
  if (submitTimes.length >= 24) await sleep(60_000 - (now - (submitTimes[0] ?? now)) + 500);
  submitTimes.push(Date.now());
}

/** One walk: a persona at a viewport, with its own context and its own findings. */
class Walk {
  step = "start";
  shotNo = 0;
  readonly watched = new WeakSet<Page>();
  readonly name: string;
  readonly context: BrowserContext;
  page: Page;
  crashed = false;
  offline = false;
  readonly layout: "dispatch" | "officer";
  constructor(name: string, context: BrowserContext, page: Page, layout: "dispatch" | "officer") {
    this.name = name;
    this.context = context;
    this.page = page;
    this.layout = layout;
    this.watch(page);
  }

  /** A crashed renderer: note it and carry on in a fresh page of the same (signed-in) context. */
  async recover(): Promise<void> {
    this.find("failed", "the page crashed (renderer)");
    this.page = await this.context.newPage();
    this.watch(this.page);
    this.crashed = false;
    await this.page.goto("/");
    await this.page
      .getByRole("heading", { name: "Query Module", exact: true })
      .waitFor({ timeout: 15_000 });
  }

  watch(page: Page): void {
    if (this.watched.has(page)) return;
    this.watched.add(page);
    if (process.env.DRY_RUN_NO_WATCH === "1") return;
    page.on("console", (m) => {
      if (m.type() === "error" && !(this.offline && /ERR_INTERNET_DISCONNECTED/.test(m.text())))
        this.find("console", m.text().slice(0, 300));
    });
    page.on("crash", () => {
      this.crashed = true;
    });
    page.on("pageerror", (e) => this.find("console", `page error: ${e.message.slice(0, 300)}`));
    page.on("requestfailed", (req) => {
      const why = req.failure()?.errorText ?? "failed";
      if (why.includes("ERR_ABORTED") || why.includes("INTERNET_DISCONNECTED")) return;
      this.find("network", `${req.method()} ${new URL(req.url()).pathname}: ${why}`);
    });
    page.on("response", (res) => {
      if (res.status() < 400) return;
      const path = new URL(res.url()).pathname;
      this.find("network", `${res.request().method()} ${path}: HTTP ${res.status()}`);
    });
  }

  find(kind: Kind, detail: string): void {
    findings.push({ walk: this.name, step: this.step, kind, detail });
    console.log(`  [${kind}] ${this.step}: ${detail}`);
  }

  async shot(label: string, page: Page = this.page): Promise<void> {
    if (process.env.DRY_RUN_NO_SHOTS === "1") return;
    this.shotNo += 1;
    const file = `${this.name}-${String(this.shotNo).padStart(2, "0")}-${slug(label)}.png`;
    await page.screenshot({ path: resolve(shotsDir, file) }).catch(() => {});
  }

  /** Runs a step; a thrown error is a finding with a screenshot and a page outline, not a stop. */
  async run(name: string, fn: () => Promise<void>): Promise<void> {
    if (stepFilter !== undefined && name !== "sign in by keyboard" && !stepFilter.test(name))
      return;
    this.step = name;
    console.log(`${this.name}: ${name}`);
    if (this.crashed) await this.recover().catch(() => {});
    const t0 = Date.now();
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.find("failed", msg.split("\n")[0]?.slice(0, 300) ?? "failed");
      await this.shot(`FAILED ${name}`);
      const outline = await this.page
        .locator("body")
        .ariaSnapshot({ timeout: 3000 })
        .catch(() => "");
      writeFileSync(resolve(shotsDir, `${this.name}-FAILED-${slug(name)}.txt`), outline);
    }
    timings.push({ walk: this.name, what: `step: ${name}`, ms: Date.now() - t0 });
  }

  /** A timed wait: logged, and a finding when over 2 s (or over `expected` plus 2 s). */
  async timed(what: string, fn: () => Promise<void>, expected = 0): Promise<number> {
    const t0 = Date.now();
    await fn();
    const ms = Date.now() - t0;
    timings.push({ walk: this.name, what, ms });
    if (ms > SLOW_MS + expected)
      this.find(
        "slow",
        `${what}: ${(ms / 1000).toFixed(1)} s${expected > 0 ? ` (scenario waits ${expected / 1000} s)` : ""}`,
      );
    return ms;
  }

  async poll(test: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await test().catch(() => false)) return;
      await sleep(60);
    }
    throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
  }

  async key(k: string): Promise<void> {
    if (process.env.DRY_RUN_TRACE) console.log(`    key ${k}`);
    await this.page.keyboard.press(k);
  }

  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text, { delay: 15 });
  }

  async focusDescription(): Promise<string> {
    return this.page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return "nothing";
      const name =
        el.getAttribute("aria-label") ||
        (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
      const role = el.getAttribute("role");
      return `${el.tagName.toLowerCase()}${role ? `[${role}]` : ""} ${name}`;
    });
  }

  /**
   * Tab until `target` (or something inside it) has focus. Records a keyboard finding when the
   * element is missing or cannot be reached forward or backward within `max` stops.
   */
  async tabTo(target: Locator, what: string, max = 150): Promise<boolean> {
    // A control that renders after the config loads is given a moment before it counts as missing.
    await this.poll(async () => (await target.count()) > 0, 4000, what).catch(() => {});
    if ((await target.count()) === 0) {
      this.find("keyboard", `${what}: not on the page`);
      return false;
    }
    // The target is marked once and focus is read with plain page code: re-resolving a role
    // locator before every key press can crash the renderer while some elements hold focus.
    await target.first().evaluate((el) => el.setAttribute("data-dry-run-target", "1"));
    const has = async () =>
      this.page
        .evaluate(() => {
          const el = document.querySelector("[data-dry-run-target]");
          return !!el && (el === document.activeElement || el.contains(document.activeElement));
        })
        .catch(() => false);
    // Tab order follows document order, so go the short way first.
    const before = await this.page
      .evaluate(() => {
        const el = document.querySelector("[data-dry-run-target]");
        const active = document.activeElement;
        return !!el && !!active && !!(active.compareDocumentPosition(el) & 2);
      })
      .catch(() => false);
    const dirs = before ? ["Shift+Tab", "Tab"] : ["Tab", "Shift+Tab"];
    try {
      for (const dir of dirs) {
        for (let i = 0; i <= max; i++) {
          if (await has()) {
            if (i > 25) this.find("keyboard", `${what}: ${i} ${dir} stops from the previous focus`);
            return true;
          }
          await this.page.keyboard.press(dir);
        }
      }
    } finally {
      await this.page
        .evaluate(() =>
          document.querySelector("[data-dry-run-target]")?.removeAttribute("data-dry-run-target"),
        )
        .catch(() => {});
    }
    this.find("keyboard", `${what}: not reached by Tab or Shift+Tab within ${max} stops`);
    return false;
  }

  /** Tab into a radio group and arrow to the option whose label matches. */
  async radio(group: Locator, label: RegExp, what: string): Promise<boolean> {
    if (!(await this.tabTo(group, what))) return false;
    for (let i = 0; i < 8; i++) {
      const current = await group.evaluate((el) => {
        const r = el.querySelector<HTMLInputElement>("input[type=radio]:checked");
        return r?.labels?.[0]?.textContent ?? r?.closest("label")?.textContent ?? "";
      });
      if (label.test(current)) return true;
      await this.key("ArrowRight");
    }
    this.find("keyboard", `${what}: could not select ${label} by arrow keys`);
    return false;
  }

  /** Writes an outline of part of the page next to the shots, for working out a control's name. */
  async outline(label: string, loc: Locator): Promise<void> {
    const text = await loc.ariaSnapshot({ timeout: 3000 }).catch(() => "");
    writeFileSync(resolve(shotsDir, `${this.name}-outline-${slug(label)}.txt`), text);
  }

  /** Tab to a control and press Enter on it. */
  async activate(target: Locator, what: string): Promise<boolean> {
    if (!(await this.tabTo(target, what))) return false;
    await this.key("Enter");
    return true;
  }

  /** Tab to a select and choose an option by typing its label (the keyboard way). */
  async choose(select: Locator, label: string, what: string): Promise<boolean> {
    if (!(await this.tabTo(select, what))) return false;
    await this.type(label);
    return true;
  }

  async signIn(email: string): Promise<void> {
    const page = this.page;
    await page.goto("/");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    this.find("note", `focus on the sign-in page: ${await this.focusDescription()}`);
    await this.shot("sign in page");
    if (!(await this.tabTo(page.getByLabel("Email"), "Email field"))) return;
    await this.type(email);
    if (!(await this.tabTo(page.getByLabel("Password"), "Password field"))) return;
    await this.type(seedPassword(email));
    await this.tabTo(page.getByRole("button", { name: "Sign in" }), "Sign in button");
    await this.timed("sign in to the Query Module heading", async () => {
      await this.key("Enter");
      await page
        .getByRole("heading", { name: "Query Module", exact: true })
        .waitFor({ timeout: 15_000 });
    });
    this.find("note", `focus after sign in: ${await this.focusDescription()}`);
  }

  /** The requests list: "Requests this shift" for the dispatcher, "Last request" for the officer. */
  list(page: Page = this.page): Locator {
    return page.getByRole("region", {
      name: this.layout === "officer" ? "Last request" : "Requests this shift",
    });
  }

  firstRow(page: Page = this.page): Locator {
    return this.list(page).getByRole("listitem").first();
  }

  /** After a submit key: wait for the acknowledgment on a new row, then for every source line to settle. */
  /** Call right before the Enter that submits: the newest row's text and the time. */
  async mark(): Promise<{ before: string; t0: number }> {
    const before = await this.firstRow()
      .innerText()
      .catch(() => "");
    return { before, t0: Date.now() };
  }

  /** After the submit key: wait for the acknowledgment on a new row, then for every source line to settle. */
  async watchSubmit(
    label: string,
    mark: { before: string; t0: number },
    opts: { settleMs?: number; expectedSettle?: number; holdPending?: boolean } = {},
  ): Promise<string> {
    const row = this.firstRow();
    await this.poll(
      async () => {
        const t = await row.innerText();
        return t !== mark.before && /acknowledged/i.test(t);
      },
      15_000,
      "the Acknowledged row",
    ).catch(async (e: Error) => {
      const problems = await this.page
        .getByRole("list", { name: "Command problems" })
        .innerText()
        .catch(() => "");
      const alerts = await this.page
        .getByRole("alert")
        .first()
        .innerText()
        .catch(() => "");
      throw new Error(
        `${e.message}. Command problems: "${problems.trim()}". Alert: "${alerts.trim()}"`,
      );
    });
    const ackMs = Date.now() - mark.t0;
    timings.push({ walk: this.name, what: `${label}: Enter to Acknowledged row`, ms: ackMs });
    if (ackMs > SLOW_MS)
      this.find("slow", `${label}: Enter to Acknowledged row ${(ackMs / 1000).toFixed(1)} s`);
    let text = await row.innerText();
    if (/pending/i.test(text)) {
      if (opts.holdPending) await sleep(1500);
      await this.shot(`${label} pending`);
    }
    try {
      await this.poll(
        async () => {
          const t = await row.innerText();
          return (
            !/pending/i.test(t) &&
            /returned|failed|timed out|interrupted|not run|credentials/i.test(t)
          );
        },
        opts.settleMs ?? 20_000,
        "sources to settle",
      );
    } catch (e) {
      this.find("failed", `${label}: ${(e as Error).message}`);
    }
    const settleMs = Date.now() - mark.t0;
    timings.push({
      walk: this.name,
      what: `${label}: Enter to every source settled`,
      ms: settleMs,
    });
    if (settleMs > SLOW_MS + (opts.expectedSettle ?? 0))
      this.find(
        "slow",
        `${label}: Enter to every source settled ${(settleMs / 1000).toFixed(1)} s`,
      );
    // The status line turns "returned" first; the result card is drawn from a second fetch.
    if (/returned/i.test(await row.innerText())) {
      const cards = row.getByRole("region");
      let drawn = false;
      try {
        await this.poll(async () => (await cards.count()) > 0, 6000, "a result card");
        drawn = true;
      } catch {
        this.find("failed", `${label}: a source returned but no result card was drawn within 6 s`);
      }
      const cardMs = Date.now() - mark.t0;
      timings.push({ walk: this.name, what: `${label}: Enter to result card drawn`, ms: cardMs });
      if (drawn && cardMs - settleMs > 300)
        this.find(
          "slow",
          `${label}: the status line said returned ${((cardMs - settleMs) / 1000).toFixed(1)} s before the card appeared`,
        );
    }
    text = await row.innerText();
    return text;
  }

  async terminalMode(on: boolean): Promise<void> {
    const command = this.page.getByRole("textbox", { name: "Command" });
    const visible = await command.isVisible().catch(() => false);
    if (visible === on) return;
    await this.key("Control+Backquote");
    await sleep(250);
    if ((await command.isVisible().catch(() => false)) !== on)
      this.find("keyboard", `Ctrl+\` did not switch to ${on ? "terminal" : "form"} mode`);
  }

  /** Runs one terminal command: focus the command line, replace its text, Enter. */
  /** A terminal command that the form's own rules refuse: the reason shows in "Command problems". */
  async terminalProblem(cmd: string, label: string): Promise<void> {
    await this.terminalMode(true);
    const input = this.page.getByRole("textbox", { name: "Command" });
    const focused = await input.evaluate((el) => el === document.activeElement).catch(() => false);
    if (!focused && !(await this.tabTo(input, "command line"))) return;
    await this.key("Control+A");
    await this.type(cmd);
    await this.key("Enter");
    const problems = this.page.getByRole("list", { name: "Command problems" });
    await sleep(600);
    const text = (await problems.innerText().catch(() => "")).trim();
    this.find(
      "note",
      `${label}: ${text === "" ? "no problem shown, command accepted?" : `refused with "${text}"`}`,
    );
    await this.shot(`${label} refused`);
  }

  async terminal(
    cmd: string,
    label: string,
    opts: {
      settleMs?: number;
      expectedSettle?: number;
      holdPending?: boolean;
      shot?: boolean;
    } = {},
  ): Promise<string> {
    await this.terminalMode(true);
    const input = this.page.getByRole("textbox", { name: "Command" });
    const focused = await input.evaluate((el) => el === document.activeElement).catch(() => false);
    if (!focused && !(await this.tabTo(input, "command line"))) return "";
    await this.key("Control+A");
    await this.type(cmd);
    await throttle();
    const m = await this.mark();
    await this.key("Enter");
    const text = await this.watchSubmit(label, m, opts);
    if (opts.shot !== false) await this.shot(`${label} settled`);
    return text;
  }
}

// ---------------------------------------------------------------------------------------------
// Server

async function startServer(): Promise<{ stop: () => void }> {
  const shell = process.platform === "win32";
  if (process.env.DRY_RUN_SKIP_BUILD !== "1") {
    for (const f of ["@querymodule/web", "@querymodule/api"]) {
      const b = spawnSync("pnpm", ["--filter", f, "build"], { cwd: root, stdio: "inherit", shell });
      if (b.status !== 0) process.exit(b.status ?? 1);
    }
  }
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: target.port,
    PUBLIC_ORIGIN: target.origin,
    DATA_DIR: mkdtempSync(resolve(root, ".dev/e2e-")),
    SECRETS_DIR: secrets,
    ALLOW_MOCK_SOURCES: "true",
    SITE_CONFIG: resolve(root, "packages/config/sites/default.json"),
    MIGRATIONS_DIR: resolve(root, "packages/api/drizzle"),
    WEB_DIST: resolve(root, "apps/web/dist"),
    WS_UPGRADE_LIMIT: process.env.WS_UPGRADE_LIMIT ?? "10000",
  };
  if (await probeHealth(target.healthUrl)) {
    console.error(`dry-run: port ${target.port} is already in use; set E2E_PORT`);
    process.exit(1);
  }
  const server = spawn("node", ["packages/api/dist/main.js"], { cwd: root, env, stdio: "ignore" });
  const { up, reason } = await waitForReady({ url: target.healthUrl, server });
  if (!up) {
    console.error(`dry-run: server did not become ready: ${reason ?? "unknown reason"}`);
    server.kill("SIGTERM");
    process.exit(1);
  }
  // The seed run prints the demo password table to stdout: keep it out of any log.
  const quietSpawn = (cmd: string, args: string[], opts: Record<string, unknown>) =>
    spawnSync(cmd, args, { ...opts, stdio: ["ignore", "ignore", "inherit"] });
  const seed = runSeed({
    spawnSyncFn: quietSpawn,
    seedJsPath: resolve(root, "packages/api/dist/ops/seed.js"),
    cwd: root,
    env,
  });
  if (!seed.ok) {
    console.error(`dry-run: seed step failed: ${seed.reason}`);
    server.kill("SIGTERM");
    process.exit(1);
  }
  return { stop: () => server.kill("SIGTERM") };
}

// ---------------------------------------------------------------------------------------------
// Walks

/** Dispatcher and officer: quick access, form, terminal, every live-status and card scenario. */
async function queryWalk(w: Walk): Promise<void> {
  const page = w.page;
  const officer = w.layout === "officer";

  await w.run("quick access by keyboard", async () => {
    await page.getByRole("group", { name: "Quick access" }).waitFor();
    await w.shot("query panel on load");
    await w.key("Alt+Digit2");
    await page.getByRole("heading", { name: /^Person query/ }).waitFor({ timeout: 3000 });
    await w.key("Alt+Digit3");
    await page.getByRole("heading", { name: /^Property query/ }).waitFor({ timeout: 3000 });
    const bar = page.getByRole("group", { name: /^Property type/ });
    if (await w.tabTo(bar, "Property type group")) {
      await w.key("ArrowRight");
      await w.shot("property subtype");
      const checked = await bar.getByRole("radio", { checked: true }).count();
      if (checked === 0)
        w.find("keyboard", "Arrow keys in the Property type group did not select a type");
    }
    await w.key("Alt+Digit1");
    await page.getByRole("heading", { name: /^Vehicle query/ }).waitFor({ timeout: 3000 });
  });

  await w.run("vehicle by form: plate, Enter", async () => {
    await w.tabTo(page.getByLabel("Plate", { exact: true }), "Plate field");
    await w.type("ZZ-0001");
    // A plate on its own asks only the State system; the Year (26) asks both (docs/demo.md "Submit").
    await w.tabTo(page.getByLabel("Year", { exact: true }), "Year field");
    await w.type("26");
    await w.shot("vehicle form filled");
    await throttle();
    if (officer) {
      await w.tabTo(page.getByRole("button", { name: /^Run query/ }), "Run query button");
    }
    const m = await w.mark();
    await w.key("Enter");
    await w.watchSubmit("form VEH ZZ-0001", m);
    await w.shot("vehicle row settled");
    await w.shot("vehicle focus after submit");
  });

  await w.run("terminal: typed command and unrecognized command", async () => {
    await w.terminal("VEH.ZZ-0001..26", "terminal VEH ZZ-0001");
    await w.terminalProblem("XYZ.1", "terminal XYZ.1");
    const problems = page.getByRole("list", { name: "Command problems" });
    if ((await problems.count()) === 0) w.find("failed", "XYZ.1 shows no 'Command problems' list");
    else await w.shot("unrecognized command");
  });

  await w.run("live status: clean no-record", () =>
    w.terminal("VEH.ABC123..26", "VEH ABC123").then(() => {}),
  );
  await w.run("live status: FAIL1 (one source fails)", () =>
    w.terminal("VEH.FAIL1..26", "VEH FAIL1").then(() => {}),
  );
  await w.run("live status: TIMEOUT (national source waits for its deadline)", async () => {
    await w.terminal("VEH.TIMEOUT..26", "VEH TIMEOUT", {
      settleMs: 20_000,
      expectedSettle: 10_000,
      holdPending: true,
    });
  });

  await w.run("cards: wanted check, show detail by keyboard", async () => {
    await w.terminal("WNT.WANTED", "WNT WANTED");
    const row = w.firstRow();
    const toggle = row.getByRole("button", { name: /detail/i }).first();
    await w
      .poll(async () => (await toggle.count()) > 0, 6000, "the Show detail toggle")
      .catch(() => {});
    if ((await toggle.count()) === 0) {
      w.find("note", "WNT WANTED card has no Show detail toggle");
      return;
    }
    // Reach the results by keyboard: Tab to the selected request, Up to the newest, Enter.
    const selected = w.list().locator('[tabindex="0"]').first();
    let opened = false;
    if (await w.tabTo(selected, "the selected request in the list")) {
      for (let k = 0; k < 20; k++) await w.key("ArrowUp");
      w.find("note", `focus after Up arrows in the list: ${await w.focusDescription()}`);
      await w.key("Enter");
      await sleep(300);
      opened = /Hide detail/i.test(await row.innerText());
    }
    if (!opened) {
      w.find("keyboard", "Enter on the newest request did not open its detail; trying the toggle");
      await w.activate(toggle, "Show detail toggle");
      await sleep(300);
      if (!/Hide detail/i.test(await row.innerText()))
        w.find("keyboard", "Show detail could not be opened by keyboard");
    }
    await w.shot("WNT detail open (warrants)");
  });

  await w.run("cards: person with also-run wanted check", () =>
    w.terminal("PER.WANTED.SAMPLE.01011901", "PER WANTED also-run").then(() => {}),
  );
  await w.run("cards: missing person", () =>
    w.terminal("WNT.MISSING", "WNT MISSING").then(() => {}),
  );
  await w.run("cards: stolen property", () =>
    w.terminal("PRO.ZZSTOLEN1.ELECTRONICS", "PRO ZZSTOLEN1").then(() => {}),
  );
  await w.run("cards: driver's license", () =>
    w.terminal("DL.ZZDLTEST", "DL ZZDLTEST").then(() => {}),
  );
  await w.run("examples: out-of-state plate and VIN lookup", async () => {
    await w.terminalProblem("VEH.ZZ-0001.OK", "terminal VEH ZZ-0001 OK");
    await w.terminal("VEH....ZZZZZZZZZZZZZZZZ0", "VEH VIN only", { shot: false });
  });
  await w.run("examples: person standard, typed-only NAM, multi-source PROP", async () => {
    await w.terminal("PER.TESTERSON.SAMPLE.01011901", "PER TESTERSON", { shot: false });
    await w.terminal("NAM.TESTERSON.SAMPLE.01011901", "NAM TESTERSON", { shot: false });
    await w.terminalProblem("PROP.FIREARM.ZZ123", "terminal PROP FIREARM ZZ123");
  });

  await w.run("form: out-of-state plate asks for Plate type", async () => {
    await w.terminalMode(false);
    await w.key("Alt+Digit1");
    const state = page.getByLabel("State", { exact: true });
    await w.choose(state, "Oklahoma", "State select");
    await sleep(300);
    const plateType = page.getByLabel("Plate type");
    if ((await plateType.count()) === 0)
      w.find("failed", "State Oklahoma does not show Plate type");
    await w.tabTo(page.getByLabel("Plate", { exact: true }), "Plate field");
    await w.key("Control+A");
    await w.type("ZZ-0001");
    await w.key("Enter");
    await sleep(500);
    w.find(
      "note",
      `announcement after the refused submit: ${(
        await page
          .getByTestId("announcer-polite")
          .innerText()
          .catch(() => "")
      ).trim()}`,
    );
    await w.shot("form OK plate needs Plate type");
    w.find("note", `focus after the refused submit: ${await w.focusDescription()}`);
    await w.choose(state, "Texas", "State select (back to Texas)");
  });

  await w.run("form: firearm asks for Make and Caliber", async () => {
    await w.key("Alt+Digit3");
    const bar = page.getByRole("group", { name: /^Property type/ });
    if (await w.tabTo(bar, "Property type group")) {
      for (let i = 0; i < 6; i++) {
        const label = await bar.evaluate((el) => {
          const r = el.querySelector<HTMLInputElement>("input[type=radio]:checked");
          return r?.labels?.[0]?.textContent ?? r?.closest("label")?.textContent ?? "";
        });
        if (/firearm/i.test(label)) break;
        await w.key("ArrowLeft");
      }
    }
    await w.tabTo(page.getByLabel("Serial number"), "Serial number field");
    await w.type("ZZ123");
    await w.key("Enter");
    await sleep(500);
    await w.shot("form firearm needs Make and Caliber");
    await w.tabTo(page.getByLabel("Make"), "Make field");
    await w.type("TESTMAKE");
    await w.tabTo(page.getByLabel("Caliber"), "Caliber field");
    await w.type("9MM");
    await throttle();
    const m = await w.mark();
    await w.key("Enter");
    await w.watchSubmit("form PRO firearm ZZ123", m);
    await w.shot("form firearm submitted");
  });

  await w.run("form: person query, then switch back to form mode", async () => {
    await w.terminalMode(false);
    await w.key("Alt+Digit2");
    await w.shot("person form");
  });

  await w.run("reload: the request list returns with its cards", async () => {
    await w.timed("reload to the request list", async () => {
      await page.reload();
      await w.list().getByRole("listitem").first().waitFor({ timeout: 15_000 });
    });
    await w.shot("after reload");
  });

  await w.run("shortcuts dialog: Shift+/ and Esc", async () => {
    await page.getByRole("group", { name: "Quick access" }).waitFor();
    await w.key("Shift+Slash");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await dialog.waitFor({ timeout: 3000 });
    await w.shot("keyboard shortcuts dialog");
    await w.key("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
    w.find("note", `focus after closing the shortcuts dialog: ${await w.focusDescription()}`);
  });

  await w.run("themes: Night and Red shift", async () => {
    await themeWalk(w);
  });

  await w.run("status page", async () => {
    await w.activate(page.getByRole("link", { name: "Status" }), "Status link");
    await page
      .getByRole("main")
      .getByText(/^Connected\. Heartbeat round trip/)
      .waitFor({ timeout: 10_000 });
    await w.shot("status page");
    await w.activate(page.getByRole("button", { name: "Check again" }), "Check again button");
    await sleep(800);
    await w.shot("status after Check again");
    await w.activate(page.getByRole("link", { name: "Queries" }), "Queries link");
    await page.getByRole("heading", { name: "Query Module", exact: true }).waitFor();
  });

  await w.run("connection lost: Run query is held, then restored", async () => {
    await w.terminalMode(false);
    await w.key("Alt+Digit1");
    await w.tabTo(page.getByLabel("Plate", { exact: true }), "Plate field");
    await w.key("Control+A");
    await w.type("ZZ-0001");
    w.offline = true;
    await w.context.setOffline(true);
    await sleep(1500);
    await w.key("Enter");
    await sleep(800);
    const failed = /failed/i.test(
      await w
        .firstRow()
        .innerText()
        .catch(() => ""),
    );
    const held = (await page.getByText("No connection to server").count()) > 0;
    w.find(
      "note",
      `submit with the connection down: ${failed ? "a Failed row appeared" : "no row"}, hold text ${held ? "shown" : "NOT shown"}`,
    );
    await w.shot("offline held run query");
    await w.context.setOffline(false);
    w.offline = false;
    await w
      .timed(
        "connection restored",
        () =>
          page
            .getByText(/Connection restored/i)
            .first()
            .waitFor({ timeout: 45_000 }),
        30_000,
      )
      .catch(() => w.find("failed", "no 'Connection restored' message within 45 s"));
    await w.shot("connection restored");
  });

  await w.run("failed submit (blocked) and Retry by keyboard", async () => {
    await w.terminalMode(false);
    await w.key("Alt+Digit1");
    await w.tabTo(page.getByLabel("Plate", { exact: true }), "Plate field");
    await w.key("Control+A");
    await w.type("ZZ-0001");
    await page.route("**/api/v1/queries", async (route) => {
      if (route.request().method() === "POST") await route.abort();
      else await route.continue();
    });
    await throttle();
    await w.key("Enter");
    await w.poll(
      async () => /failed/i.test(await w.firstRow().innerText()),
      10_000,
      "a Failed row",
    );
    await sleep(400);
    await w.shot("failed row with Retry");
    await page.unroute("**/api/v1/queries");
    const retry = w
      .list()
      .getByRole("button", { name: /^Retry/ })
      .first();
    if (await w.tabTo(retry, "Retry button")) {
      await w
        .timed("Retry enabled after the failed submit", () =>
          w.poll(
            async () => (await retry.getAttribute("aria-disabled")) !== "true",
            25_000,
            "Retry to be enabled",
          ),
        )
        .catch((e: Error) => w.find("failed", e.message));
      // Enter on Retry again every 2 s until a new acknowledged row shows (the app may hold Retry
      // while it re-checks the connection): the time to the first one that works is the finding.
      const t0 = Date.now();
      let presses = 0;
      let acked = false;
      while (!acked && presses < 20) {
        await w.key("Enter");
        presses += 1;
        acked = await w
          .poll(
            async () => /acknowledged/i.test(await w.firstRow().innerText()),
            2000,
            "Acknowledged after Retry",
          )
          .then(() => true)
          .catch(() => false);
      }
      const retryMs = Date.now() - t0;
      timings.push({
        walk: w.name,
        what: "Retry: first Enter to an acknowledged row",
        ms: retryMs,
      });
      if (!acked)
        w.find("failed", `Retry never produced an acknowledged row (${presses} Enter presses)`);
      else if (presses > 1)
        w.find(
          "slow",
          `Retry needed ${presses} Enter presses (${(retryMs / 1000).toFixed(1)} s) after the connection came back; the first ${presses - 1} did nothing`,
        );
      await w.shot("after retry");
      w.find("note", `focus after Retry: ${await w.focusDescription()}`);
    }
  });
}

/** Theme buttons by keyboard: the account disclosure (dispatcher) or the compact bar (officer). */
async function themeWalk(w: Walk): Promise<void> {
  const page = w.page;
  const html = page.locator("html");
  const barGroup = page.getByRole("banner").getByRole("group", { name: "Theme" });
  let group = barGroup;
  if ((await barGroup.count()) === 0) {
    const account = page.getByRole("banner").locator(".qm-account__button");
    await w.activate(account, "account menu button");
    group = page.getByRole("group", { name: "Account" }).getByRole("group", { name: "Theme" });
  }
  const wanted = (process.env.DRY_RUN_THEME_LIST ?? "Night,Red shift,Match system").split(",");
  for (const [label, mode] of [
    ["Night", "night"],
    ["Red shift", "redShift"],
    ["Match system", "auto"],
  ] as const) {
    if (!wanted.includes(label)) continue;
    if (
      !(await w.tabTo(
        group.getByRole("button", { name: label, exact: true }),
        `${label} theme button`,
      ))
    )
      continue;
    await w.key("Enter");
    await sleep(500);
    const theme = await html.getAttribute("data-theme");
    if (mode !== "auto" && theme !== mode)
      w.find("failed", `${label}: data-theme is "${theme}", expected "${mode}"`);
    if (mode !== "auto") await w.shot(`theme ${label}`);
  }
  await w.key("Escape");
}

/** The admin builder click path of docs/demo.md, and the publish loop with an open dispatcher tab. */
async function adminWalk(w: Walk, opts: { publish: boolean; dispatcher?: Walk }): Promise<void> {
  const page = w.page;
  const tree = page.getByRole("navigation", { name: "Configuration items" });
  const editor = page.getByTestId("form-tab");
  const preview = page.getByRole("region", { name: "Card preview" });

  /** Move down the tree by arrows to the item whose text matches, then Enter. */
  const treeTo = async (name: RegExp, what: string, expand?: RegExp): Promise<boolean> => {
    const focusedText = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el ? (el.textContent || "").trim().replace(/\s+/g, " ") : "";
      });
    const onItem = () =>
      page.evaluate(() => document.activeElement?.getAttribute("role") === "treeitem");
    if (
      !(await onItem()) &&
      !(await w.tabTo(tree.locator('[role="treeitem"][tabindex="0"]').first(), `${what}: the tree`))
    )
      return false;
    // Start at the top of the tree.
    await w.key("Home");
    for (let i = 0; i < 160; i++) {
      const text = await focusedText();
      if (name.test(text)) {
        await w.key("Enter");
        await sleep(250);
        return true;
      }
      if (expand?.test(text)) {
        await w.key("ArrowRight");
        continue;
      }
      await w.key("ArrowDown");
    }
    w.find("keyboard", `${what}: not reached by arrow keys in the tree`);
    return false;
  };

  await w.run("open the builder by keyboard", async () => {
    await w.activate(page.getByRole("link", { name: "Admin" }), "Admin link");
    await page.getByRole("link", { name: "Site configuration" }).waitFor();
    await w.activate(
      page.getByRole("link", { name: "Site configuration" }),
      "Site configuration link",
    );
    await page
      .getByRole("heading", { name: "Site configuration", level: 2 })
      .waitFor({ timeout: 10_000 });
    await w.shot("builder on open");
  });

  await w.run("builder: select the Vehicle all-results card", async () => {
    if (await treeTo(/^1\. All results\s*veh-summary/, "Vehicle card row", /^Vehicle cards/))
      await w.shot("vehicle card editor and preview");
  });

  await w.run("builder: move Make to the summary", async () => {
    // The preview opens on "Scenario 1" (the plate ZZ-0001, a record with Make); leave it there.
    const scenario = preview.getByLabel("Scenario", { exact: true });
    const picked = await scenario
      .evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "")
      .catch(() => "");
    if (!/Scenario 1/.test(picked))
      w.find("failed", `the card preview does not open on Scenario 1 (it shows "${picked}")`);
    const edit = editor.getByRole("button", { name: /^Edit\s?Make/ }).first();
    if (!(await w.activate(edit, "Edit Make button"))) return;
    await sleep(250);
    await w.outline("make row editor", editor);
    const showIn = editor.getByRole("group", { name: /Show in/i }).first();
    if (await w.radio(showIn, /Summary/i, "Show in control")) {
      await sleep(400);
      const onCard = (await preview.getByText("Make", { exact: false }).count()) > 0;
      if (!onCard) w.find("failed", "after Show in Summary the card preview does not show Make");
      await w.shot("make moved to summary");
    }
  });

  await w.run("builder: Preview as Officer", async () => {
    await w.activate(preview.getByRole("button", { name: "Officer" }), "preview Officer button");
    await sleep(300);
    await w.shot("card preview as officer");
    await w.activate(
      preview.getByRole("button", { name: "Dispatcher" }),
      "preview Dispatcher button",
    );
  });

  await w.run("builder: add keyword TESTMAKE with severity Warning", async () => {
    if (!(await treeTo(/^Keywords and severity/, "Keywords row"))) return;
    // The new-keyword row: word, severity, then Add keyword (an empty word adds nothing).
    if (!(await w.tabTo(editor.getByLabel("New keyword", { exact: true }), "New keyword field")))
      return;
    await w.type("TESTMAKE");
    await w.choose(
      editor.getByLabel("Severity of the new keyword"),
      "Warning",
      "new keyword Severity select",
    );
    if (
      !(await w.activate(editor.getByRole("button", { name: /Add keyword/ }), "Add keyword button"))
    )
      return;
    await sleep(300);
    w.find("note", `focus after Add keyword: ${await w.focusDescription()}`);
    await w.shot("keyword added");
  });

  await w.run("builder: second Vehicle card shows Which card wins", async () => {
    if (!(await treeTo(/^Vehicle cards/, "Vehicle cards row"))) return;
    if (
      !(await w.activate(
        editor.getByRole("button", { name: /^Add Vehicle card/ }),
        "Add Vehicle card button",
      ))
    )
      return;
    await sleep(400);
    const source = editor.getByLabel("Source", { exact: true }).first();
    await w.choose(source, "National system", "card Source select");
    await sleep(300);
    const wins = editor.getByRole("table", { name: "Which card wins" });
    await wins.scrollIntoViewIfNeeded();
    await w.shot("which card wins with two cards");
  });

  await w.run("builder: Try a match", async () => {
    if (!(await treeTo(/^Mock response: Vehicle, State system/, "mock response row"))) return;
    const pane = page.getByRole("region", { name: "Try a match" });
    if (!(await w.tabTo(pane.getByLabel("Plate", { exact: true }), "Try a match Plate field")))
      return;
    await w.type("ZZ-0001");
    await sleep(300);
    await w.shot("try a match ZZ-0001");
    await w.activate(pane.getByRole("button", { name: "Payload" }), "Payload button");
    await sleep(200);
    await w.shot("try a match payload");
    await w.activate(pane.getByRole("button", { name: "Result card" }), "Result card button");
    await w.tabTo(pane.getByLabel("Plate", { exact: true }), "Try a match Plate field");
    await w.key("Control+A");
    await w.type("ABC123");
    await sleep(300);
    await w.shot("try a match ABC123");
    await w.key("Control+A");
    await w.type("NOMATCH9");
    await sleep(300);
    await w.shot("try a match no scenario");
  });

  await w.run("builder: Undo and Changes view", async () => {
    const tablist = page.getByRole("tablist", { name: "Config editor views" });
    if (await w.tabTo(tablist.locator('[role="tab"][tabindex="0"]').first(), "config view tabs")) {
      await w.key("ArrowRight");
      await w.key("ArrowRight");
      await sleep(300);
      if ((await tablist.getByRole("tab", { name: "Changes", selected: true }).count()) === 0)
        w.find("keyboard", "two ArrowRight presses from Form did not select the Changes tab");
      await w.shot("changes view");
      await w.key("ArrowLeft");
      await w.key("ArrowLeft");
    }
  });

  if (opts.publish) {
    await w.run("publish and the open dispatcher tab", async () => {
      await w.activate(
        page.getByRole("button", { name: "Review and publish" }),
        "Review and publish button",
      );
      const dialog = page.getByRole("dialog", { name: "Review and publish" });
      await dialog.waitFor({ timeout: 5000 });
      await w.shot("review and publish dialog");
      const confirm = dialog.getByRole("button", { name: /^Publish version \d+$/ });
      if (!(await w.tabTo(confirm, "Publish version button"))) return;
      await w.key("Enter");
      await page
        .getByText(/^Published version \d+\./)
        .first()
        .waitFor({ timeout: 10_000 });
      await w.shot("published");
      const d = opts.dispatcher;
      if (d !== undefined) {
        await w
          .timed(
            "publish to the open dispatcher form updating (15 s refresh)",
            async () => {
              await w.poll(
                async () =>
                  (await d.page.getByText(/The form was updated by your administrator/).count()) >
                  0,
                30_000,
                "the dispatcher form update",
              );
            },
            15_000,
          )
          .catch(() =>
            w.find(
              "failed",
              "the open dispatcher tab never said 'The form was updated by your administrator'",
            ),
          );
        await w.shot("dispatcher tab after publish", d.page);
        // The dispatcher submits in the already-open tab: the published cards and keyword apply.
        await d.terminal("VEH.ZZ-0001", "dispatcher VEH ZZ-0001 after publish");
        await w.shot("dispatcher result after publish", d.page);
      }
    });
    await w.run("history and roll back", async () => {
      await w.activate(page.getByRole("button", { name: "History" }), "History button");
      await sleep(400);
      await w.shot("version history");
      const rollBack = page.getByRole("button", { name: /^Roll back to version/ }).first();
      if (!(await w.activate(rollBack, "Roll back button"))) return;
      const dialog = page.getByRole("dialog", { name: /^Roll back to version/ });
      await dialog.waitFor({ timeout: 5000 });
      await w.shot("roll back dialog");
      const confirm = dialog.getByRole("button", { name: /^Roll back/ }).last();
      if (!(await w.tabTo(confirm, "Roll back confirm"))) return;
      await w.key("Enter");
      await page
        .getByText(/roll back of version/)
        .first()
        .waitFor({ timeout: 10_000 });
      await w.shot("rolled back");
    });
  }

  await w.run("users and roles", async () => {
    await w.activate(
      page
        .getByRole("navigation", { name: "Admin sections" })
        .getByRole("link", { name: "Users and roles" }),
      "Users and roles link",
    );
    await page
      .getByRole("heading", { name: "Users and roles", exact: true })
      .waitFor({ timeout: 8000 });
    await w.shot("users and roles");
  });
}

/** The implementer: Admin link and Site configuration only. */
async function implementerWalk(w: Walk): Promise<void> {
  const page = w.page;
  await w.run("implementer: Site configuration only", async () => {
    await w.activate(page.getByRole("link", { name: "Admin" }), "Admin link");
    await page
      .getByRole("heading", { name: "Site configuration", level: 2 })
      .waitFor({ timeout: 10_000 });
    const users = await page
      .getByRole("navigation", { name: "Admin sections" })
      .getByRole("link", { name: "Users and roles" })
      .count();
    if (users > 0) w.find("failed", "implementer sees 'Users and roles'");
    await w.shot("implementer builder");
  });
}

// ---------------------------------------------------------------------------------------------
// Main

interface Plan {
  name: string;
  email: string;
  width: number;
  layout: "dispatch" | "officer";
  go: (w: Walk, browser: Browser) => Promise<void>;
}

const plans: Plan[] = [
  {
    name: "dispatcher-1366",
    email: "dispatcher@example.test",
    width: 1366,
    layout: "dispatch",
    go: (w) => queryWalk(w),
  },
  {
    name: "dispatcher-1024",
    email: "dispatcher@example.test",
    width: 1024,
    layout: "dispatch",
    go: (w) => queryWalk(w),
  },
  {
    name: "officer-1024",
    email: "officer@example.test",
    width: 1024,
    layout: "officer",
    go: (w) => queryWalk(w),
  },
  {
    name: "admin-1366",
    email: "admin@example.test",
    width: 1366,
    layout: "dispatch",
    go: async (w, browser) => {
      // The dispatcher's window stays open and untouched while the admin publishes.
      const dctx = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        baseURL: target.origin,
      });
      const d = new Walk("dispatcher-watch", dctx, await dctx.newPage(), "dispatch");
      await d.signIn("dispatcher@example.test");
      await d.page.getByRole("group", { name: "Quick access" }).waitFor();
      await adminWalk(w, { publish: true, dispatcher: d });
      await dctx.close();
    },
  },
  {
    name: "admin-1024",
    email: "admin@example.test",
    width: 1024,
    layout: "dispatch",
    go: (w) => adminWalk(w, { publish: false }),
  },
  {
    name: "implementer-1366",
    email: "implementer@example.test",
    width: 1366,
    layout: "dispatch",
    go: (w) => implementerWalk(w),
  },
];

async function main(): Promise<void> {
  const only = (process.env.DRY_RUN_ONLY ?? "").split(",").filter((s) => s !== "");
  const server = await startServer();
  if (process.env.DRY_RUN_SERVE_ONLY === "1") {
    console.log(`serving ${target.origin} until stopped`);
    await new Promise(() => {});
  }
  const browser = await chromium.launch(
    process.env.DRY_RUN_GPU === "1" ? undefined : { args: ["--disable-gpu"] },
  );
  try {
    for (const plan of plans) {
      if (only.length > 0 && !only.includes(plan.name)) continue;
      console.log(`\n=== ${plan.name}`);
      const context = await browser.newContext({
        viewport: { width: plan.width, height: 768 },
        baseURL: target.origin,
      });
      const w = new Walk(plan.name, context, await context.newPage(), plan.layout);
      await w.run("sign in by keyboard", () => w.signIn(plan.email));
      await plan.go(w, browser);
      await context.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
  writeReport();
}

function writeReport(): void {
  writeFileSync(resolve(outDir, "report.json"), JSON.stringify({ findings, timings }, null, 2));
  const lines = [
    "# Demo dry run report",
    "",
    `Findings: ${findings.length}`,
    "",
    "| Walk | Step | Kind | Detail |",
    "|---|---|---|---|",
  ];
  for (const f of findings)
    lines.push(`| ${f.walk} | ${f.step} | ${f.kind} | ${f.detail.replace(/\|/g, "/")} |`);
  lines.push("", "## Timings", "", "| Walk | What | Seconds |", "|---|---|---|");
  for (const t of timings.filter((t) => !t.what.startsWith("step:")))
    lines.push(`| ${t.walk} | ${t.what} | ${(t.ms / 1000).toFixed(2)} |`);
  writeFileSync(resolve(outDir, "report.md"), `${lines.join("\n")}\n`);
  console.log(`\nReport: ${resolve(outDir, "report.md")} (${findings.length} findings)`);
}

await main();
