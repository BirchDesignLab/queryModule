import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures.js";

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

/** Enters at "/" only; the app routes client-side to /login (spec 5.1 lists "/" as a web route). */
export async function signIn(page: Page, user = e2eUser()): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signed-in only: the login panel is gone. Exact name: the login h1 "Query Module 2.0" would
  // match a substring locator before the session exists (#328 CI).
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Query Module", exact: true })).toBeVisible();
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

/** Signs out through the header: the account disclosure holds the button on the dispatch bar, the
 *  officer's compact bar keeps it inline. Call it once the panel has rendered (the persona layout
 *  can still flip from dispatch to compact while the config loads). */
export async function signOutFromHeader(page: Page): Promise<void> {
  if ((await page.getByRole("banner").locator(".qm-account__button").count()) > 0)
    await openAccountMenu(page);
  await page.getByRole("button", { name: "Sign out" }).click();
}

/**
 * Chooses a theme mode wherever the page offers it: the select on the login page and on the
 * officer's compact bar, or the segmented control in the dispatcher's account disclosure (closed
 * again afterwards, so it never covers the page).
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

/** Button and option text of each query type in the shipped English bundle and the e2e sites. */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  VEH: "Vehicle",
  PER: "Person",
  PRO: "Property",
  WNT: "Wanted check",
  CHK: "Checkbox check",
};

/**
 * Picks a query type by keyboard (ADR-0010): Enter on its quick-access button, else the "Other
 * query types" select. Waits for the quick-access bar first: keys sent before the panel renders
 * reach no handler.
 */
export async function chooseQueryType(page: Page, code: string): Promise<void> {
  const label = TYPE_LABELS[code];
  if (label === undefined) throw new Error(`No label known for query type ${code}`);
  const nav = page.getByRole("navigation", { name: "Quick access" });
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
