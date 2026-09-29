import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

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
    const response = await route.fetch();
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
  await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
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
