import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// #410, WM1 carry forward: the live site document's quick access is the shipped default's. Specs
// that publish (admin-config) restore the shipped config; one that did not would leave the
// dispatcher's buttons and select out of step with default.json, and show up here first.
test("[#410] the live config's quick access is the shipped default's", async ({ page }) => {
  await signIn(page, seededUser("admin@example.test"));
  const response = await page.request.get("/api/v1/admin/config");
  expect(response.ok(), `admin config answered ${response.status()}`).toBe(true);
  const { live } = (await response.json()) as {
    live: { document: { siteConfig: { quickAccess: string[] } } };
  };
  const shipped = JSON.parse(
    readFileSync(
      fileURLToPath(new NodeURL("../../../packages/config/sites/default.json", import.meta.url)),
      "utf8",
    ),
  ) as { quickAccess: string[] };
  expect(live.document.siteConfig.quickAccess).toEqual(shipped.quickAccess);
});
