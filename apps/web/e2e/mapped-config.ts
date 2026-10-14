import type { Page } from "@playwright/test";
import { liveResponse } from "./helpers.js";

/** One response mapping as the client config carries it (the shape is the core schema's). */
export type ClientMapping = Record<string, unknown> & { id: string; queryType: string };

/**
 * Serves the live client config with its response mappings rewritten, and the English bundle with
 * extra labels, the way boolean-form.spec.ts serves its site (#309): the live `configHash` stays, so
 * submits still pass the server's hash check, and the shipped `default.json` is never edited. Cards
 * map in the browser, so the rewritten mappings are all a card spec needs. Call before `signIn`.
 */
export async function serveMappings(
  page: Page,
  rewrite: (mappings: ClientMapping[]) => ClientMapping[],
  labels: Record<string, string> = {},
): Promise<void> {
  await page.route("**/api/v1/config", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const live = (await (await liveResponse(route)).json()) as {
      responseMappings: ClientMapping[];
    };
    return route.fulfill({
      json: { ...live, responseMappings: rewrite(live.responseMappings) },
    });
  });
  if (Object.keys(labels).length === 0) return;
  await page.route("**/api/v1/locales/en", async (route) => {
    const live = (await (await liveResponse(route)).json()) as Record<string, string>;
    return route.fulfill({ json: { ...live, ...labels } });
  });
}
