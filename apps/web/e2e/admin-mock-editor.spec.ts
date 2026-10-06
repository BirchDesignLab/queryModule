import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Task 4 (#551, CFG-2; spec 5.4): the mock responses editor, end to end. On a mock site an admin adds
// a query type, fills its mock gap, adds one scenario (trigger ZZ-0002, returns STOLEN), reviews and
// publishes; a new source offers a no-record response for each query type that asks it; the server's
// fixture policy (#532) stays authoritative. Keyboard only where the editor is the subject; axe runs
// after every scenario (fixtures.ts) and mid-test on each new state.
//
// The new query type and source are added through the Raw JSON tab (their form editors have RTL
// tests, admin-config.spec.ts precedent); the mock work is all in the mock editor. The tests share
// one server and one live config, so they run in order and the last step puts the first version back
// (the other specs expect the shipped config). Synthetic data only: ZZ-####.

const ADMIN = seededUser("admin@example.test");

type Obj = Record<string, unknown>;
interface Doc {
  queryTypes: { code: string; sources: Obj[]; allowPlateOnly?: boolean }[];
  sources: Obj[];
}

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ viewport: { width: 1600, height: 1000 } });

test.afterAll(async ({ browser }) => {
  // Whatever happened above, the shipped config is live again for the specs that follow.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, ADMIN);
    const origin = new URL(page.url()).origin;
    const headers = { "X-Requested-With": "querymodule", Origin: origin };
    const list = await context.request.get(`${origin}/api/v1/admin/config/versions`);
    expect(list.ok(), `versions list answered ${list.status()}`).toBe(true);
    const { versions } = (await list.json()) as {
      versions: { version: number; status: string }[];
    };
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
const tree = (page: Page) => page.getByRole("navigation", { name: "Configuration items" });

/** Edits the draft in the Raw JSON tab and returns to the Form tab. A gap is an error: no wait for zero. */
async function editDraft(page: Page, mutate: (doc: Doc) => void): Promise<void> {
  await tabs(page).getByRole("tab", { name: "Form" }).focus();
  await page.keyboard.press("ArrowRight");
  const area = page.getByLabel("Draft JSON");
  await expect(area).toBeVisible();
  const doc = JSON.parse(await area.inputValue()) as Doc;
  mutate(doc);
  await area.fill(JSON.stringify(doc, null, 2));
  await expect(page.getByTestId("draft-summary")).toContainText(/Draft checks: \d+ errors?/);
  await tabs(page).getByRole("tab", { name: "Raw JSON" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs(page).getByRole("tab", { name: "Form" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/**
 * A copy of the Vehicle type under a new code, asking the State system (a plate field is already
 * there). Review saves the shared draft on the server, so a later test may open with BOAT already in
 * the draft: add it once.
 */
const addBoatType = (doc: Doc): void => {
  if (doc.queryTypes.some((q) => q.code === "BOAT")) return;
  const vehicle = doc.queryTypes.find((q) => q.code === "VEH");
  if (vehicle === undefined) throw new Error("the shipped config has no VEH type");
  doc.queryTypes.push({
    ...structuredClone(vehicle),
    code: "BOAT",
    allowPlateOnly: false,
    sources: [{ sourceId: "stateSource", selectedByDefault: true }],
  });
};

/** Selects a tree row by keyboard (focus the row, press Enter). */
async function selectRow(page: Page, name: RegExp): Promise<void> {
  const item = tree(page).getByRole("treeitem", { name }).first();
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(item).toHaveAttribute("aria-selected", "true");
}

const typeMockGroup = (page: Page) =>
  page.getByRole("group", { name: "Mock responses for this type" });

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

/** The live version's stored mock, as the admin API answers it. */
async function liveMock(page: Page): Promise<{
  sources: Record<string, { responses: { queryType: string; scenarios: Obj[]; default: Obj }[] }>;
}> {
  const origin = new URL(page.url()).origin;
  const res = await page.context().request.get(`${origin}/api/v1/admin/config`);
  expect(res.ok(), `admin config answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { live: { document: { mock?: unknown } } };
  return body.live.document.mock as Awaited<ReturnType<typeof liveMock>>;
}

test("[#551] a new query type on a mock site shows its gap where the admin works, and publishing waits", async ({
  page,
}) => {
  await openBuilder(page);
  await editDraft(page, addBoatType);
  await selectRow(page, /BOAT/);
  const group = typeMockGroup(page);
  await expect(group).toBeVisible();
  await expect(group.getByText("Missing")).toBeVisible();
  await expect(
    group.getByRole("button", { name: /Add mock response for State system, Vehicle/ }),
  ).toBeVisible();
  // Publishing waits for the gap: Review asks the server (config.missingMockResponse), says so, and
  // opens no dialog.
  await page.getByRole("button", { name: "Review and publish" }).press("Enter");
  await expect(page.getByText(/Not published: \d+ errors? to fix first/).first()).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Review and publish" })).toHaveCount(0);
  // The gap is the only error, so the builder goes to it at the Coverage item.
  await expect(
    page.getByRole("table", { name: "Mock response coverage: query types by mock source" }),
  ).toBeVisible();
  await expect(page.getByText("Missing").first()).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("[#551] the gap is filled by keyboard, one scenario added, reviewed and published; the server stores the mock", async ({
  page,
}) => {
  await openBuilder(page);
  await editDraft(page, addBoatType);
  await selectRow(page, /BOAT/);
  const group = typeMockGroup(page);
  // Add the no-record response: focus stays in the section, on the row's Open button.
  await group
    .getByRole("button", { name: /Add mock response for State system, Vehicle/ })
    .press("Enter");
  const open = group.getByRole("button", { name: /Open mock response for State system, Vehicle/ });
  await expect(open).toBeFocused();
  await expect(group.getByText("Missing")).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  await open.press("Enter");
  await expect(page.getByRole("heading", { name: /Vehicle/ }).first()).toBeFocused();

  // One scenario: trigger plate = ZZ-0002, returns a record with status STOLEN.
  await page.getByRole("button", { name: "Add scenario" }).press("Enter");
  const card = page.getByRole("group", { name: "Scenario 1" });
  await expect(card).toBeVisible();
  await card.getByLabel("Trigger field 1", { exact: true }).selectOption({ label: "Plate" });
  await card.getByLabel("Value for trigger field 1", { exact: true }).fill("ZZ-0002");
  await card.getByRole("radio", { name: /Returns a record/ }).check();
  const status = card.getByRole("textbox", { name: /status/i });
  await status.fill("STOLEN");
  await status.press("Tab");
  await expectNoSeriousAxeViolations(page);
  await expect(page.getByTestId("draft-summary")).toContainText(/Draft checks: 0 errors/);

  // Review lists the changes by source, query type and scenario, never a value; publish goes through
  // the server's fixture policy (#532).
  const { version, review } = await publish(page);
  // The copy keeps Vehicle's name; its code BOAT is in the tree. Names, never values.
  expect(review).toContain("State system, Vehicle");
  expect(review).toContain("Response added");
  // The scenario belongs to the new response: one line, no trigger value, no payload.
  expect(review).not.toContain("ZZ-0002");
  expect(review).not.toContain("STOLEN");
  expect(version).toBeGreaterThan(1);

  const stored = await liveMock(page);
  const boat = stored.sources.stateSource?.responses.find((r) => r.queryType === "BOAT");
  expect(boat?.default).toEqual({ status: "NO RECORD" });
  expect(boat?.scenarios).toEqual([{ when: { plate: "ZZ-0002" }, respond: { status: "STOLEN" } }]);
});

test("[#551] a new source offers a no-record response for each query type that asks it", async ({
  page,
}) => {
  await openBuilder(page);
  await editDraft(page, (doc) => {
    doc.sources.push({
      id: "countySource",
      labelKey: "source.stateSource",
      scope: "state",
      kind: "mock",
      timeoutMs: 10000,
      maxConcurrent: 4,
      requiresCredentials: false,
    });
    const vehicle = doc.queryTypes.find((q) => q.code === "VEH");
    vehicle?.sources.push({ sourceId: "countySource", selectedByDefault: true });
  });
  await selectRow(page, /^Sources/);
  const panel = page.getByRole("group", { name: "Mock responses to add" });
  await expect(panel).toBeVisible();
  const add = panel.getByRole("button", { name: /Add a no-record response for each query type/ });
  await expectNoSeriousAxeViolations(page);
  await add.press("Enter");
  // The row stays, now with "Open mock source", and holds focus.
  const openSource = panel.getByRole("button", { name: /Open mock source/ });
  await expect(openSource).toBeFocused();
  await expect(page.getByTestId("draft-summary")).toContainText(/Draft checks: 0 errors/);
  await expectNoSeriousAxeViolations(page);
  const { version } = await publish(page);
  expect(version).toBeGreaterThan(1);
  const stored = await liveMock(page);
  expect(stored.sources.countySource?.responses.map((r) => r.queryType)).toEqual(["VEH"]);
});

test("[#532] the server refuses a non-synthetic name in a draft and stores nothing", async ({
  page,
}) => {
  await signIn(page, ADMIN);
  const origin = new URL(page.url()).origin;
  const request = page.context().request;
  const before = (await (await request.get(`${origin}/api/v1/admin/config`)).json()) as {
    live: { version: number; document: { siteConfig: unknown; locales: unknown; mock: unknown } };
    draft: unknown;
  };
  const mock = structuredClone(before.live.document.mock) as {
    sources: Record<string, { responses: { default: Obj }[] }>;
  };
  const first = mock.sources.stateSource?.responses[0];
  if (first === undefined) throw new Error("the live mock has no state source response");
  // A name that is not synthetic (negative-test input; never a record).
  first.default = { status: "HIT", last: "Smith" };
  const headers = { "X-Requested-With": "querymodule", Origin: origin };
  const res = await request.put(`${origin}/api/v1/admin/config/draft`, {
    headers,
    data: {
      baseVersion: before.live.version,
      document: { ...before.live.document, mock },
    },
  });
  expect(res.ok()).toBe(false);
  const text = await res.text();
  expect(text).toContain("fixture.nonSyntheticName");
  expect(text).not.toContain("Smith");
  // Nothing reached the database: no draft carries the value.
  const after = await (await request.get(`${origin}/api/v1/admin/config`)).text();
  expect(after).not.toContain("Smith");
});
