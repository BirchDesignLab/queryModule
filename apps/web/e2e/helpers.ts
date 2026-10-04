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
