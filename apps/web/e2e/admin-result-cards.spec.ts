import type { Locator, Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Task 13 (#605; FR-060, UX-010, UX-015; spec 10.2): result cards configured and published from the
// builder, end to end. An admin adds a summary row `vehicle.make` to the Vehicle card and a warning
// keyword TESTMAKE, previews it on typed ZZ-0001, reviews and publishes. A dispatcher tab that was
// already open shows the new row on the card already on screen (a re-map, no reload) and on the next
// ZZ-0001 result, with the keyword marked in words and a marker; rollback puts the old card back.
// The other scenarios measure and scan what the earlier tasks left to this spec: axe on the cards
// editor with its preview, the Which card wins table, the keywords pane and Try a match; control
// heights; where focus goes when a control is removed or an edit is undone; and Try a match on the
// STOLEN scenario. Synthetic data only: ZZ-####, and the mock's own synthetic records.
//
// The tests share one server and one live config, so they run in order and the last step puts the
// first version back and clears the saved draft (the other specs expect the shipped config).

const ADMIN = seededUser("admin@example.test");
const DISPATCHER = seededUser("dispatcher@example.test");
/** The refresh bound (15 s) and a margin for the poll's own request. */
const BOUND = 20_000;

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ viewport: { width: 1600, height: 1000 }, emptyQueryList: true });

interface Versions {
  versions: { version: number; status: string }[];
}

test.afterAll(async ({ browser }) => {
  // Whatever happened above, the shipped config is live again and no draft of ours is left saved.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, ADMIN);
    const origin = new URL(page.url()).origin;
    const headers = { "X-Requested-With": "querymodule", Origin: origin };
    const list = await context.request.get(`${origin}/api/v1/admin/config/versions`);
    expect(list.ok(), `versions list answered ${list.status()}`).toBe(true);
    const { versions } = (await list.json()) as Versions;
    expect(versions.length).toBeGreaterThan(0);
    const first = Math.min(...versions.map((v) => v.version));
    const live = versions.find((v) => v.status === "published");
    if (live !== undefined && live.version !== first) {
      const back = await context.request.post(
        `${origin}/api/v1/admin/config/versions/${first}/rollback`,
        { headers },
      );
      expect(back.ok(), `rollback to version ${first}: ${await back.text()}`).toBe(true);
    }
    // A saved draft stays on the server (Review saves it): put the live document back as the draft.
    const now = (await (await context.request.get(`${origin}/api/v1/admin/config`)).json()) as {
      live: { version: number; document: unknown };
    };
    const saved = await context.request.put(`${origin}/api/v1/admin/config/draft`, {
      headers,
      data: { baseVersion: now.live.version, document: now.live.document },
    });
    expect(saved.ok(), `draft reset: ${await saved.text()}`).toBe(true);
  } finally {
    await context.close();
  }
});

/** The admin opens the builder from the header by keyboard, as a real admin would. */
async function openBuilder(page: Page): Promise<number> {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Admin" }).press("Enter");
  await page.getByRole("link", { name: "Site configuration" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Site configuration", level: 2 })).toBeVisible();
  const status = page.getByTestId("draft-status");
  await expect(status).toContainText("Draft, based on version");
  return Number(/version (\d+)/.exec(await status.innerText())?.[1]);
}

const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });
const editor = (page: Page) => page.getByTestId("form-tab");
const preview = (page: Page) => page.getByRole("region", { name: "Card preview" });

/** Selects a tree row by keyboard (focus the row, press Enter). */
async function selectRow(page: Page, name: RegExp): Promise<Locator> {
  const item = tree(page).getByRole("treeitem", { name }).first();
  await expect(item).toBeVisible();
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(item).toHaveAttribute("aria-selected", "true");
  return item;
}

const VEHICLE_CARD = /^1\. All results veh-summary/;

/** The Vehicle query type's first card: its row opens by keyboard (Right), then the card is selected. */
async function selectVehicleCard(page: Page): Promise<void> {
  const type = await selectRow(page, /^Vehicle cards/);
  const card = tree(page).getByRole("treeitem", { name: VEHICLE_CARD });
  if ((await card.count()) === 0) {
    await type.focus();
    await page.keyboard.press("ArrowRight");
  }
  await selectRow(page, VEHICLE_CARD);
}

/** Review and publish by keyboard; returns the version that went live and the dialog's text. */
async function publish(page: Page): Promise<{ version: number; review: string }> {
  await page.getByRole("button", { name: "Review and publish" }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Review and publish" });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: /^Publish version \d+$/ });
  await expectNoSeriousAxeViolations(page);
  const review = await dialog.innerText();
  const version = Number(/\d+/.exec(await confirm.innerText())?.[0]);
  await confirm.press("Enter");
  await expect(page.getByText(`Published version ${version}.`).first()).toBeVisible();
  return { version, review };
}

/** A dispatcher query: the year makes it a full query, so both sources answer. */
async function runPlate(page: Page, plate: string): Promise<void> {
  await page.getByLabel("Year", { exact: true }).fill("26");
  const field = page.getByLabel("Plate", { exact: true });
  await field.fill(plate);
  await field.press("Enter");
}

const stateCards = (page: Page) => page.getByRole("region", { name: "State system: returned" });
/** A summary or detail item of a card, by its label. */
const itemOf = (card: Locator, label: string) =>
  card
    .locator(".qm-result-list__item")
    .filter({ has: card.page().getByText(label, { exact: true }) });

/** The summary item that holds the keyword TESTMAKE as a mark (the detail rows are closed). */
const markedRow = (card: Locator) =>
  card
    .locator(".qm-result-list__item")
    .filter({ has: card.page().locator("mark", { hasText: "TESTMAKE" }) });

test("[#605] the admin adds a card row and a warning keyword, previews, publishes; the open dispatcher tab re-maps and shows the next result; rollback restores the old card", async ({
  page: dispatcher,
  browser,
}) => {
  // The dispatcher tab, open before anything is published; it is not reloaded until the label check.
  await signIn(dispatcher, DISPATCHER);
  await expect(dispatcher.getByRole("group", { name: "Quick access" })).toBeVisible();
  await dispatcher.evaluate(() => {
    (window as unknown as { __qmOpenSince: number }).__qmOpenSince = Date.now();
  });
  await runPlate(dispatcher, "ZZ-0001");
  const onScreen = stateCards(dispatcher);
  await expect(onScreen).toHaveCount(1, { timeout: 8000 });
  const rowsBefore = await onScreen.locator(".qm-result-list__item").count();
  await expect(itemOf(onScreen, "Vehicle make")).toHaveCount(0);
  await expect(onScreen.locator("mark", { hasText: "TESTMAKE" })).toHaveCount(0);

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const admin = await context.newPage();
    const base = await openBuilder(admin);

    // The Vehicle card: add a row by keyboard. The new row opens on its path.
    await selectVehicleCard(admin);
    const form = editor(admin);
    await expect(
      form.getByRole("heading", { level: 3, name: /^Vehicle: All results/ }),
    ).toBeVisible();
    await form.getByRole("button", { name: "Add row" }).press("Enter");
    const path = form.getByRole("combobox", { name: "Path" });
    await expect(path).toBeFocused();
    await admin.keyboard.type("vehicle.make");
    await expect(path).toHaveValue("vehicle.make");
    // A path the mock answers have: no "no mock answer" warning.
    await expect(form.getByText(/No mock answer has this path/)).toHaveCount(0);
    const label = form.getByLabel("Label shown to users");
    await label.fill("Vehicle make");
    await expect(admin.getByTestId("draft-summary")).toContainText(/Draft checks: 0 errors/);

    // A warning keyword by keyboard: the new keyword box keeps focus for the next one.
    await selectRow(admin, /^Keywords and severity/);
    const word = form.getByRole("textbox", { name: "New keyword" });
    await word.focus();
    await admin.keyboard.type("TESTMAKE");
    await admin.keyboard.press("Enter");
    await expect(word).toBeFocused();
    await expect(form.getByRole("textbox", { name: "Keyword 7", exact: true })).toHaveValue(
      "TESTMAKE",
    );
    await expect(form.getByRole("combobox", { name: "Severity of keyword 7" })).toHaveValue(
      "warning",
    );
    await expect(admin.getByTestId("draft-summary")).toContainText(/Draft checks: 0 errors/);

    // Preview on typed ZZ-0001: the production card, the new row and the keyword marked.
    await selectVehicleCard(admin);
    const pane = preview(admin);
    await expect(pane).toBeVisible();
    await pane.getByRole("radio", { name: "Type values" }).press("Space");
    await expect(pane.getByRole("radio", { name: "Type values" })).toBeChecked();
    const typed = pane.getByLabel("Plate", { exact: true });
    await typed.focus();
    await admin.keyboard.type("ZZ-0001");
    const previewCard = pane.getByRole("region", { name: "State system: returned" });
    await expect(previewCard).toBeVisible();
    const made = itemOf(previewCard, "Vehicle make");
    await expect(made.locator("dd")).toContainText("TESTMAKE");
    await expect(made.locator("mark", { hasText: "TESTMAKE" })).toContainText("(warning)");
    await expect(
      pane.getByText(/Card used: All results \(veh-summary\)\. This card\./),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(admin);

    // Review lists the change as configuration, never a typed or payload value; publish.
    const { version, review } = await publish(admin);
    expect(version).toBeGreaterThan(base);
    expect(review).toContain("Result cards");
    expect(review).not.toContain("ZZ-0001");
    expect(review).not.toContain("SAMPLEMODEL");
    expect(review).not.toContain("TESTERSON");

    // The dispatcher tab: the card already on screen is re-mapped within the refresh, no reload;
    // focus stays where the dispatcher had it. The row is found by its value: an open tab keeps the
    // locale bundle it loaded, so the new row's label text arrives with the next load (below).
    const plate = dispatcher.getByLabel("Plate", { exact: true });
    await plate.focus();
    await expect(markedRow(onScreen)).toHaveCount(1, { timeout: BOUND });
    await expect(onScreen.locator(".qm-result-list__item")).toHaveCount(rowsBefore + 1);
    await expect(markedRow(onScreen).locator("mark")).toContainText("(warning)");
    await expect(plate).toBeFocused();
    // The next ZZ-0001 result shows the same: two cards, both with the row and the mark.
    await runPlate(dispatcher, "ZZ-0001");
    await expect(stateCards(dispatcher)).toHaveCount(2, { timeout: 8000 });
    for (const card of await stateCards(dispatcher).all()) {
      await expect(markedRow(card)).toHaveCount(1);
    }
    expect(
      await dispatcher.evaluate(
        () => (window as unknown as { __qmOpenSince?: number }).__qmOpenSince,
      ),
    ).toBeGreaterThan(0);
    await expectNoSeriousAxeViolations(dispatcher);
    // A fresh load has the published label: the row reads "Vehicle make".
    await dispatcher.reload();
    await expect(dispatcher.getByRole("group", { name: "Quick access" })).toBeVisible();
    await runPlate(dispatcher, "ZZ-0001");
    await expect(stateCards(dispatcher)).toHaveCount(1, { timeout: 8000 });
    await expect(itemOf(stateCards(dispatcher), "Vehicle make")).toHaveCount(1);
    await expect(markedRow(stateCards(dispatcher)).locator("dt")).toHaveText("Vehicle make");

    // Rollback to the version the admin started from: the old card comes back, on the open tab too.
    await admin.getByRole("button", { name: "History" }).press("Enter");
    const drawer = admin.getByRole("region", { name: "Version history" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: `Roll back to version ${base}` }).press("Enter");
    const confirm = admin.getByRole("dialog", { name: `Roll back to version ${base}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: `Roll back to version ${base}` }).press("Enter");
    await expect(
      admin.getByText(/^Published version \d+ \(roll back of version/).first(),
    ).toBeVisible();
    const live = await admin
      .context()
      .request.get(`${new URL(admin.url()).origin}/api/v1/admin/config`);
    const body = (await live.json()) as {
      live: {
        document: {
          siteConfig: {
            keywords: { keyword: string }[];
            responseMappings: { id: string; elements: { path: string }[] }[];
          };
        };
      };
    };
    const veh = body.live.document.siteConfig.responseMappings.find((m) => m.id === "veh-summary");
    expect(veh?.elements.filter((e) => e.path === "vehicle.make")).toHaveLength(1);
    expect(body.live.document.siteConfig.keywords.map((k) => k.keyword)).not.toContain("TESTMAKE");
    await expect(markedRow(stateCards(dispatcher))).toHaveCount(0, { timeout: BOUND });
    await expect(stateCards(dispatcher).locator(".qm-result-list__item")).toHaveCount(rowsBefore);
    await expectNoSeriousAxeViolations(dispatcher);
  } finally {
    await context.close();
  }
});

const heightOf = async (locator: Locator): Promise<number> =>
  Math.round((await locator.boundingBox())?.height ?? 0);

/** The named controls shorter than `min` px, as "name: height" (an empty list passes). */
async function tooShort(min: number, controls: Record<string, Locator>): Promise<string[]> {
  const short: string[] = [];
  for (const [name, control] of Object.entries(controls)) {
    await expect(control, name).toBeVisible();
    const height = await heightOf(control);
    if (height < min) short.push(`${name}: ${height}`);
  }
  return short;
}

test("[#605] Try a match shows the STOLEN scenario for ZZ-0001, its controls are 36 px, and axe passes with it open", async ({
  page,
}) => {
  await openBuilder(page);
  await selectRow(page, /^Mock response: Vehicle, State system/);
  const pane = page.getByRole("region", { name: "Try a match" });
  await expect(pane).toBeVisible();
  // The selected response gives the starting source and query type.
  const source = pane.getByLabel("Source", { exact: true });
  const type = pane.getByLabel("Query type", { exact: true });
  await expect(source).toHaveValue("stateSource");
  await expect(type).toHaveValue("VEH");
  const plate = pane.getByLabel("Plate", { exact: true });
  await plate.focus();
  await page.keyboard.type("ZZ-0001");
  await expect(pane.getByText(/^Scenario 1 matches/)).toBeVisible();
  await expect(pane.getByText("Result: Returns a record")).toBeVisible();
  // The answer opens as the production Result card; the Payload view is one key press away.
  await expect(pane.getByRole("region", { name: "State system: returned" })).toBeVisible();
  const showCard = pane.getByRole("button", { name: "Result card" });
  const showPayload = pane.getByRole("button", { name: "Payload" });
  await showPayload.press("Enter");
  await expect(pane.getByTestId("try-payload")).toContainText('"status": "STOLEN"');
  await expect(pane.getByText("Answers after 50 to 400 ms.")).toBeVisible();
  // Typed values stay in the pane: they are in no link, and a plate with no scenario takes the default.
  expect(page.url()).not.toContain("ZZ-0001");
  await plate.fill("ZZ-0099");
  await expect(pane.getByText("No scenario matches: the default answers.")).toBeVisible();
  await plate.fill("ZZ-0001");
  await expect(pane.getByText(/^Scenario 1 matches/)).toBeVisible();

  // Desktop controls are 36 px or more.
  expect(
    await tooShort(36, { source, type, plate, "show card": showCard, "show payload": showPayload }),
  ).toEqual([]);
  await expectNoSeriousAxeViolations(page);
});

test("[#605] the cards editor with its preview, the Which card wins table and the keywords pane pass axe; controls are 36 px; the officer preview's Show detail is 48 px", async ({
  page,
}) => {
  await openBuilder(page);
  const form = editor(page);

  // The cards editor with the preview beside it and the Which card wins table.
  await selectVehicleCard(page);
  const wins = form.getByRole("table", { name: "Which card wins" });
  await expect(wins).toBeVisible();
  const pane = preview(page);
  await expect(pane).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  // The preview's own controls are dense controls too (36 px).
  expect(
    await tooShort(36, {
      "preview source": pane.getByLabel("Result from", { exact: true }),
      "preview scenario": pane.getByLabel("Scenario", { exact: true }),
    }),
  ).toEqual([]);
  await pane.getByRole("radio", { name: "Type values" }).press("Space");
  const typed = pane.getByLabel("Plate", { exact: true });
  await typed.focus();
  await page.keyboard.type("ZZ-0001");
  await expect(pane.getByRole("region", { name: "State system: returned" })).toBeVisible();
  expect(
    await tooShort(36, {
      "preview plate": typed,
    }),
  ).toEqual([]);
  await expectNoSeriousAxeViolations(page);

  // The keywords and severity pane.
  await selectRow(page, /^Keywords and severity/);
  await expect(
    form.getByRole("heading", { level: 3, name: /^Keywords and severity/ }),
  ).toBeVisible();
  await expect(pane).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  expect(
    await tooShort(36, {
      keyword: form.getByRole("textbox", { name: "Keyword 1", exact: true }),
      severity: form.getByRole("combobox", { name: "Severity of keyword 1" }),
      exception: form.getByRole("textbox", { name: "Exception 1 of keyword 1" }),
      "new exception": form.getByRole("textbox", { name: "New exception for keyword 1" }),
      "add exception": form.getByRole("button", { name: "Add exception to keyword 1" }),
      "remove exception": form.getByRole("button", { name: "Remove exception 1 of keyword 1" }),
      "remove keyword": form.getByRole("button", { name: /^Remove keyword/ }).first(),
      "new keyword": form.getByRole("textbox", { name: "New keyword" }),
      "new keyword severity": form.getByRole("combobox", { name: "Severity of the new keyword" }),
      "add keyword": form.getByRole("button", { name: "Add keyword" }),
    }),
  ).toEqual([]);

  // The officer's preview of the card: its Show detail toggle is a 48 px target at 1024x768.
  await page.setViewportSize({ width: 1024, height: 768 });
  await selectVehicleCard(page);
  await pane.getByRole("button", { name: "Officer" }).press("Enter");
  await expect(pane.getByRole("button", { name: "Officer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const detail = pane.getByRole("button", { name: / detail/ });
  await expect(detail).toBeVisible();
  expect(await heightOf(detail), "Show detail height").toBeGreaterThanOrEqual(48);
  await expectNoSeriousAxeViolations(page);
});

// BW3 polish (#642, item 5): the Which card wins table fits the editor pane at 1366 and 1024: neither
// the table's container, the editor's tab panel nor the page scrolls sideways, and every Why cell
// (the last column, with the score) is fully inside the pane. Nothing is left to scroll, so there is
// no hidden column for a keyboard user to miss.
for (const width of [1366, 1024] as const) {
  test(`[#642] the Which card wins table fits its pane with nothing scrolling sideways at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 768 });
    await openBuilder(page);
    await selectVehicleCard(page);
    const wins = editor(page).getByRole("table", { name: "Which card wins" });
    await expect(wins).toBeVisible();
    const fit = await wins.evaluate((table) => {
      const pane = table.closest('[role="tabpanel"]');
      if (!(pane instanceof HTMLElement)) throw new Error("the editor has no tab panel");
      const holder = table.parentElement as HTMLElement;
      const box = pane.getBoundingClientRect();
      const root = document.documentElement;
      const cells = [...table.querySelectorAll<HTMLElement>("tbody td:last-child")];
      return {
        tableOverflow: holder.scrollWidth - holder.clientWidth,
        paneOverflow: pane.scrollWidth - pane.clientWidth,
        pageOverflow: root.scrollWidth - root.clientWidth,
        cells: cells.length,
        cutOff: cells.filter((c) => {
          const r = c.getBoundingClientRect();
          return r.right > box.right + 0.5 || c.scrollWidth > c.clientWidth;
        }).length,
        whyText: cells.map((c) => c.innerText.trim()),
      };
    });
    expect(fit.tableOverflow, "the table container scrolls sideways").toBeLessThanOrEqual(0);
    expect(fit.paneOverflow, "the editor tab panel scrolls sideways").toBeLessThanOrEqual(0);
    expect(fit.pageOverflow, "page horizontal overflow").toBeLessThanOrEqual(0);
    expect(fit.cells).toBeGreaterThan(0);
    expect(fit.cutOff, "Why cells cut off by the pane").toBe(0);
    for (const text of fit.whyText) expect(text).toMatch(/^score \d+, /);
  });
}

test("[#605] removing a keyword, a row or a card by keyboard leaves focus on a sensible control, never the page", async ({
  page,
}) => {
  await openBuilder(page);
  const form = editor(page);
  const onBody = () => page.evaluate(() => document.activeElement === document.body);

  // A keyword: the last one goes, and focus moves to the keyword before it.
  await selectRow(page, /^Keywords and severity/);
  const word = form.getByRole("textbox", { name: "New keyword" });
  await word.focus();
  await page.keyboard.type("ZZTESTWORD");
  await page.keyboard.press("Enter");
  await expect(form.getByRole("textbox", { name: "Keyword 7", exact: true })).toHaveValue(
    "ZZTESTWORD",
  );
  await form.getByRole("button", { name: "Remove keyword ZZTESTWORD" }).press("Enter");
  await expect(form.getByRole("textbox", { name: "Keyword 7", exact: true })).toHaveCount(0);
  await expect(form.getByRole("textbox", { name: "Keyword 6", exact: true })).toBeFocused();

  // A row: the new last row goes, and focus moves to the Edit button of the row before it.
  await selectVehicleCard(page);
  const rows = form.locator('[data-role="toggle"]');
  const before = await rows.count();
  await form.getByRole("button", { name: "Add row" }).press("Enter");
  await expect(form.getByRole("combobox", { name: "Path" })).toBeFocused();
  await expect(rows).toHaveCount(before + 1);
  await form.getByRole("button", { name: /^Remove row New row/ }).press("Enter");
  await expect(rows).toHaveCount(before);
  await expect(rows.last()).toBeFocused();
  expect(await onBody()).toBe(false);

  // A card: the added card goes, and focus moves to the query type's cards heading.
  await form.getByRole("button", { name: "Add Vehicle card" }).first().press("Enter");
  await expect(form.getByRole("heading", { level: 3, name: /^Vehicle: / })).toBeFocused();
  await form.getByRole("button", { name: /^Remove card/ }).press("Enter");
  await expect(form.getByRole("heading", { level: 3, name: /^Vehicle cards/ })).toBeFocused();
  expect(await onBody()).toBe(false);
});

test("[#605] undoing an added scenario while a control inside it has focus moves focus to the selected tree row", async ({
  page,
}) => {
  await openBuilder(page);
  const row = await selectRow(page, /^Mock response: Vehicle, State system/);
  await page.getByRole("button", { name: "Add scenario" }).press("Enter");
  const added = page.getByRole("group", { name: "Scenario 4" });
  await expect(added).toBeVisible();
  const trigger = added.getByLabel("Trigger field 1", { exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+Z");
  await expect(added).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(row).toBeFocused();
});

test("[#605] a blank trigger beside a filled one warns and does not block Review and publish", async ({
  page,
}) => {
  await openBuilder(page);
  await selectRow(page, /^Mock response: Vehicle, State system/);
  await page.getByRole("button", { name: "Edit scenario 1" }).press("Enter");
  const card = page.getByRole("group", { name: "Scenario 1" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Add trigger field" }).press("Enter");
  await expect(card.getByText(/This blank value never matches/)).toBeVisible();
  // A warning, not an error: the draft still has no errors and Review opens its dialog.
  await expect(page.getByTestId("draft-summary")).toContainText(/Draft checks: 0 errors/);
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "Review and publish" }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Review and publish" });
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/Not published: \d+ errors? to fix first/)).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  // Close without publishing: the shipped config stays live.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
