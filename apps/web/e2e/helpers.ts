import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import type { APIResponse, BrowserContext, Page, Route } from "@playwright/test";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

import { expect, test } from "./fixtures.js";

/** The seeded `smoke` user (spec 8.5). CI step 12 exports these; locally set them from the first `pnpm dev` output. */
export function e2eUser(): { email: string; password: string } {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (email === undefined || email === "" || password === undefined || password === "") {
    throw new Error("Set E2E_USER_EMAIL and E2E_USER_PASSWORD to the seeded smoke user");
  }
  return { email, password };
}

/**
 * A seeded demo account (spec 8.5): its password is derived from the seed secret exactly as the
 * seeder does (HMAC-SHA256 of the lower-cased email, base64url), so it is never stored or printed.
 * CI exports SEED_PASSWORD_SECRET_FILE; locally the secret is the repo's `.dev/secrets` file.
 */
export function seededUser(email: string): { email: string; password: string } {
  const file =
    process.env.SEED_PASSWORD_SECRET_FILE ??
    fileURLToPath(new NodeURL("../../../.dev/secrets/SEED_PASSWORD_SECRET", import.meta.url));
  let secret: string;
  try {
    secret = readFileSync(file, "utf8").trim();
  } catch {
    // Name the variable, never the secret.
    throw new Error(
      "Seed password secret unreadable: set SEED_PASSWORD_SECRET_FILE or run the dev seed (.dev/secrets)",
    );
  }
  return {
    email,
    password: createHmac("sha256", secret).update(email.toLowerCase()).digest("base64url"),
  };
}

/** The demo users whose signed-in state `auth.setup.ts` saves once per run (spec 8.5 seed). */
export const DEMO_EMAILS = [
  "dispatcher@example.test",
  "officer@example.test",
  "admin@example.test",
] as const;

/**
 * Where the setup project keeps one signed-in storage state per user, in the gitignored `.dev`
 * (a session cookie is a credential for the throwaway e2e database; never commit it).
 */
export function authStatePath(email: string): string {
  return fileURLToPath(
    new NodeURL(`../../../.dev/e2e-auth/${email.toLowerCase()}.json`, import.meta.url),
  );
}

/** Enters at "/" only; the app routes client-side to /login (spec 5.1 lists "/" as a web route). */
export async function signInWithForm(page: Page, user = e2eUser()): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await fillSignIn(page, user);
}

async function fillSignIn(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signed-in only: the login panel is gone. Exact name: the login h1 "Query Module 2.0" would
  // match a substring locator before the session exists (#328 CI).
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Query Module", exact: true })).toBeVisible();
}

/**
 * Signs in as `user`, reusing the session the setup project saved for them: the auth routes allow
 * 100 POSTs per IP per 15 minutes, and a form sign-in per test spent 99 of them. Falls back to the
 * form when no saved session exists or the server no longer knows it. Pass `fresh: true` when the
 * test signs out (sign-out deletes its session, and the shared one must outlive the test) or relies
 * on what a form sign-in does (focus on the panel heading).
 */
export async function signIn(
  page: Page,
  user = e2eUser(),
  { fresh = false }: { fresh?: boolean } = {},
): Promise<void> {
  if (fresh) return signInWithForm(page, user);
  const cookies = savedCookies(user.email);
  if (cookies.length > 0) await page.context().addCookies(cookies);
  await page.goto("/");
  const signInHeading = page.getByRole("heading", { name: "Sign in" });
  const appHeading = page.getByRole("heading", { name: "Query Module", exact: true });
  await expect(signInHeading.or(appHeading)).toBeVisible();
  if (await signInHeading.isVisible()) {
    // Each fallback spends an auth POST; say so, or the suite drifts back toward the limit.
    test.info().annotations.push({
      type: "warning",
      description: `No live saved session for ${user.email}: signed in with the form`,
    });
    await fillSignIn(page, user);
    return;
  }
  await expect(signInHeading).toBeHidden();
  await expect(appHeading).toBeVisible();
}

function savedCookies(email: string): StorageState["cookies"] {
  try {
    return (JSON.parse(readFileSync(authStatePath(email), "utf8")) as StorageState).cookies;
  } catch {
    return [];
  }
}

const THEME_LABELS = {
  auto: "Match system",
  day: "Day",
  night: "Night",
  redShift: "Red shift",
} as const;

/** Opens the header's account disclosure if it is closed; returns its panel. */
export async function openAccountMenu(page: Page) {
  const button = page.getByRole("banner").locator(".qm-account__button");
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  const panel = page.getByRole("group", { name: "Account" });
  await expect(panel).toBeVisible();
  return panel;
}

/** Signs out through the header: the account disclosure holds the button on both bars. Call it once the panel has rendered (the persona layout
 *  can still flip from dispatch to compact while the config loads). */
export async function signOutFromHeader(page: Page): Promise<void> {
  await openAccountMenu(page);
  await page.getByRole("button", { name: "Sign out" }).click();
}

/**
 * Chooses a theme mode wherever the page offers it: the select on the login page, the icon buttons
 * in the officer's compact bar, or the segmented control in the dispatcher's account disclosure
 * (closed again afterwards, so it never covers the page).
 */
export async function chooseTheme(page: Page, mode: keyof typeof THEME_LABELS): Promise<void> {
  const select = page.getByRole("combobox", { name: "Theme" });
  const account = page.getByRole("banner").locator(".qm-account__button");
  // Wait for whichever the page renders; the count alone would race the render.
  await select.or(account).first().waitFor();
  if ((await select.count()) > 0) {
    await select.selectOption(mode);
    return;
  }
  // The officer's compact bar carries the theme as icon buttons of its own.
  const barTheme = page.getByRole("banner").getByRole("group", { name: "Theme" });
  if ((await barTheme.count()) > 0) {
    await barTheme.getByRole("button", { name: THEME_LABELS[mode], exact: true }).click();
    return;
  }
  const panel = await openAccountMenu(page);
  await panel
    .getByRole("group", { name: "Theme" })
    .getByRole("button", { name: THEME_LABELS[mode], exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}

/** "#rrggbb" or the short "#rgb" a minified production stylesheet emits (for example #fff). */
export function hexToRgb(hex: string): string {
  const h = hex.trim().slice(1);
  const n = Number.parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const readJson = (relative: string): Record<string, string> =>
  JSON.parse(readFileSync(fileURLToPath(new NodeURL(relative, import.meta.url)), "utf8"));

/** The shipped English bundle, and the e2e-only site's overlay of it (e2e/sites/boolean-form.en.json). */
const SHIPPED_EN = readJson("../../../packages/config/locales/en.json");
const E2E_SITE_EN = readJson("./sites/boolean-form.en.json");

/** Button and option text of a query type: its `queryType.<code>` key in the bundle the page loads. */
function typeLabel(code: string): string | undefined {
  const key = `queryType.${code}`;
  return E2E_SITE_EN[key] ?? SHIPPED_EN[key];
}

/**
 * Picks a query type by keyboard (ADR-0010): Enter on its quick-access button, else the "Other
 * query types" select. Waits for the quick-access bar first: keys sent before the panel renders
 * reach no handler.
 */
export async function chooseQueryType(page: Page, code: string): Promise<void> {
  const label = typeLabel(code);
  if (label === undefined) throw new Error(`No label known for query type ${code}`);
  const nav = page.getByRole("group", { name: "Quick access" });
  await expect(nav).toBeVisible();
  const button = nav.getByRole("button", { name: label, exact: true });
  if ((await button.count()) > 0) {
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    return;
  }
  const select = page.getByLabel("Other query types");
  await select.focus();
  await page.keyboard.type(label);
  await expect(select).toHaveValue(code);
}

/**
 * Fetches the live response behind a mocked route and fails loudly on a non-2xx, so a 401 from the
 * live server never hides behind a mock that fulfils 200 (#319). Fulfil with `{ response, json }`.
 */
export async function liveResponse(route: Route): Promise<APIResponse> {
  const response = await route.fetch();
  if (!response.ok())
    throw new Error(`live ${route.request().url()} answered ${response.status()}`);
  return response;
}

/**
 * The short reference of a correlation ID as the app shows it: the last eight characters, the random
 * part of a UUIDv7 (SEC-014). Mirrors `shortReference` in `@querymodule/web-ui`; the e2e project cannot
 * import that package, whose barrel holds .tsx files and this project sets no `jsx`.
 */
export function shortReference(correlationId: string): string {
  return correlationId.slice(-8);
}

/**
 * The officer's action bar (developer ruling 10-14-26): Run query and Clear are the same size and
 * split the bar's content width between them on one row, with the status line on its own line
 * below. Numbers, not a picture: heights and widths agree (within 1 px of layout rounding), the two
 * plus the bar's gap fill the content width (within 2 px), nothing clips or leaves the viewport,
 * and both stay at `minTarget` or more.
 */
export async function expectEvenActionBar(page: Page, minTarget: number): Promise<void> {
  const bar = await page.evaluate(() => {
    const el = document.querySelector("main .qm-action-bar");
    if (el === null) return null;
    const style = getComputedStyle(el);
    const content =
      el.getBoundingClientRect().width -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight) -
      Number.parseFloat(style.borderLeftWidth) -
      Number.parseFloat(style.borderRightWidth);
    const measure = (b: Element | null) => {
      if (b === null) return null;
      const box = b.getBoundingClientRect();
      return {
        top: Math.round(box.top),
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        fontSize: getComputedStyle(b).fontSize,
        clipped: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1,
      };
    };
    const buttons = [...el.querySelectorAll(":scope > button")];
    const status = el.querySelector(".qm-action-bar__status");
    return {
      content,
      gap: Number.parseFloat(style.columnGap),
      viewport: innerWidth,
      run: measure(buttons.find((b) => b.getAttribute("type") === "submit") ?? null),
      clear: measure(buttons.find((b) => b.getAttribute("type") !== "submit") ?? null),
      statusTop: status === null ? null : Math.round(status.getBoundingClientRect().top),
      statusVisible: status !== null && getComputedStyle(status).display !== "none",
    };
  });
  expect(bar, "the action bar is on the page").not.toBeNull();
  const { run, clear } = bar ?? {};
  expect(run, "Run query is in the action bar").toBeTruthy();
  expect(clear, "Clear is in the action bar").toBeTruthy();
  if (!run || !clear || bar === null) return;
  expect(clear.top, "Clear and Run share a row").toBe(run.top);
  expect(Math.abs(clear.height - run.height), "Clear is as tall as Run").toBeLessThanOrEqual(1);
  expect(Math.abs(clear.width - run.width), "Clear is as wide as Run").toBeLessThanOrEqual(1);
  expect(clear.fontSize, "Clear has Run's font size").toBe(run.fontSize);
  expect(
    Math.abs(run.width + clear.width + bar.gap - bar.content),
    "Run and Clear together span the bar's content width",
  ).toBeLessThanOrEqual(2);
  expect(Math.round(run.height), "Run height").toBeGreaterThanOrEqual(minTarget);
  expect(Math.round(clear.height), "Clear height").toBeGreaterThanOrEqual(minTarget);
  expect(run.clipped || clear.clipped, "a button's text is clipped").toBe(false);
  expect(Math.min(run.left, clear.left), "left edge on the page").toBeGreaterThanOrEqual(0);
  expect(Math.max(run.right, clear.right), "right edge on the page").toBeLessThanOrEqual(
    bar.viewport + 1,
  );
  if (bar.statusVisible && bar.statusTop !== null)
    expect(bar.statusTop, "the status line is on its own line, below the buttons").toBeGreaterThan(
      run.top,
    );
}
