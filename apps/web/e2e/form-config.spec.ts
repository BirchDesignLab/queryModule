import { evaluateForm } from "@querymodule/core/rules";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseQueryType, signIn } from "./helpers.js";

interface LiveConfig {
  queryTypes: { code: string; labelKey: string }[];
  [key: string]: unknown;
}

test("FR-002 FR-003 FR-011 the panel renders from the live GET /api/v1/config", async ({
  page,
}) => {
  await signIn(page);
  const configResponse = await page.request.get("/api/v1/config");
  expect(configResponse.ok()).toBe(true);
  const config = (await configResponse.json()) as LiveConfig;
  const bundle = (await (await page.request.get("/api/v1/locales/en")).json()) as Record<
    string,
    string
  >;
  const label = (key: string): string => bundle[key] ?? key;

  // ADR-0010: quick-access buttons plus the "Other query types" options cover the live types.
  const nav = page.getByRole("group", { name: "Quick access" });
  await expect(nav).toBeVisible();
  // Each button is its mono type code, then the label: read the label text node.
  const buttonLabels = await nav
    .getByRole("button")
    .evaluateAll((els) => els.map((el) => el.lastChild?.textContent ?? ""));
  const other = page.getByLabel("Other query types");
  const otherLabels =
    (await other.count()) === 0
      ? []
      : (await other.locator("option").allTextContents()).filter((l) => l !== "");
  expect([...buttonLabels, ...otherLabels].sort()).toEqual(
    config.queryTypes.map((q) => label(q.labelKey)).sort(),
  );

  await chooseQueryType(page, "VEH");
  const expected = evaluateForm(
    config as unknown as Parameters<typeof evaluateForm>[0],
    "VEH",
    {},
    { now: Date.now() },
  )
    .fields.filter((f) => f.visible)
    .map((f) => label(f.labelKey));
  expect(expected.length).toBeGreaterThan(0);
  const form = page.locator("form.qm-query-form");
  const shown = await form.locator("label.qm-field__label").evaluateAll((labels) =>
    labels.map((l) =>
      // The label text minus the visible mark and the hidden "required" text.
      (l.firstChild?.textContent ?? "").trim(),
    ),
  );
  expect(shown).toEqual(expected);
  await expectNoSeriousAxeViolations(page);
});
