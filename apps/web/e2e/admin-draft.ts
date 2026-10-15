import type { Browser, Page } from "@playwright/test";
import { expect } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Shared by the admin specs that need a saved draft with changes in it: the demo dry-run gap shots
// (admin-gap-shots.spec.ts) and the builder layout checks (admin-builder-layout.spec.ts). The draft
// is saved through the API, so a spec does not have to click through the builder to get one.

const ADMIN = seededUser("admin@example.test");

interface Versions {
  versions: { version: number; status: string }[];
}

/** Puts the first version back as live and the live document back as the saved draft. */
export async function restoreShippedConfig(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, ADMIN);
    const origin = new URL(page.url()).origin;
    const headers = { "X-Requested-With": "querymodule", Origin: origin };
    const list = await context.request.get(`${origin}/api/v1/admin/config/versions`);
    const { versions } = (await list.json()) as Versions;
    const first = Math.min(...versions.map((v) => v.version));
    const live = versions.find((v) => v.status === "published");
    if (live !== undefined && live.version !== first)
      await context.request.post(`${origin}/api/v1/admin/config/versions/${first}/rollback`, {
        headers,
      });
    const now = (await (await context.request.get(`${origin}/api/v1/admin/config`)).json()) as {
      live: { version: number; document: unknown };
    };
    await context.request.put(`${origin}/api/v1/admin/config/draft`, {
      headers,
      data: { baseVersion: now.live.version, document: now.live.document },
    });
  } finally {
    await context.close();
  }
}

/** Saves the draft the gap specs need, through the API: TESTMAKE as a warning keyword, Make on the summary. */
export async function saveGapDraft(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  const headers = { "X-Requested-With": "querymodule", Origin: origin };
  const body = (await (await page.request.get(`${origin}/api/v1/admin/config`)).json()) as {
    live: { version: number; document: { siteConfig: Record<string, unknown> } };
  };
  const document = structuredClone(body.live.document);
  const site = document.siteConfig as {
    keywords: unknown[];
    responseMappings: { id: string; elements: { path: string; view: string }[] }[];
  };
  site.keywords.push({ keyword: "TESTMAKE", severity: "warning" });
  const make = site.responseMappings
    .find((m) => m.id === "veh-summary")
    ?.elements.find((e) => e.path === "vehicle.make");
  if (make !== undefined) make.view = "summary";
  // A second Vehicle card, for the National system: the Which card wins table has two cards.
  (site.responseMappings as unknown[]).push({
    id: "veh-card",
    queryType: "VEH",
    sourceId: "nationalSource",
    elements: [{ kind: "value", path: "status", labelKey: "mapping.status", view: "both" }],
  });
  const put = await page.request.put(`${origin}/api/v1/admin/config/draft`, {
    headers,
    data: { baseVersion: body.live.version, document },
  });
  expect(put.ok(), `draft saved: ${put.status()}`).toBe(true);
}
