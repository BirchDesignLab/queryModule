import { restoreShippedConfig } from "./admin-draft.js";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseQueryType, liveResponse, seededUser, signIn } from "./helpers.js";

// ADR-0011 item 3 (#361): an open form follows a newer config within 15 s. The server keeps one
// config here, so the "published" one is the same body with a new hash and one more field.
const NEW_HASH = "b".repeat(64);

test("[#361] the open form picks up a newer config: new field, one polite announcement, focus and value kept", async ({
  page,
}) => {
  let published = false;
  const background: (string | undefined)[] = [];
  await page.route("**/api/v1/config", async (route) => {
    background.push(route.request().headers()["x-background"]);
    const response = await liveResponse(route);
    const body = (await response.json()) as {
      configHash: string;
      queryTypes: { code: string; fields: { key: string; labelKey?: string }[] }[];
    };
    if (published) {
      body.configHash = NEW_HASH;
      for (const type of body.queryTypes) {
        if (type.code !== "VEH") continue;
        const vin = type.fields.find((f) => f.key === "vin");
        if (vin !== undefined)
          type.fields.push({ ...vin, key: "zzAgency", labelKey: "field.agency" });
      }
    }
    await route.fulfill({ response, json: body });
  });
  await page.clock.install();
  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  const plate = page.getByLabel("Plate", { exact: true });
  await plate.focus();
  await page.keyboard.type("ZZ-0001");
  await expect(page.getByLabel("Agency")).toHaveCount(0);

  published = true;
  await page.clock.fastForward(16_000);

  await expect(page.getByLabel("Agency")).toBeVisible();
  await expect(page.getByTestId("announcer-polite")).toHaveText(
    "The form was updated by your administrator.",
  );
  await expect(plate).toBeFocused();
  await expect(plate).toHaveValue("ZZ-0001");
  // The refresh request is marked as background; the first load is not.
  expect(background[0]).toBeUndefined();
  expect(background.slice(1).every((h) => h === "1")).toBe(true);
  await expectNoSeriousAxeViolations(page);
});

// #382 T18-4: a newer config that removes the focused field hands focus to the panel heading
// (never <body>, never another field); the polite update message stays the only announcement.
for (const persona of [
  { name: "dispatcher", email: undefined },
  { name: "officer", email: "officer@example.test" },
] as const) {
  test(`[#382 T18-4] ${persona.name}: a removed focused field moves focus to the panel heading`, async ({
    page,
  }) => {
    let stage: "extra" | "removed" = "extra";
    let hash = "c".repeat(64);
    await page.route("**/api/v1/config", async (route) => {
      const response = await liveResponse(route);
      const body = (await response.json()) as {
        configHash: string;
        queryTypes: { code: string; fields: { key: string; labelKey?: string }[] }[];
      };
      body.configHash = hash;
      if (stage === "extra") {
        for (const type of body.queryTypes) {
          if (type.code !== "VEH") continue;
          const vin = type.fields.find((f) => f.key === "vin");
          if (vin !== undefined)
            type.fields.push({ ...vin, key: "zzAgency", labelKey: "field.agency" });
        }
      }
      await route.fulfill({ response, json: body });
    });
    await page.clock.install();
    await signIn(page, persona.email === undefined ? undefined : seededUser(persona.email));
    const agency = page.getByLabel("Agency");
    await agency.focus();
    await page.keyboard.type("ZZ");
    await expect(agency).toBeFocused();

    stage = "removed";
    hash = "d".repeat(64);
    await page.clock.fastForward(16_000);

    await expect(agency).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Query Module", exact: true })).toBeFocused();
    await expect(page.getByTestId("announcer-polite")).toHaveText(
      "The form was updated by your administrator.",
    );
    await expectNoSeriousAxeViolations(page);
  });
}

// #46 CFG-1 (D-M2P3-5): a label-only publish keeps configHash (CFG-3) and changes the published
// versionId. An open dispatcher tab swaps the label within the refresh bound, with no reload, no
// "form was updated" announcement, no focus move and the typed value kept; the new text is held in
// memory only, never in storage (spec 6.7). A real publish from the builder; the shipped config is
// put back afterwards for the specs that follow.
test.describe("[#46 CFG-1] a label-only publish reaches an open tab", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });
  test.afterEach(async ({ browser }) => {
    await restoreShippedConfig(browser);
  });

  test("the open form shows the new label; value, focus and draft kept; nothing announced or stored", async ({
    browser,
    page,
  }) => {
    const dispatcherContext = await browser.newContext();
    try {
      const dispatcher = await dispatcherContext.newPage();
      await dispatcher.clock.install();
      await signIn(dispatcher, seededUser("dispatcher@example.test"));
      await chooseQueryType(dispatcher, "VEH");
      const before = (await (await dispatcher.request.get("/api/v1/config")).json()) as {
        configHash: string;
        versionId: string;
      };
      const plate = dispatcher.getByLabel("Plate", { exact: true });
      await plate.focus();
      await dispatcher.keyboard.type("ZZ-0046");
      await dispatcher.evaluate(() => {
        (window as unknown as { __qmOpenSince: number }).__qmOpenSince = Date.now();
      });
      // Read before the admin acts, so an announcement from an early poll cannot hide in it.
      const polite = dispatcher.getByTestId("announcer-polite");
      const politeBefore = await polite.textContent();

      // The admin changes one label in the builder and publishes it.
      await signIn(page, seededUser("admin@example.test"));
      await page.getByRole("link", { name: "Admin" }).press("Enter");
      await page.getByRole("link", { name: "Site configuration" }).press("Enter");
      await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
      await page
        .getByRole("navigation", { name: "Configuration items" })
        .getByRole("treeitem", { name: /^Labels and translations/ })
        .press("Enter");
      const sect = page.locator(".qm-sect", {
        has: page.getByRole("heading", { name: "Texts for en" }),
      });
      await sect.getByLabel("Label key", { exact: true }).fill("field.plate");
      await sect.getByLabel("Text", { exact: true }).fill("Plate number");
      await sect.getByRole("button", { name: "Add English label" }).press("Enter");
      await page.getByRole("button", { name: "Review and publish" }).press("Enter");
      const dialog = page.getByRole("dialog", { name: /^Publish version \d+$/ });
      const confirm = dialog.getByRole("button", { name: /^Publish version \d+$/ });
      const version = Number(/\d+/.exec(await confirm.innerText())?.[0]);
      await confirm.press("Enter");
      await expect(page.getByText(`Published version ${version}.`).first()).toBeVisible();

      const after = (await (await dispatcher.request.get("/api/v1/config")).json()) as {
        configHash: string;
        versionId: string;
      };
      expect(after.configHash).toBe(before.configHash);
      expect(after.versionId).not.toBe(before.versionId);

      await dispatcher.clock.fastForward(16_000);
      const relabeled = dispatcher.getByLabel("Plate number", { exact: true });
      await expect(relabeled).toBeVisible();
      await expect(relabeled).toHaveValue("ZZ-0046");
      await expect(relabeled).toBeFocused();
      // Same configHash: no 409 path and no "form was updated" message.
      await expect(polite).toHaveText(politeBefore ?? "");
      expect(
        await dispatcher.evaluate(
          () => (window as unknown as { __qmOpenSince?: number }).__qmOpenSince !== undefined,
        ),
        "the dispatcher's page was never reloaded",
      ).toBe(true);
      const stored = await dispatcher.evaluate(() =>
        [localStorage, sessionStorage]
          .flatMap((store) => Object.keys(store).map((k) => store.getItem(k) ?? ""))
          .join("\n"),
      );
      expect(stored).not.toContain("Plate number");
      await expectNoSeriousAxeViolations(dispatcher);
    } finally {
      await dispatcherContext.close();
    }
  });
});
