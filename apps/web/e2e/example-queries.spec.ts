import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseQueryType, signIn } from "./helpers.js";

// One test per demoable requirements example, on the default site (Track A plan "Example queries";
// BR-001: the same renderer serves every row, only the config differs). Trigger inputs and
// synthetic names follow the fixture policy (spec 5.4).

interface Sent {
  queryType: string;
  values: Record<string, unknown>;
}

async function panelReady(page: Page): Promise<void> {
  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
}

/** Types a terminal command from the keyboard and submits it; returns the POST body and reply. */
async function runCommand(page: Page, command: string) {
  await page.keyboard.press("Slash");
  const input = page.getByRole("textbox", { name: "Command" });
  await expect(input).toBeFocused();
  // The terminal opens with the current type's command; replace it (Ctrl+A is never bound).
  await page.keyboard.press("Control+A");
  await page.keyboard.type(command);
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/v1/queries") && r.method() === "POST",
  );
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await page.keyboard.press("Enter");
  const sent = (await request).postDataJSON() as Sent;
  const reply = await response;
  const parts = ((await reply.json()) as { parts: { queryType: string; status: string }[] }).parts;
  await expect(page.getByRole("region", { name: "Last query" })).toBeVisible();
  return { sent, status: reply.status(), parts };
}

test.describe("example queries, form (FR-001 to FR-012, FR-030 to FR-032)", () => {
  test("VEH: a state other than the default shows Plate type and the custom Plate color, required (FR-008, FR-011)", async ({
    page,
  }) => {
    await panelReady(page);
    await expect(page.getByLabel("Plate type")).toHaveCount(0);
    const state = page.getByLabel("State", { exact: true });
    await state.focus();
    await page.keyboard.type("Ok");
    await expect(state).toHaveValue("OK");
    await expect(page.getByLabel("Plate type")).toHaveAttribute("aria-required", "true");
    await expect(page.getByLabel("Plate color")).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });

  test("PER: State other than the default requires Date of birth (FR-001, FR-011)", async ({
    page,
  }) => {
    await panelReady(page);
    await chooseQueryType(page, "PER");
    const dob = page.getByLabel("Date of birth");
    await expect(dob).not.toHaveAttribute("aria-required", "true");
    const state = page.getByLabel("State", { exact: true });
    await state.focus();
    await page.keyboard.type("Ok");
    await expect(state).toHaveValue("OK");
    await expect(dob).toHaveAttribute("aria-required", "true");
    await expectNoSeriousAxeViolations(page);
  });

  test("PRO: Firearm requires Make and Caliber; Article requires Description (FR-030 to FR-032)", async ({
    page,
  }) => {
    await panelReady(page);
    await chooseQueryType(page, "PRO");
    // The property type is a segmented control of radios (design B2), one segment per option.
    const radio = (name: string) =>
      page.getByRole("group", { name: /Property type/ }).getByRole("radio", { name });
    await radio("Firearm").check();
    await expect(radio("Firearm")).toBeChecked();
    await expect(page.getByLabel("Make")).toHaveAttribute("aria-required", "true");
    await expect(page.getByLabel("Caliber")).toHaveAttribute("aria-required", "true");
    await expectNoSeriousAxeViolations(page);

    await radio("Article").check();
    await expect(radio("Article")).toBeChecked();
    await expect(page.getByLabel("Description")).toHaveAttribute("aria-required", "true");
    await expect(page.getByLabel("Make")).toHaveCount(0);

    // Electronics shows Make and Model but not Caliber; a State other than the default requires
    // the serial number.
    await radio("Electronics").check();
    await expect(radio("Electronics")).toBeChecked();
    await expect(page.getByLabel("Make")).toBeVisible();
    await expect(page.getByLabel("Model")).toBeVisible();
    await expect(page.getByLabel("Caliber")).toHaveCount(0);
    const serial = page.getByLabel("Serial number");
    await expect(serial).not.toHaveAttribute("aria-required", "true");
    const state = page.getByLabel("State", { exact: true });
    await state.focus();
    await page.keyboard.type("Ok");
    await expect(state).toHaveValue("OK");
    await expect(serial).toHaveAttribute("aria-required", "true");
    await expectNoSeriousAxeViolations(page);
  });
});

test.describe("example queries, terminal, keyboard only (FR-050 to FR-056, FR-042)", () => {
  test("NAM.TESTERSON.SAMPLE.01011901 runs a person query", async ({ page }) => {
    await panelReady(page);
    const { sent, status, parts } = await runCommand(page, "NAM.TESTERSON.SAMPLE.01011901");
    expect(status).toBe(202);
    expect(sent.queryType).toBe("PER");
    expect(sent.values).toEqual({ last: "TESTERSON", first: "SAMPLE", dob: "01011901" });
    // PER runs WNT beside it (alsoRun): a name and a date of birth were given.
    expect(parts.map((p) => p.queryType)).toEqual(["PER", "WNT"]);
    await expectNoSeriousAxeViolations(page);
  });

  test("PROP.FIREARM.ZZ123 with its required Make and Caliber runs a property query", async ({
    page,
  }) => {
    await panelReady(page);
    const { sent, status, parts } = await runCommand(
      page,
      "PROP.FIREARM.ZZ123.TX.make=ZZMAKE.caliber=22",
    );
    expect(status).toBe(202);
    expect(sent.queryType).toBe("PRO");
    expect(sent.values).toEqual({
      propertyType: "FIREARM",
      serial: "ZZ123",
      state: "TX",
      make: "ZZMAKE",
      caliber: "22",
    });
    expect(parts[0]).toMatchObject({ queryType: "PRO" });
    await expectNoSeriousAxeViolations(page);
  });

  test("DL.ZZ1234567 runs a license query", async ({ page }) => {
    await panelReady(page);
    const { sent, status, parts } = await runCommand(page, "DL.ZZ1234567");
    expect(status).toBe(202);
    expect(sent.queryType).toBe("DL");
    expect(sent.values).toMatchObject({ licenseNumber: "ZZ1234567" });
    expect(parts[0]).toMatchObject({ queryType: "DL" });
    await expectNoSeriousAxeViolations(page);
  });

  test("DL with a name and date of birth also runs the wanted check (FR-042)", async ({ page }) => {
    await panelReady(page);
    const { sent, status, parts } = await runCommand(
      page,
      "DL.ZZ1234567.TX.TESTERSON.SAMPLE.01011901",
    );
    expect(status).toBe(202);
    expect(sent.queryType).toBe("DL");
    expect(sent.values).toMatchObject({
      licenseNumber: "ZZ1234567",
      last: "TESTERSON",
      first: "SAMPLE",
      dob: "01011901",
    });
    expect(parts.map((p) => p.queryType)).toEqual(["DL", "WNT"]);
    await expectNoSeriousAxeViolations(page);
  });

  test("VEH.ABC123..26 runs a vehicle query, State left to its default", async ({ page }) => {
    await panelReady(page);
    const { sent, status, parts } = await runCommand(page, "VEH.ABC123..26");
    expect(status).toBe(202);
    expect(sent.queryType).toBe("VEH");
    expect(sent.values).toEqual({ plate: "ABC123", year: "26" });
    expect(parts[0]).toMatchObject({ queryType: "VEH", status: "dispatched" });
    await expectNoSeriousAxeViolations(page);
  });
});
