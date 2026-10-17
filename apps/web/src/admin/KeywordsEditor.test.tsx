import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import {
  API,
  adminConfigBody,
  CLIENT_CONFIG,
  RAW_MOCK,
  server,
  TEST_USER,
} from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// Task 11 (#604; FR-060, UX-010, UX-011; spec 4.1, 4.5, 6.5): the keywords and severity editor,
// its inline diagnostics, the sample line and the card preview. Synthetic fixtures only (TESTMAKE,
// ZZ-0001). axe runs in e2e (admin-cards.spec.ts): the unit suite has no axe.

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () =>
      HttpResponse.json(adminConfigBody({ mock: RAW_MOCK })),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const nav = () => screen.getByRole("navigation", { name: "Configuration items" });
const editor = () => screen.getByTestId("form-tab");
const doc = (t: Opened) =>
  configDraftStore(t.services).getState().doc as {
    keywords: { keyword: string; severity: string; except?: string[] }[];
    keywordSeverityStyles: Record<string, Record<string, unknown>>;
    responseMappings: { elements: unknown[] }[];
  };

async function openKeywords(t: Opened) {
  const cards = await screen.findByRole("tree", { name: "Result cards" });
  await t.user.click(
    within(cards).getByRole("treeitem", { name: /^Keywords and severity keywords/ }),
  );
  return within(editor()).findByRole("heading", { level: 3, name: /^Keywords and severity/ });
}

async function addKeyword(t: Opened, text: string, severity?: string) {
  const input = within(editor()).getByRole("textbox", { name: "New keyword" });
  await t.user.clear(input);
  await t.user.type(input, text);
  if (severity !== undefined)
    await t.user.selectOptions(
      within(editor()).getByRole("combobox", { name: "Severity of the new keyword" }),
      severity,
    );
  await t.user.click(within(editor()).getByRole("button", { name: "Add keyword" }));
}

const sample = () => within(editor()).getByRole("group", { name: "Marked sample" });
const sampleMarks = () => [...sample().querySelectorAll("mark")].map((m) => m.textContent ?? "");

async function typeSample(t: Opened, text: string) {
  const input = within(editor()).getByRole("textbox", { name: "Sample text" });
  await t.user.clear(input);
  await t.user.type(input, text);
}

describe("the keywords editor", () => {
  it("opens from the tree row, lists each keyword with its severity and exceptions", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const stolen = within(editor()).getByRole("textbox", { name: "Keyword 1" });
    expect(stolen).toHaveValue("STOLEN");
    expect(within(editor()).getByRole("combobox", { name: "Severity of keyword 1" })).toHaveValue(
      "critical",
    );
    expect(within(editor()).getByRole("textbox", { name: "Exception 1 of keyword 1" })).toHaveValue(
      "NOT STOLEN",
    );
    // The generic Keyword styles row left the Site group: its styles are edited here.
    const site = within(nav()).getByRole("tree", { name: "Site" });
    expect(within(site).queryByRole("treeitem", { name: /keywordSeverityStyles/ })).toBeNull();
    expect(within(editor()).getByRole("group", { name: "Critical style" })).toBeInTheDocument();
  });

  // Re-walk R1: the keywords sat in a four-column table wider than the editor at 1024 and 1366. Each
  // keyword is now a small card (a list item) that stacks its parts, so no width clips a control.
  it("lists the keywords as a named list of cards with visible captions and a short Remove (R1)", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const list = within(editor()).getByRole("list", { name: "Keywords" });
    const first = within(list).getAllByRole("listitem")[0] as HTMLElement;
    expect(within(first).getByRole("textbox", { name: "Keyword 1" })).toHaveValue("STOLEN");
    for (const caption of ["Keyword", "Severity", "Exceptions"])
      expect(within(first).getByText(caption)).toBeVisible();
    const remove = within(first).getByRole("button", { name: "Remove keyword STOLEN" });
    // Visible text is the short "Remove"; the accessible name still says which keyword.
    expect(remove.querySelector('[aria-hidden="true"]')?.textContent).toBe("Remove");
    expect(within(editor()).queryByRole("table")).toBeNull();
  });

  // Demo dry run G3: Add keyword with an empty word did nothing and said nothing.
  it("Add keyword with no word says so and puts focus in the New keyword box; typing clears it", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const before = doc(t).keywords.length;
    await t.user.click(within(editor()).getByRole("button", { name: "Add keyword" }));
    const box = within(editor()).getByRole("textbox", { name: "New keyword" });
    expect(doc(t).keywords).toHaveLength(before);
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(/Type the keyword first/);
    await t.user.type(box, "T");
    expect(box).not.toHaveAttribute("aria-invalid", "true");
    expect(within(editor()).queryByText(/Type the keyword first/)).toBeNull();
  });

  // Demo dry run G17: the color selects showed raw token keys ("color.severity.crit..."), clipped.
  it("the style color selects list plain names, and keep the token key as the value", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const style = within(editor()).getByRole("group", { name: "Critical style" });
    const text = within(style).getByRole("combobox", { name: "Text color" });
    const background = within(style).getByRole("combobox", { name: "Background color" });
    expect(text).toHaveDisplayValue("Critical text");
    expect(background).toHaveDisplayValue("Critical background");
    const options = within(background).getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => o.textContent).join(" ")).not.toMatch(/color\./);
    expect(options.find((o) => o.textContent === "Warning background")?.value).toBe(
      "color.severity.warning.bg",
    );
    await t.user.selectOptions(background, "color.severity.info.bg");
    expect(background).toHaveDisplayValue("Info background");
  });

  it("adds a warning keyword TESTMAKE, as one edit, and keeps focus in the new keyword box", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    await addKeyword(t, "TESTMAKE", "warning");
    expect(doc(t).keywords.at(-1)).toEqual({ keyword: "TESTMAKE", severity: "warning" });
    const box = within(editor()).getByRole("textbox", { name: "New keyword" });
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue("");
    await t.user.click(screen.getByRole("button", { name: /^Undo/ }));
    expect(doc(t).keywords.map((k) => k.keyword)).not.toContain("TESTMAKE");
  });

  it("shows the new keyword marked in the card preview for typed ZZ-0001", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    // The VEH card shows vehicle.make in its summary; the mock answer for ZZ-0001 carries TESTMAKE.
    const veh = doc(t).responseMappings[0] as { elements: unknown[] };
    act(() =>
      configDraftStore(t.services)
        .getState()
        .setPath(
          ["responseMappings", 0, "elements"],
          [
            ...veh.elements,
            { kind: "value", path: "vehicle.make", labelKey: "mapping.remarks", view: "summary" },
          ],
        ),
    );
    await addKeyword(t, "TESTMAKE", "warning");
    const pane = await screen.findByRole("region", { name: "Card preview" });
    await t.user.click(within(pane).getByRole("radio", { name: "Type values" }));
    const plate = within(pane).getByRole("textbox", { name: "Plate" });
    await t.user.clear(plate);
    await t.user.type(plate, "ZZ-0001");
    const card = await within(pane).findByRole("region", { name: "State system: returned" });
    await waitFor(() =>
      expect([...card.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(
        expect.arrayContaining([expect.stringContaining("TESTMAKE")]),
      ),
    );
    // Severity is in words as well as colour: the mark carries a hidden "warning".
    const mark = [...card.querySelectorAll("mark")].find((m) =>
      (m.textContent ?? "").includes("TESTMAKE"),
    ) as HTMLElement;
    expect(within(mark).getByText(/warning/i)).toBeInTheDocument();
    // Typed values never reach the draft.
    expect(JSON.stringify(configDraftStore(t.services).getState().doc)).not.toContain("ZZ-0001");
  });

  it("an except phrase suppresses the mark in the sample line", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    await addKeyword(t, "TESTMAKE", "warning");
    await typeSample(t, "NOT TESTMAKE");
    expect(sampleMarks().some((m) => m.includes("TESTMAKE"))).toBe(true);
    const row = within(editor()).getByRole("textbox", { name: "Keyword 8" });
    expect(row).toHaveValue("TESTMAKE");
    await t.user.type(
      within(editor()).getByRole("textbox", { name: "New exception for keyword 8" }),
      "NOT TESTMAKE",
    );
    await t.user.click(
      within(editor()).getByRole("button", { name: /^Add exception to keyword 8/ }),
    );
    expect(doc(t).keywords.at(-1)?.except).toEqual(["NOT TESTMAKE"]);
    expect(sampleMarks().some((m) => m.includes("TESTMAKE"))).toBe(false);
    await typeSample(t, "TESTMAKE");
    expect(sampleMarks().some((m) => m.includes("TESTMAKE"))).toBe(true);
  });

  it("keeps spaces typed into a keyword or exception as they are typed", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const input = within(editor()).getByRole("textbox", { name: "Keyword 3" });
    await t.user.clear(input);
    await t.user.type(input, "NO ANSWER");
    expect(input).toHaveValue("NO ANSWER");
    expect(doc(t).keywords[2]?.keyword).toBe("NO ANSWER");
    // One undo step for the whole typing.
    await t.user.click(screen.getByRole("button", { name: /^Undo/ }));
    expect(doc(t).keywords[2]?.keyword).toBe("EXPIRED");
  });

  it("typing in two keyword boxes in a row is two undo steps", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const three = within(editor()).getByRole("textbox", { name: "Keyword 3" });
    const four = within(editor()).getByRole("textbox", { name: "Keyword 4" });
    const was3 = doc(t).keywords[2]?.keyword;
    const was4 = doc(t).keywords[3]?.keyword;
    await t.user.type(three, "X");
    await t.user.type(four, "Y");
    await t.user.click(screen.getByRole("button", { name: /^Undo/ }));
    expect(doc(t).keywords[3]?.keyword).toBe(was4);
    expect(doc(t).keywords[2]?.keyword).toBe(`${was3}X`);
  });

  it("shows config.exceptWithoutKeyword at the exception it is about", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    await addKeyword(t, "TESTMAKE", "warning");
    await t.user.type(
      within(editor()).getByRole("textbox", { name: "New exception for keyword 8" }),
      "SOMETHING ELSE",
    );
    await t.user.click(
      within(editor()).getByRole("button", { name: /^Add exception to keyword 8/ }),
    );
    const input = within(editor()).getByRole("textbox", { name: "Exception 1 of keyword 8" });
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    const message = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(message?.textContent).toMatch(
      /The exception under keyword TESTMAKE has no matching keyword/,
    );
  });

  it("a low-contrast style shows the diagnostic at the style, and the issue button focuses it", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const critical = within(editor()).getByRole("group", { name: "Critical style" });
    await t.user.selectOptions(
      within(critical).getByRole("combobox", { name: "Text color" }),
      "color.severity.critical.bg",
    );
    expect(
      await within(critical).findByText(
        /The critical keyword style lacks enough contrast in day mode/,
      ),
    ).toBeInTheDocument();
    expect(doc(t).keywordSeverityStyles.critical?.color).toBe("color.severity.critical.bg");
    // Move off the editor, then use the issue button: the style's first control takes focus.
    await t.user.click(within(nav()).getByRole("treeitem", { name: /^Vehicle VEH/ }));
    await t.user.click(
      await screen.findByRole("button", { name: /^\d+ errors?.*Go to the first issue\.$/ }),
    );
    const again = await within(editor()).findByRole("group", { name: "Critical style" });
    await waitFor(() => expect(again.contains(document.activeElement)).toBe(true));
  });

  it("shows the contrast ratio per theme as text, the under 7:1 hint, and a live sample per level (UX-011, ruling 7)", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const critical = within(editor()).getByRole("group", { name: "Critical style" });
    const ratios = within(critical).getByRole("list", { name: "Contrast by theme" });
    const items = within(ratios).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^Night \d+\.\d{2}:1/),
      expect.stringMatching(/^Day \d+\.\d{2}:1/),
      expect.stringMatching(/^Red shift \d+\.\d{2}:1/),
    ]);
    // The live sample is the production mark and badge for the level, in words as well as colour.
    const live = within(critical).getByRole("group", { name: "Live sample" });
    expect(live.querySelector("mark")).not.toBeNull();
    expect(live.querySelector(".qm-badge--critical")).not.toBeNull();
    // Same text and background: 1:1 in every theme, each flagged, still no block.
    const warning = within(editor()).getByRole("group", { name: "Warning style" });
    const bg = doc(t).keywordSeverityStyles.warning?.background as string;
    await t.user.selectOptions(within(warning).getByRole("combobox", { name: "Text color" }), bg);
    const low = within(within(warning).getByRole("list", { name: "Contrast by theme" }));
    for (const item of low.getAllByRole("listitem")) {
      expect(item.textContent).toMatch(/1\.00:1 \(under 7:1\)$/);
    }
    expect(doc(t).keywordSeverityStyles.warning?.color).toBe(bg);
  });

  it("styles edit the colors, bold, icon and marker of a severity", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const warning = within(editor()).getByRole("group", { name: "Warning style" });
    await t.user.selectOptions(
      within(warning).getByRole("combobox", { name: "Background color" }),
      "color.surface.raised",
    );
    await t.user.click(within(warning).getByRole("checkbox", { name: "Bold" }));
    await t.user.selectOptions(within(warning).getByRole("combobox", { name: "Icon" }), "info");
    const marker = within(warning).getByRole("textbox", { name: "Marker" });
    await t.user.clear(marker);
    await t.user.type(marker, "?");
    expect(doc(t).keywordSeverityStyles.warning).toMatchObject({
      background: "color.surface.raised",
      bold: false,
      icon: "info",
      marker: "?",
    });
  });
});

describe("keyboard", () => {
  it("adds a keyword with Enter, removes one with its button and focus goes to a neighbour, never body", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    const box = within(editor()).getByRole("textbox", { name: "New keyword" });
    act(() => box.focus());
    await t.user.keyboard("TESTMAKE{Enter}");
    expect(doc(t).keywords.at(-1)?.keyword).toBe("TESTMAKE");
    expect(box).toHaveFocus();
    const remove = within(editor()).getByRole("button", { name: /^Remove keyword.*TESTMAKE/ });
    act(() => remove.focus());
    await t.user.keyboard("{Enter}");
    expect(doc(t).keywords.map((k) => k.keyword)).not.toContain("TESTMAKE");
    await waitFor(() =>
      expect(within(editor()).getByRole("textbox", { name: "Keyword 7" })).toHaveFocus(),
    );
  });

  it("removing the only exception moves focus to the new exception box", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    // WANTED has one exception.
    const remove = within(editor()).getByRole("button", {
      name: /^Remove exception 1 of keyword 2/,
    });
    act(() => remove.focus());
    await t.user.keyboard("{Enter}");
    expect(doc(t).keywords[1]?.except).toBeUndefined();
    await waitFor(() =>
      expect(
        within(editor()).getByRole("textbox", { name: "New exception for keyword 2" }),
      ).toHaveFocus(),
    );
  });
});

describe("Review", () => {
  it("lists a new keyword in the Changes view", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    await addKeyword(t, "TESTMAKE", "warning");
    await t.user.click(screen.getByRole("tab", { name: "Changes" }));
    const group = (await screen.findByRole("heading", { level: 4, name: /^Keywords/ })).closest(
      "section",
    ) as HTMLElement;
    expect(within(group).getAllByText(/TESTMAKE/).length).toBeGreaterThan(0);
  });
});

// BW3 polish (#642, CRITIC-M2 and T11-11; spec 6.2 builder undo): half-typed text in a keyword
// row's New exception box belongs to that keyword: it survives another keyword's removal and the
// undo of it, and the box a user is typing in is never rebuilt.
describe("a keyword row's half-typed exception follows its keyword (CRITIC-M2)", () => {
  const undo = (t: Opened) => act(() => void configDraftStore(t.services).getState().undo());

  it("keeps the text through a removal of an earlier keyword and through its undo", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    // EXPIRED is keyword 3.
    const box = within(editor()).getByRole("textbox", { name: "New exception for keyword 3" });
    await t.user.type(box, "HALF");
    await t.user.click(within(editor()).getByRole("button", { name: /^Remove keyword.*STOLEN/ }));
    // EXPIRED is now keyword 2 and its box, the same element, still holds the text.
    const moved = within(editor()).getByRole("textbox", { name: "New exception for keyword 2" });
    expect(moved).toHaveValue("HALF");
    undo(t);
    await within(editor()).findByRole("textbox", { name: "New exception for keyword 6" });
    expect(
      within(editor()).getByRole("textbox", { name: "New exception for keyword 3" }),
    ).toHaveValue("HALF");
    for (const n of [1, 2, 4, 5, 6])
      expect(
        within(editor()).getByRole("textbox", { name: `New exception for keyword ${n}` }),
      ).toHaveValue("");
  });

  it("the focused New exception box is the same element after an undo", async () => {
    const t = await openBuilder();
    await openKeywords(t);
    await t.user.click(within(editor()).getByRole("button", { name: /^Remove keyword.*STOLEN/ }));
    const box = within(editor()).getByRole("textbox", { name: "New exception for keyword 2" });
    await t.user.type(box, "HALF");
    expect(box).toHaveFocus();
    undo(t);
    await within(editor()).findByRole("textbox", { name: "New exception for keyword 6" });
    expect(box.isConnected).toBe(true);
    expect(box).toHaveFocus();
    expect(box).toHaveValue("HALF");
  });
});

// T11-M2 (#642): a keyword whose severity is not one of the three showed as Info, so choosing Info
// fired no change and the keyword stayed invalid. It now shows a "Choose severity" entry instead.
describe("a keyword with an unknown severity (T11-M2)", () => {
  it("shows Choose severity, and choosing Info writes it", async () => {
    const t = await openBuilder();
    act(() =>
      configDraftStore(t.services).getState().setPath(["keywords", 0, "severity"], "bogus"),
    );
    await openKeywords(t);
    const select = within(editor()).getByRole("combobox", {
      name: "Severity of keyword 1",
    }) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe("Choose severity");
    await t.user.selectOptions(select, "Info");
    expect(doc(t).keywords[0]?.severity).toBe("info");
    expect((select as HTMLSelectElement).selectedOptions[0]?.textContent).toBe("Info");
    // The choose entry is gone once a severity is set.
    expect(within(select).queryByRole("option", { name: "Choose severity" })).toBeNull();
  });
});
