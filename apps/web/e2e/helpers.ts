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
  await expect(page.getByRole("heading", { name: "Query Module" })).toBeVisible();
}

/** "#rrggbb" or the short "#rgb" a minified production stylesheet emits (for example #fff). */
export function hexToRgb(hex: string): string {
  const h = hex.trim().slice(1);
  const n = Number.parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
