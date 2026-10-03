import type { Locator, Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseQueryType, seededUser, signIn } from "./helpers.js";

// Task 35 (#362, BR-001, UX-004): the config half of the M1 exit demo. An admin changes the site
// config in the builder (keyboard only), sees the change in the builder's preview first, publishes
// it, and a dispatcher with the query panel already open sees it without a reload, within the
// refresh bound (ADR-0011 item 3, 15 s). Two browser contexts: the admin (the test's own page)
// and the dispatcher.
//
// The edits go through the Raw JSON tab (the purpose-built editors have their own RTL tests); the
// changed default goes through the form editor with the keyboard only, so that path is proven too.
// The tests share one server and one live config, so they run in order and the last step puts the
// first version back (the other specs expect the shipped config).

const ADMIN = seededUser("admin@example.test");
const DISPATCHER = seededUser("dispatcher@example.test");
/** The refresh bound (15 s) and a margin for the poll's own request. */
const BOUND = 20_000;

type Obj = Record<string, unknown>;
interface Doc {
  queryTypes: { code: string; fields: Obj[]; rules: Obj[] }[];
  picklists: { id: string; values: Obj[] }[];
  commands: Obj[];
  quickAccess: string[];
}

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ viewport: { width: 1600, height: 1000 } });

let dispatcherContext: Awaited<ReturnType<import("@playwright/test").Browser["newContext"]>>;
let dispatcher: Page;
/** The live version's number after each publish, in order; [0] is what the server started with. */
const published: number[] = [];

test.beforeAll(async ({ browser }) => {
  dispatcherContext = await browser.newContext();
  dispatcher = await dispatcherContext.newPage();
  await signIn(dispatcher, DISPATCHER);
  await expect(dispatcher.getByRole("group", { name: "Quick access" })).toBeVisible();
  // A marker a reload would erase: the dispatcher's page is never reloaded.
  await dispatcher.evaluate(() => {
    (window as unknown as { __qmOpenSince: number }).__qmOpenSince = Date.now();
  });
});

test.afterAll(async ({ browser }) => {
  await dispatcherContext?.close();
  // Whatever happened above, the shipped config is live again for the specs that follow.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, ADMIN);
    const origin = new URL(page.url()).origin;
    const headers = { "X-Requested-With": "querymodule", Origin: origin };
    const list = await context.request.get(`${origin}/api/v1/admin/config/versions`);
    const body = (await list.json()) as unknown;
    const versions = (Array.isArray(body) ? body : (body as { versions: unknown[] }).versions) as {
      version: number;
      status: string;
    }[];
    const first = Math.min(...versions.map((v) => v.version));
    const live = versions.find((v) => v.status === "published");
    if (live !== undefined && live.version !== first)
      await context.request.post(`${origin}/api/v1/admin/config/versions/${first}/rollback`, {
        headers,
      });
  } finally {
    await context.close();
  }
});

/** The admin opens the builder from the header by keyboard, as a real admin would. */
async function openBuilder(page: Page): Promise<void> {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Admin" }).press("Enter");
  await page.getByRole("link", { name: "Site configuration" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Site configuration", level: 2 })).toBeVisible();
  await expect(page.getByTestId("draft-status")).toContainText("Draft, based on version");
}

const tabs = (page: Page) => page.getByRole("tablist", { name: "Config editor views" });
const preview = (page: Page) => page.getByRole("region", { name: "Live preview" });

/** Edits the draft in the Raw JSON tab and returns to the Form tab, with the checks settled. */
async function editDraft(page: Page, mutate: (doc: Doc) => void): Promise<void> {
  await tabs(page).getByRole("tab", { name: "Form" }).focus();
  await page.keyboard.press("ArrowRight");
  const area = page.getByLabel("Draft JSON");
  await expect(area).toBeVisible();
  const doc = JSON.parse(await area.inputValue()) as Doc;
  mutate(doc);
  await area.fill(JSON.stringify(doc, null, 2));
  await expect(page.getByTestId("draft-summary")).toContainText(/Draft checks: 0 errors/);
  await tabs(page).getByRole("tab", { name: "Raw JSON" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs(page).getByRole("tab", { name: "Form" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** Selects a query type in the builder's tree by keyboard: the preview shows that type. */
async function selectInTree(page: Page, name: RegExp): Promise<void> {
  const item = page
    .getByRole("navigation", { name: "Configuration items" })
    .getByRole("treeitem", { name })
    .first();
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(item).toHaveAttribute("aria-selected", "true");
}

/** Review and publish by keyboard; returns the version that went live. */
async function publish(page: Page, scanDialog = false): Promise<number> {
  await page.getByRole("button", { name: "Review and publish" }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Review and publish" });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: /^Publish version \d+$/ });
  if (scanDialog) await expectNoSeriousAxeViolations(page);
  const version = Number(/\d+/.exec(await confirm.innerText())?.[0]);
  await confirm.press("Enter");
  await expect(page.getByText(`Published version ${version}.`).first()).toBeVisible();
  published.push(version);
  return version;
}

const dispatcherQuickAccess = () => dispatcher.getByRole("group", { name: "Quick access" });

/** The first publish, so the rollback step has a starting point to name. */
test("[#362] the shipped config is live: the dispatcher's panel is open", async ({ page }) => {
  await openBuilder(page);
  const status = (await page.getByTestId("draft-status").innerText()).match(/version (\d+)/);
  published.push(Number(status?.[1]));
  await expect(dispatcherQuickAccess().getByRole("button", { name: "Property" })).toBeVisible();
  await expectNoSeriousAxeViolations(dispatcher);
});

test("[#362] a new PRO field appears in its section", async ({ page }) => {
  await openBuilder(page);
  await editDraft(page, (doc) => {
    const pro = doc.queryTypes.find((q) => q.code === "PRO");
    pro?.fields.push({
      key: "tagSticker",
      labelKey: "field.tagSticker",
      dataType: "string",
      maxLength: 12,
      transform: "upper",
      section: "base",
    });
  });
  await selectInTree(page, /^Property/);
  // The builder's preview shows it first.
  await expect(
    preview(page).getByRole("group", { name: "Details" }).getByLabel("Tag sticker"),
  ).toBeVisible();
  await publish(page);

  await chooseQueryType(dispatcher, "PRO");
  await expect(
    dispatcher.getByRole("group", { name: "Details" }).getByLabel("Tag sticker"),
  ).toBeVisible({ timeout: BOUND });
  await expectNoSeriousAxeViolations(dispatcher);
});

test("[#362] a new rule makes a field required when its condition holds: required mark, blocked submit", async ({
  page,
}) => {
  await openBuilder(page);
  await editDraft(page, (doc) => {
    const per = doc.queryTypes.find((q) => q.code === "PER");
    per?.rules.push({
      field: "first",
      when: { field: "state", op: "eq", value: "OK" },
      effect: "require",
    });
  });
  await selectInTree(page, /^Person/);
  const inPreview = preview(page);
  await expect(inPreview.getByLabel("First name")).not.toHaveAttribute("aria-required", "true");
  await inPreview.getByLabel("State", { exact: true }).selectOption("OK");
  await expect(inPreview.getByLabel("First name")).toHaveAttribute("aria-required", "true");
  await publish(page);

  await chooseQueryType(dispatcher, "PER");
  const first = dispatcher.getByLabel("First name");
  const last = dispatcher.getByLabel("Last name");
  await expect(dispatcher.getByLabel("State", { exact: true })).toBeVisible();
  // Not yet required: this is the config the form had before the rule, or the one after with the
  // state still at its default; either way the rule needs State = OK.
  await dispatcher.getByLabel("State", { exact: true }).selectOption("OK");
  await expect(first).toHaveAttribute("aria-required", "true", { timeout: BOUND });
  await last.fill("ZZTEST");
  let sent = 0;
  await dispatcher.route("**/api/v1/queries", (route) => {
    sent += 1;
    return route.continue();
  });
  await last.focus();
  await dispatcher.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(first).toBeFocused();
  expect(sent, "a blocked submit sends nothing").toBe(0);
  await expectNoSeriousAxeViolations(dispatcher);
  await dispatcher.unroute("**/api/v1/queries");
  await dispatcher.getByRole("button", { name: "Clear" }).click();
});

test("[#362] a picklist value is added and one disabled", async ({ page }) => {
  await openBuilder(page);
  await editDraft(page, (doc) => {
    const sex = doc.picklists.find((p) => p.id === "sex");
    for (const v of sex?.values ?? []) if (v.code === "X") v.enabled = false;
    // Mock labels only: the shipped bundle's own "Unknown" text.
    sex?.values.push({ code: "U", labelKey: "picklist.race.U", enabled: true });
  });
  await selectInTree(page, /^Person/);
  const options = (select: Locator) => select.locator("option").allInnerTexts();
  await expect.poll(() => options(preview(page).getByLabel("Sex"))).toContain("Unknown");
  expect(await options(preview(page).getByLabel("Sex"))).not.toContain("Unspecified");
  await publish(page);

  await chooseQueryType(dispatcher, "PER");
  await expect
    .poll(() => options(dispatcher.getByLabel("Sex")), { timeout: BOUND })
    .toContain("Unknown");
  expect(await options(dispatcher.getByLabel("Sex"))).not.toContain("Unspecified");
  await expectNoSeriousAxeViolations(dispatcher);
});

test("[#362] a new type-role value in the subtype bar changes the required fields", async ({
  page,
}) => {
  await openBuilder(page);
  await editDraft(page, (doc) => {
    const type = doc.picklists.find((p) => p.id === "propertyType");
    for (const v of type?.values ?? []) if (v.code === "BOAT") v.enabled = false;
    // The Boat button now stands for the new WATERCRAFT code (the shipped "Boat" label).
    type?.values.push({
      code: "WATERCRAFT",
      labelKey: "picklist.propertyType.BOAT",
      enabled: true,
    });
    doc.queryTypes
      .find((q) => q.code === "PRO")
      ?.rules.push({
        field: "serial",
        when: { field: "propertyType", op: "eq", value: "WATERCRAFT" },
        effect: "require",
      });
  });
  await selectInTree(page, /^Property/);
  const inPreview = preview(page);
  await inPreview.getByRole("radio", { name: "Boat" }).check();
  await expect(inPreview.getByLabel("Serial number")).toHaveAttribute("aria-required", "true");
  await publish(page);

  await chooseQueryType(dispatcher, "PRO");
  const bar = dispatcher.getByRole("group", { name: /^Property type/ });
  const serial = dispatcher.getByLabel("Serial number");
  // The old Boat button (code BOAT) is there until the new config arrives; the rule is what tells
  // them apart: only the new WATERCRAFT code makes the serial number required.
  await expect(async () => {
    await bar.getByRole("radio", { name: "Boat" }).check();
    await expect(serial).toHaveAttribute("aria-required", "true", { timeout: 1_000 });
  }).toPass({ timeout: BOUND });
  await bar.getByRole("radio", { name: "Article" }).check();
  await expect(serial).not.toHaveAttribute("aria-required", "true");
  await expectNoSeriousAxeViolations(dispatcher);
  await dispatcher.getByRole("button", { name: "Clear" }).click();
});

test("[#362] a changed default shows with the default tag (form editor, keyboard only)", async ({
  page,
}) => {
  await openBuilder(page);
  const tree = page.getByRole("navigation", { name: "Configuration items" });
  const defaults = tree.getByRole("treeitem", { name: /^Defaults/ });
  await defaults.focus();
  await page.keyboard.press("Enter");
  const state = page.getByRole("textbox", { name: "State", exact: true });
  await state.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("OK");
  await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
  await selectInTree(page, /^Vehicle/);
  const inPreview = preview(page);
  await expect(inPreview.getByLabel("State", { exact: true })).toHaveValue("OK");
  await expect(inPreview.getByText("default", { exact: true })).toBeVisible();
  await publish(page);

  await chooseQueryType(dispatcher, "VEH");
  await expect(dispatcher.getByLabel("State", { exact: true })).toHaveValue("OK", {
    timeout: BOUND,
  });
  await expect(dispatcher.getByText("default", { exact: true })).toBeVisible();
  await expectNoSeriousAxeViolations(dispatcher);
});

test("[#362] a new terminal command parses in the dispatcher's terminal", async ({ page }) => {
  await openBuilder(page);
  await editDraft(page, (doc) => {
    doc.commands.push({ code: "PLT", queryType: "VEH", positions: ["plate", "state", "year"] });
  });
  await selectInTree(page, /^Vehicle/);
  const inPreview = preview(page);
  await inPreview.getByRole("button", { name: "Terminal mode" }).click();
  const previewInput = inPreview.getByRole("textbox", { name: "Command" });
  const problems = inPreview.getByRole("list", { name: "Command problems" });
  // The preview's terminal is the real one: an unknown command is a problem, the new one is not.
  await previewInput.fill("XYZ.1");
  await previewInput.press("Enter");
  await expect(problems.getByRole("listitem")).toHaveText("Unrecognized command XYZ.");
  await previewInput.fill("PLT.ZZ0036.OK.26");
  await previewInput.press("Enter");
  await expect(problems).toHaveCount(0);
  await publish(page);

  // The same command is unknown until the new config arrives, then it runs as a vehicle query.
  const posts: { queryType: string; values: Record<string, string> }[] = [];
  dispatcher.on("request", (r) => {
    if (r.url().endsWith("/api/v1/queries") && r.method() === "POST")
      posts.push(r.postDataJSON() as (typeof posts)[number]);
  });
  await chooseQueryType(dispatcher, "VEH");
  await dispatcher.getByRole("button", { name: "Terminal mode" }).click();
  const input = dispatcher.getByRole("textbox", { name: "Command" });
  await expect(async () => {
    await input.fill("PLT.ZZ0036.OK.26");
    await input.press("Enter");
    expect(posts.length).toBeGreaterThan(0);
  }).toPass({ timeout: BOUND });
  expect(posts.at(-1)?.queryType).toBe("VEH");
  expect(posts.at(-1)?.values).toMatchObject({ plate: "ZZ0036", year: "26" });
  await expectNoSeriousAxeViolations(dispatcher);
  await dispatcher.getByRole("button", { name: "Form mode" }).click();
});

test("[#362] a quick-access button is removed and added back", async ({ page }) => {
  // Every query type is already a button, so "added" is shown by removing one first.
  await openBuilder(page);
  await editDraft(page, (doc) => {
    doc.quickAccess = doc.quickAccess.filter((code) => code !== "WNT");
  });
  await selectInTree(page, /^Vehicle/);
  await expect(
    preview(page).getByRole("group", { name: "Quick access" }).getByRole("button", {
      name: "Wanted check",
    }),
  ).toHaveCount(0);
  await publish(page);
  await expect(dispatcherQuickAccess().getByRole("button", { name: "Wanted check" })).toHaveCount(
    0,
    { timeout: BOUND },
  );

  await editDraft(page, (doc) => {
    doc.quickAccess.push("WNT");
  });
  await expect(
    preview(page).getByRole("group", { name: "Quick access" }).getByRole("button", {
      name: "Wanted check",
    }),
  ).toBeVisible();
  await publish(page);
  await expect(dispatcherQuickAccess().getByRole("button", { name: "Wanted check" })).toBeVisible({
    timeout: BOUND,
  });
  await expectNoSeriousAxeViolations(dispatcher);
});

test("[#362] a stale submit across a publish gets 409, refetches and asks to resubmit", async ({
  page,
}) => {
  await chooseQueryType(dispatcher, "VEH");
  const plate = dispatcher.getByLabel("Plate", { exact: true });
  await plate.fill("ZZ-0035");
  // The dispatcher's open form is made stale on purpose: its config poll answers with what it
  // already has until its own submit goes out, so the publish cannot reach it first.
  const before = await (await dispatcher.request.get("/api/v1/config")).text();
  let hold = true;
  await dispatcher.route("**/api/v1/config", (route) =>
    hold
      ? route.fulfill({ status: 200, contentType: "application/json", body: before })
      : route.continue(),
  );
  await dispatcher.route("**/api/v1/queries", (route) => {
    hold = false;
    return route.continue();
  });

  await openBuilder(page);
  await editDraft(page, (doc) => {
    doc.queryTypes
      .find((q) => q.code === "VEH")
      ?.fields.push({
        key: "tagSticker",
        labelKey: "field.tagSticker",
        dataType: "string",
        maxLength: 12,
        transform: "upper",
        section: "base",
      });
  });
  await publish(page);

  await expect(dispatcher.getByLabel("Tag sticker")).toHaveCount(0);
  await plate.focus();
  const first = dispatcher.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await dispatcher.keyboard.press("Enter");
  expect((await first).status()).toBe(409);
  await expect(dispatcher.getByTestId("announcer-polite")).toHaveText(
    "The site configuration changed. Check the form and submit again.",
  );
  // The refetch brought the new field in; the typed plate and focus are kept.
  await expect(dispatcher.getByLabel("Tag sticker")).toBeVisible();
  await expect(plate).toHaveValue("ZZ-0035");
  await expect(plate).toBeFocused();
  await expectNoSeriousAxeViolations(dispatcher);
  // Resubmitting now carries the new hash and is accepted.
  const second = dispatcher.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await dispatcher.keyboard.press("Enter");
  expect((await second).status()).toBe(202);
  await dispatcher.unroute("**/api/v1/config");
  await dispatcher.unroute("**/api/v1/queries");
});

test("[#362] roll back restores the previous form; history, export and the conflict alert", async ({
  page,
}) => {
  await openBuilder(page);
  const live = published.at(-1) as number;
  const previous = published.at(-2) as number;
  expect(live).toBeGreaterThan(previous);

  // History: the drawer lists the versions; Export hands the browser a file.
  const history = page.getByRole("button", { name: "History" });
  await history.press("Enter");
  const drawer = page.getByRole("region", { name: "Version history" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Version history" })).toBeFocused();
  await expectNoSeriousAxeViolations(page);
  const download = page.waitForEvent("download");
  await drawer.getByRole("button", { name: `Export version ${previous}` }).press("Enter");
  const file = await download;
  expect(file.suggestedFilename()).toBe(`default-v${previous}.json`);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    siteConfig: Doc;
  };
  // The file is that version's own document: the vehicle form has no Tag sticker field yet.
  const vehicle = exported.siteConfig.queryTypes.find((q) => q.code === "VEH");
  expect(vehicle?.fields.map((f) => f.key)).not.toContain("tagSticker");

  // Roll back to the version before the last publish: confirm dialog, then the dispatcher's form
  // goes back by itself.
  await drawer.getByRole("button", { name: `Roll back to version ${previous}` }).press("Enter");
  const confirm = page.getByRole("dialog", { name: `Roll back to version ${previous}?` });
  await expect(confirm).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await confirm.getByRole("button", { name: `Roll back to version ${previous}` }).press("Enter");
  await expect(
    page.getByText(/^Published version \d+ \(roll back of version/).first(),
  ).toBeVisible();
  await expect(dispatcher.getByLabel("Tag sticker")).toHaveCount(0, { timeout: BOUND });
  await expectNoSeriousAxeViolations(dispatcher);

  // The draft was left as it was, so its base is stale: the next publish is the 409 path, with
  // its alert and the way to the latest version.
  await page.getByRole("button", { name: "Close history" }).press("Enter");
  await page.getByRole("button", { name: "Review and publish" }).press("Enter");
  const alert = page.getByRole("alert").filter({ hasText: "A newer version was published" });
  await expect(alert).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await alert.getByRole("button", { name: "Load the latest" }).press("Enter");
  const discard = page.getByRole("dialog", { name: "Load the latest version?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Discard and load" }).press("Enter");
  await expect(alert).toBeHidden();
  await expect(page.getByTestId("draft-status")).toContainText("No unpublished changes");
});

test("[#362] a long change list publishes: the review dialog stays accessible; the dispatcher never reloaded", async ({
  page,
}) => {
  await openBuilder(page);
  await editDraft(page, (doc) => {
    // One change per text field of every query type: a list long enough to scroll.
    for (const type of doc.queryTypes)
      for (const field of type.fields)
        if (field.dataType === "string" && typeof field.maxLength === "number")
          field.maxLength = (field.maxLength as number) + 1;
  });
  await expect(page.getByTestId("draft-status")).toContainText(/\d\d unpublished changes/);
  await publish(page, true);
  await expect(dispatcher.getByRole("group", { name: "Quick access" })).toBeVisible();
  // No reload in the whole run: the marker set at sign-in is still there.
  expect(
    await dispatcher.evaluate(
      () => (window as unknown as { __qmOpenSince?: number }).__qmOpenSince,
    ),
  ).toBeGreaterThan(0);
});
