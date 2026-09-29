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
