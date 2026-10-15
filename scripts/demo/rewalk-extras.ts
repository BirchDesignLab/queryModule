// Demo re-walk, extras: what scripts/demo/dry-run.ts never exercised (10-15-26). Mouse and keyboard
// together (this is a coverage pass, not the keyboard-only pass). Builds nothing: run the dry run
// (or `pnpm --filter ... build`) first so apps/web/dist and packages/api/dist exist.
//
//   E2E_PORT=3200 node scripts/demo/rewalk-extras.ts
//
// Covers: the builder at 1024x768; critical cards in Night and Red shift (dispatcher and officer);
// Edit as new query on a normal row; the Status page; the publish payoff on the dispatcher (Make in
// the summary, TESTMAKE warning); demo-seed.ts run once on a throwaway second server (E2E_PORT + 1).
// Output: shots/*.png and notes.md under REWALK_OUT. Mock data only.
/// <reference lib="dom" />
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { e2eTarget, runSeed, waitForReady } from "../dev/e2e-lib.ts";
import { ensureDevSecrets } from "../dev/secrets.ts";

// biome-ignore lint/suspicious/noExplicitAny: Playwright lives in apps/web only; its types are not visible here.
type Any = any;

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test") as Any;
const outDir = resolve(root, process.env.REWALK_OUT ?? ".superpowers/sdd/2026-10-15-demo-rewalk");
const shotsDir = resolve(outDir, "shots");
mkdirSync(shotsDir, { recursive: true });
const secrets = resolve(root, ".dev/secrets");
ensureDevSecrets(secrets);
const target = e2eTarget(process.env);
const notesFile = resolve(outDir, "extras-notes.md");
writeFileSync(notesFile, "# Re-walk extras notes\n\n");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
const note = (line: string) => {
  console.log(line);
  appendFileSync(notesFile, `${line}\n`);
};
const secret = readFileSync(resolve(secrets, "SEED_PASSWORD_SECRET"), "utf8").trim();
const passwordFor = (email: string) =>
  createHmac("sha256", secret).update(email.toLowerCase()).digest("base64url");

let shotNo = 0;
let current: Any;
const only = process.env.REWALK_ONLY ? new RegExp(process.env.REWALK_ONLY, "i") : undefined;
async function shot(page: Any, label: string): Promise<void> {
  shotNo += 1;
  const file = `extras-${String(shotNo).padStart(2, "0")}-${slug(label)}.png`;
  await page.screenshot({ path: resolve(shotsDir, file) }).catch(() => {});
  note(`- shot ${file}`);
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  if (only && !only.test(name)) return;
  note(`\n## ${name}`);
  try {
    await fn();
  } catch (e) {
    note(`- FAILED: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    if (current) await shot(current, `FAILED ${name}`);
  }
}

function startServer(port: string, origin: string, health: string): Promise<ChildProcess> {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    PUBLIC_ORIGIN: origin,
    DATA_DIR: mkdtempSync(resolve(root, ".dev/e2e-")),
    SECRETS_DIR: secrets,
    ALLOW_MOCK_SOURCES: "true",
    SITE_CONFIG: resolve(root, "packages/config/sites/default.json"),
    MIGRATIONS_DIR: resolve(root, "packages/api/drizzle"),
    WEB_DIST: resolve(root, "apps/web/dist"),
    WS_UPGRADE_LIMIT: "10000",
  };
  const server = spawn("node", ["packages/api/dist/main.js"], { cwd: root, env, stdio: "ignore" });
  return waitForReady({ url: health, server }).then(({ up, reason }) => {
    if (!up) throw new Error(`server not ready: ${reason ?? "unknown"}`);
    const seed = runSeed({
      spawnSyncFn: (cmd: string, args: string[], opts: Record<string, unknown>) =>
        spawnSync(cmd, args, { ...opts, stdio: ["ignore", "ignore", "inherit"] }),
      seedJsPath: resolve(root, "packages/api/dist/ops/seed.js"),
      cwd: root,
      env,
    });
    if (!seed.ok) throw new Error(`seed failed: ${seed.reason}`);
    return server;
  });
}

async function signIn(ctxPage: Any, email: string): Promise<void> {
  await ctxPage.goto("/");
  await ctxPage.getByRole("heading", { name: "Sign in" }).waitFor();
  await ctxPage.getByLabel("Email").fill(email);
  await ctxPage.getByLabel("Password").fill(passwordFor(email));
  await ctxPage.getByRole("button", { name: "Sign in" }).click();
  await ctxPage
    .getByRole("heading", { name: "Query Module", exact: true })
    .waitFor({ timeout: 15000 });
}

const listName = (officer: boolean) => (officer ? "Last request" : "Requests this shift");

/** Terminal command, then wait for the acknowledgment, every source settled and a card drawn. */
async function runTerminal(page: Any, officer: boolean, cmd: string): Promise<string> {
  const input = page.getByRole("textbox", { name: "Command" });
  if (!(await input.isVisible().catch(() => false))) {
    await page.keyboard.press("Control+Backquote");
    await sleep(300);
  }
  await input.fill(cmd);
  await input.press("Enter");
  const row = page
    .getByRole("region", { name: listName(officer) })
    .getByRole("listitem")
    .first();
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const t = await row.innerText().catch(() => "");
    if (
      /acknowledged/i.test(t) &&
      !/pending/i.test(t) &&
      (await row.getByRole("region").count()) > 0
    )
      break;
    await sleep(150);
  }
  await sleep(400);
  return row.innerText().catch(() => "");
}

/** Contrast ratio of the first element whose own text matches `re`, against its effective background. */
async function contrastOf(page: Any, re: string): Promise<string> {
  return page.evaluate((src: string) => {
    const rx = new RegExp(src, "i");
    const els = [...document.querySelectorAll("main *, [role=region] *")].filter(
      (e) => e.children.length === 0 && rx.test(e.textContent ?? ""),
    );
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = (v ?? 0) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
    };
    const out: string[] = [];
    for (const el of els.slice(0, 6)) {
      const fg = rgb(getComputedStyle(el).color);
      let bgEl: Element | null = el;
      let bg = [255, 255, 255];
      while (bgEl) {
        const c = rgb(getComputedStyle(bgEl).backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) {
          bg = c;
          break;
        }
        bgEl = bgEl.parentElement;
      }
      const [a, b] = [lum(fg), lum(bg)];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const fs = getComputedStyle(el).fontSize;
      out.push(`"${(el.textContent ?? "").trim().slice(0, 24)}" ${ratio.toFixed(2)}:1 at ${fs}`);
    }
    return out.join("; ") || "no element matched";
  }, re);
}

/** Elements that stick out of their parent's box or the viewport (clipping and spill hunting). */
async function overflowReport(page: Any): Promise<string> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw)
      out.push(`page scrolls horizontally: ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const p = el.parentElement;
      const pr = p?.getBoundingClientRect();
      const label = `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 30)} "${(el.textContent ?? "").trim().slice(0, 20)}"`;
      if (r.right > vw + 1) out.push(`past viewport: ${label} right=${Math.round(r.right)}`);
      else if (
        p &&
        pr &&
        getComputedStyle(p).overflow === "visible" &&
        r.right > pr.right + 2 &&
        pr.width > 0
      )
        out.push(`spills parent: ${label} by ${Math.round(r.right - pr.right)} px`);
      if (out.length > 14) break;
    }
    return out.join("\n    ") || "none";
  });
}

async function setTheme(page: Any, label: string): Promise<void> {
  const bar = page.getByRole("banner").getByRole("group", { name: "Theme" });
  if ((await bar.count()) === 0) {
    await page.getByRole("banner").locator(".qm-account__button").click();
    await sleep(250);
    await page
      .getByRole("group", { name: "Account" })
      .getByRole("group", { name: "Theme" })
      .getByRole("button", { name: label, exact: true })
      .click();
    await sleep(400);
    await page.keyboard.press("Escape");
  } else {
    await bar.getByRole("button", { name: label, exact: true }).click();
  }
  await sleep(400);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  const ctx = async (email: string, width: number, height = 768) => {
    const c = await browser.newContext({ viewport: { width, height }, baseURL: target.origin });
    const page = await c.newPage();
    await signIn(page, email);
    return { c, page };
  };
  note(`Server on ${target.origin}`);
  const server = await startServer(target.port, target.origin, target.healthUrl);
  try {
    // 1. Edit as new query on a normal row, and the Status page (dispatcher, 1366).
    await step("dispatcher 1366: Edit as new query on a normal row", async () => {
      const { c, page } = await ctx("dispatcher@example.test", 1366);
      const text = await runTerminal(page, false, "VEH.ZZ-0001..26");
      note(`- first row after run: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
      await shot(page, "dispatcher after run, form reset");
      const row = page
        .getByRole("region", { name: listName(false) })
        .getByRole("listitem")
        .first();
      const edit = row.getByRole("button", { name: /Edit as new query/i });
      note(`- Edit as new query buttons on the row: ${await edit.count()}`);
      await edit.first().click();
      await sleep(500);
      note(
        `- focus after Edit as new query: ${await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.id ?? ""}`)}`,
      );
      note(
        `- loaded line visible: ${await page.getByText(/Values loaded from the earlier request/i).count()}`,
      );
      note(
        `- plate field value: ${await page
          .getByLabel(/^Plate/)
          .first()
          .inputValue()
          .catch(() => "n/a")}`,
      );
      note(
        `- Year field value: ${await page
          .getByLabel(/^Year/)
          .first()
          .inputValue()
          .catch(() => "n/a")}`,
      );
      await shot(page, "edit as new query loaded");
      await c.close();
    });
    // R21: on the longest forms, scrolled to the bottom, nothing may sit under the sticky action bar.
    for (const width of [1366, 1024]) {
      await step(`action bar clearance ${width}: longest form scrolled to the bottom`, async () => {
        const { c, page } = await ctx("dispatcher@example.test", width);
        current = page;
        for (const [label, kind] of [
          ["Property", "FIREARM"],
          ["Vehicle", "OK"],
        ] as const) {
          await page.keyboard.press(label === "Property" ? "Alt+Digit3" : "Alt+Digit1");
          await sleep(300);
          if (kind === "FIREARM") {
            await page
              .getByRole("radio", { name: /firearm/i })
              .first()
              .evaluate((el: HTMLInputElement) => el.click());
          } else {
            await page.getByLabel("State", { exact: true }).selectOption({ label: "Oklahoma" });
          }
          await sleep(400);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await sleep(300);
          const report = await page.evaluate(() => {
            const bar = document.querySelector(".qm-action-bar");
            if (!bar) return "no action bar";
            const top = bar.getBoundingClientRect().top;
            const under: string[] = [];
            for (const el of document.querySelectorAll(
              "main input, main select, main textarea, main fieldset, main legend",
            )) {
              if (bar.contains(el)) continue;
              const r = el.getBoundingClientRect();
              if (r.height > 0 && r.bottom > top + 1 && r.top < bar.getBoundingClientRect().bottom)
                under.push(
                  `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 20)}" bottom=${Math.round(r.bottom)} > bar top=${Math.round(top)}`,
                );
            }
            return under.length === 0 ? "nothing under the bar" : under.join("\n    ");
          });
          note(`- ${label} ${kind} at ${width}: ${report}`);
          await shot(page, `action bar ${width} ${label} ${kind} scrolled to bottom`);
        }
        await c.close();
      });
    }
    await step("dispatcher 1366: Status page", async () => {
      const { c, page } = await ctx("dispatcher@example.test", 1366);
      const link = page.getByRole("link", { name: /status/i }).first();
      if ((await link.count()) > 0) await link.click();
      else await page.goto("/status");
      await sleep(800);
      note(`- url: ${page.url()}`);
      note(
        `- text: ${(
          await page
            .locator("main")
            .innerText()
            .catch(() => "")
        )
          .replace(/\s+/g, " ")
          .slice(0, 500)}`,
      );
      await shot(page, "status page on arrival");
      const check = page.getByRole("button", { name: /Check again/i });
      if ((await check.count()) > 0) {
        note(`- Check again disabled on arrival: ${await check.first().isDisabled()}`);
        await check.first().click();
        await sleep(1500);
        await shot(page, "status page after check again");
        note(
          `- text after: ${(
            await page
              .locator("main")
              .innerText()
              .catch(() => "")
          )
            .replace(/\s+/g, " ")
            .slice(0, 500)}`,
        );
      }
      await c.close();
    });

    // 2. Critical cards in Night and Red shift: dispatcher 1366 and officer 1024.
    for (const [email, width, officer, tag] of [
      ["dispatcher@example.test", 1366, false, "dispatcher-1366"],
      ["officer@example.test", 1024, true, "officer-1024"],
    ] as const) {
      await step(`${tag}: critical cards in Night and Red shift`, async () => {
        const { c, page } = await ctx(email, width);
        for (const theme of ["Night", "Red shift"]) {
          await setTheme(page, theme);
          note(
            `- theme ${theme}: data-theme=${await page.locator("html").getAttribute("data-theme")}`,
          );
          await runTerminal(page, officer, "VEH.ZZ-0001..26");
          note(`- contrast CRITICAL badge: ${await contrastOf(page, "^critical$")}`);
          note(`- contrast STOLEN value: ${await contrastOf(page, "^stolen$")}`);
          await shot(page, `${tag} ${theme} VEH ZZ-0001 critical`);
          await runTerminal(page, officer, "WNT.WANTED");
          const detail = page.getByRole("button", { name: /Show detail/i }).first();
          if ((await detail.count()) > 0) await detail.click();
          await sleep(400);
          await shot(page, `${tag} ${theme} WNT WANTED detail`);
          note(`- overflow (${theme}): ${await overflowReport(page)}`);
        }
        await setTheme(page, "Match system");
        await c.close();
      });
    }

    // 3. The builder at 1024x768 (admin), then the publish payoff with an open dispatcher.
    await step("admin 1024: builder tour", async () => {
      const { c, page } = await ctx("admin@example.test", 1024);
      await page.getByRole("link", { name: "Admin" }).click();
      await page.getByRole("link", { name: "Site configuration" }).click();
      await page
        .getByRole("heading", { name: "Site configuration", level: 2 })
        .waitFor({ timeout: 10000 });
      await sleep(600);
      await shot(page, "builder 1024 on open");
      note(`- overflow on open: ${await overflowReport(page)}`);
      const tree = page.getByRole("navigation", { name: "Configuration items" });
      for (const [label, rx] of [
        ["vehicle cards", /^Vehicle cards/],
        ["all results card", /^1\. All results/],
        ["keywords", /^Keywords and severity/],
        ["mock response", /^Mock response: Vehicle, State system/],
      ] as const) {
        const item = tree.getByRole("treeitem", { name: rx }).first();
        if ((await item.count()) === 0) {
          note(`- tree item ${label}: not found (collapsed?)`);
          continue;
        }
        await item.click();
        await sleep(500);
        await shot(page, `builder 1024 ${label}`);
        note(`- overflow ${label}: ${await overflowReport(page)}`);
      }
      await c.close();
    });
    await step(
      "publish payoff: admin 1366 publishes, dispatcher 1366 shows Make and TESTMAKE",
      async () => {
        const a = await ctx("admin@example.test", 1366);
        const d = await ctx("dispatcher@example.test", 1366);
        const before = await runTerminal(d.page, false, "VEH.ZZ-0010..26");
        note(`- before publish, ZZ-0010 row: ${before.replace(/\s+/g, " ").slice(0, 240)}`);
        const page = a.page;
        current = page;
        await page.getByRole("link", { name: "Admin" }).click();
        await page.getByRole("link", { name: "Site configuration" }).click();
        await page
          .getByRole("heading", { name: "Site configuration", level: 2 })
          .waitFor({ timeout: 10000 });
        const tree = page.getByRole("navigation", { name: "Configuration items" });
        const editor = page.getByTestId("form-tab");
        const treeClick = async (rx: RegExp, expand?: RegExp) => {
          if (expand) {
            const g = tree.getByRole("treeitem", { name: expand }).first();
            if ((await g.count()) > 0 && (await g.getAttribute("aria-expanded")) === "false")
              await g.click();
          }
          await tree.getByRole("treeitem", { name: rx }).first().click();
          await sleep(400);
        };
        await treeClick(/^1\. All results/, /^Vehicle cards/);
        await editor
          .getByRole("button", { name: /^Edit\s?Make/ })
          .first()
          .click();
        await sleep(300);
        await editor
          .getByRole("group", { name: /Show in/i })
          .first()
          .getByLabel(/Summary/i)
          .check();
        await sleep(300);
        await shot(page, "publish: Make moved to summary");
        await treeClick(/^Keywords and severity/);
        await editor.getByLabel("New keyword", { exact: true }).fill("TESTMAKE");
        await editor
          .getByLabel("Severity of the new keyword")
          .selectOption({ label: "Warning" })
          .catch(() => note("- severity select: selectOption failed"));
        await editor.getByRole("button", { name: /Add keyword/ }).click();
        await sleep(400);
        await page.getByRole("button", { name: "Review and publish" }).click();
        const dlg = page.getByRole("dialog", { name: "Review and publish" });
        await dlg.waitFor({ timeout: 5000 });
        note(`- review dialog text: ${(await dlg.innerText()).replace(/\s+/g, " ").slice(0, 600)}`);
        await shot(page, "publish: review dialog");
        await dlg.getByRole("button", { name: /^Publish version \d+$/ }).click();
        await page
          .getByText(/^Published version \d+\./)
          .first()
          .waitFor({ timeout: 10000 });
        const t0 = Date.now();
        await d.page
          .getByText(/The form was updated by your administrator/)
          .first()
          .waitFor({ timeout: 30000 })
          .catch(() => note("- dispatcher never showed the form-updated notice"));
        note(`- dispatcher form updated ${((Date.now() - t0) / 1000).toFixed(1)} s after publish`);
        await shot(d.page, "publish: dispatcher after form update (old row redrawn?)");
        const after = await runTerminal(d.page, false, "VEH.ZZ-0001..26");
        note(`- after publish, ZZ-0001 row: ${after.replace(/\s+/g, " ").slice(0, 400)}`);
        note(
          `- Make in summary: ${/Make/i.test(after)}; TESTMAKE present: ${/TESTMAKE/.test(after)}`,
        );
        note(`- contrast TESTMAKE: ${await contrastOf(d.page, "TESTMAKE")}`);
        await shot(d.page, "publish: dispatcher result Make and TESTMAKE");
        const ten = await d.page
          .getByRole("region", { name: listName(false) })
          .getByRole("listitem")
          .nth(1)
          .innerText()
          .catch(() => "");
        note(
          `- the earlier ZZ-0010 row now (redraw at next refresh): ${ten.replace(/\s+/g, " ").slice(0, 300)}`,
        );
        await a.c.close();
        await d.c.close();
      },
    );
  } finally {
    server.kill("SIGTERM");
  }

  // 4. demo-seed.ts run once on a throwaway second server.
  const port2 = String(Number(target.port) + 1);
  const origin2 = `http://localhost:${port2}`;
  const server2 =
    only && !/seed/i.test(only.source)
      ? undefined
      : await startServer(port2, origin2, `${origin2}/api/v1/health`).catch((e: Error) => {
          note(`\n## demo-seed: second server failed: ${e.message}`);
          return undefined;
        });
  if (server2) {
    try {
      await step("demo-seed.ts on a throwaway database", async () => {
        const secretFile = resolve(secrets, "SEED_PASSWORD_SECRET");
        const run = () =>
          spawnSync("node", ["scripts/dev/demo-seed.ts", origin2], {
            cwd: root,
            env: { ...process.env, SEED_PASSWORD_SECRET_FILE: secretFile },
            encoding: "utf8",
          });
        const t0 = Date.now();
        const first = run();
        note(
          `- first run: exit ${first.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s; stdout: ${(first.stdout ?? "").replace(/\s+/g, " ").slice(0, 400)}`,
        );
        const second = run();
        note(
          `- second run: exit ${second.status} (3 = refused); stderr: ${(second.stderr ?? "").trim().slice(0, 200)}`,
        );
        const c = await browser.newContext({
          viewport: { width: 1366, height: 768 },
          baseURL: origin2,
        });
        const page = await c.newPage();
        await signIn(page, "dispatcher@example.test");
        await sleep(1500);
        await shot(page, "dispatcher after demo-seed 1366");
        const rows = await page
          .getByRole("region", { name: listName(false) })
          .getByRole("listitem")
          .count();
        note(`- rows listed after seed: ${rows}`);
        note(
          `- first row: ${(
            await page
              .getByRole("region", { name: listName(false) })
              .getByRole("listitem")
              .first()
              .innerText()
          )
            .replace(/\s+/g, " ")
            .slice(0, 300)}`,
        );
        await c.close();
        const rec = await browser.newContext({
          viewport: { width: 1366, height: 768 },
          baseURL: origin2,
        });
        const rp = await rec.newPage();
        await signIn(rp, "records@example.test");
        note(
          `- records account rows after seed (should be 0): ${await rp
            .getByRole("region", { name: listName(false) })
            .getByRole("listitem")
            .count()}`,
        );
        await rec.close();
      });
    } finally {
      server2.kill("SIGTERM");
    }
  }
  await browser.close();
  note("\nDone.");
}

await main();
