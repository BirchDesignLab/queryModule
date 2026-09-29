import { evaluateForm } from "@querymodule/core/rules";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

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

  const select = page.getByLabel("Query type");
  await expect(select).toBeVisible();
  const optionLabels = await select.locator("option").allTextContents();
  expect(optionLabels).toEqual(config.queryTypes.map((q) => label(q.labelKey)));

  await select.selectOption("VEH");
  const expected = evaluateForm(
    // biome-ignore lint/suspicious/noExplicitAny: the live payload is the RulesConfig evaluateForm takes; the test compares the two.
    config as any,
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
