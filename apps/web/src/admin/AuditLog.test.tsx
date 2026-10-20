import { render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Root } from "../app/Root.js";
import { API, auditPage, CLIENT_CONFIG, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { testServices } from "../test/render-routes.js";
import { validateAuditForm } from "./audit-model.js";
import { auditStore } from "./audit-store.js";

beforeAll(preloadAdminRoutes);
afterEach(() => vi.restoreAllMocks());

// Task 3 (#726, FR-064, SEC-012; spec 6.2, 6.4, 6.6, 10.6): the audit log page and its rail entry.
// Fixtures are synthetic: example addresses and ids only.

const AUDIT = `${API}/api/v1/admin/audit`;
/** Explicit findBy window: these pages load under full-suite load (#610 pattern). */
const MAX_WAIT = { timeout: 5000 };

interface Opened {
  seen: URL[];
  t: ReturnType<typeof renderRoot>;
}

async function openAudit(
  role = "admin",
  options: {
    flags?: Partial<typeof CLIENT_CONFIG.features>;
    pages?: (url: URL) => Response | Promise<Response>;
    path?: string;
  } = {},
): Promise<Opened> {
  const user = { ...TEST_USER, role };
  const seen: URL[] = [];
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () =>
      HttpResponse.json({
        ...CLIENT_CONFIG,
        features: { ...CLIENT_CONFIG.features, ...options.flags },
      }),
    ),
    http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json({ users: [] })),
    http.get(AUDIT, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      return options.pages?.(url) ?? HttpResponse.json(auditPage(3, null));
    }),
  );
  const t = renderRoot({ path: options.path ?? "/admin/audit" });
  return { seen, t };
}

const rail = () => screen.getByRole("navigation", { name: "Admin sections" });

describe("rail entry", () => {
  it("shows Oversight and Audit log to an admin with the feature on", async () => {
    await openAudit("admin", { path: "/admin/config" });
    await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    expect(within(rail()).getByText("Oversight")).toBeInTheDocument();
    expect(within(rail()).getByRole("link", { name: "Audit log" })).toHaveAttribute(
      "href",
      "/admin/audit",
    );
  });

  it("shows nothing to an implementer", async () => {
    await openAudit("implementer", { path: "/admin/config" });
    await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    expect(within(rail()).queryByText("Oversight")).toBeNull();
    expect(within(rail()).queryByRole("link", { name: "Audit log" })).toBeNull();
  });

  it("shows nothing with the feature off", async () => {
    await openAudit("admin", { path: "/admin/config", flags: { adminAudit: false } });
    await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    // The entry waits for the cached config: once it has loaded with the flag off, the link goes.
    await waitFor(() =>
      expect(within(rail()).queryByRole("link", { name: "Audit log" })).toBeNull(),
    );
  });

  it("a typed URL for an implementer shows the full-page 403 state and fetches nothing", async () => {
    const { seen } = await openAudit("implementer");
    const message = await screen.findByText("You can't read the audit log", {}, MAX_WAIT);
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Go to Site configuration" })).toHaveAttribute(
      "href",
      "/admin/config",
    );
    expect(screen.queryByRole("form", { name: "Audit filters" })).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("an implementer on a site with the audit log off gets the 403 state, not a way back to queries", async () => {
    await openAudit("implementer", { flags: { adminAudit: false } });
    expect(await screen.findByText("You can't read the audit log", {}, MAX_WAIT)).toBeVisible();
    expect(screen.queryByText("The audit log is not turned on")).toBeNull();
  });

  it("a typed URL with the feature off shows the full-page 404 state and fetches nothing", async () => {
    const { seen } = await openAudit("admin", { flags: { adminAudit: false } });
    expect(await screen.findByText("The audit log is not turned on", {}, MAX_WAIT)).toBeVisible();
    expect(document.querySelector(".qm-audit__state a")).toHaveAttribute("href", "/");
    expect(seen).toHaveLength(0);
  });
});

describe("loading and filters", () => {
  it("opens on the last 24 hours, announces the count and never row content", async () => {
    const { seen, t } = await openAudit();
    const table = await screen.findByRole("table", {}, MAX_WAIT);
    expect(seen).toHaveLength(1);
    const from = Number(seen[0]?.searchParams.get("from"));
    const to = Number(seen[0]?.searchParams.get("to"));
    expect(to - from).toBeGreaterThanOrEqual(86_400_000 - 1);
    expect(to - from).toBeLessThanOrEqual(86_400_000 + 60_000);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(table).toHaveAccessibleName(/^Audit events, newest first, \d\d-\d\d-\d\d \d\d:\d\d to /);
    const polite = t.services.announcer.current().polite?.text ?? "";
    expect(polite).toBe("3 rows loaded.");
    expect(polite).not.toContain("example");
  });

  it("Apply sends the typed filters; changing a field alone sends nothing", async () => {
    const { seen, t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    const id = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    await t.user.type(screen.getByRole("textbox", { name: "Request ID" }), id);
    await t.user.selectOptions(
      screen.getByRole("combobox", { name: "Event" }),
      "Request viewed by an admin",
    );
    expect(seen).toHaveLength(1);
    await t.user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]?.searchParams.get("correlationId")).toBe(id);
    expect(seen[1]?.searchParams.get("type")).toBe("adminViewed");
  });

  it("a window over 31 days shows the field error and sends nothing", async () => {
    const { seen, t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    const from = screen.getByRole("textbox", { name: "From" });
    await t.user.clear(from);
    await t.user.type(from, "01-01-26 00:00");
    await t.user.click(screen.getByRole("button", { name: "Apply filters" }));
    const to = screen.getByRole("textbox", { name: /^To/ });
    expect(to).toBeInvalid();
    expect(screen.getByText("Window can span at most 31 days.")).toBeInTheDocument();
    expect(seen).toHaveLength(1);
    // Focus goes to the bad field, and the table keeps the last applied filters.
    await waitFor(() => expect(to).toHaveFocus());
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export NDJSON" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("Fix the filters above to export.")).toBeInTheDocument();
  });

  it("names a bad request ID and does not send it", async () => {
    const { seen, t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    await t.user.type(screen.getByRole("textbox", { name: "Request ID" }), "nope");
    await t.user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(screen.getByRole("textbox", { name: "Request ID" })).toBeInvalid();
    expect(seen).toHaveLength(1);
  });
});

describe("paging", () => {
  it("Older and Newer walk a cursor stack and keep focus on the button used", async () => {
    const { seen, t } = await openAudit("admin", {
      pages: (url) => {
        const cursor = url.searchParams.get("cursor");
        if (cursor === null) return HttpResponse.json(auditPage(2, "c-2", 10));
        if (cursor === "c-2") return HttpResponse.json(auditPage(2, "c-3", 20));
        return HttpResponse.json(auditPage(1, null, 30));
      },
    });
    await screen.findByRole("table", {}, MAX_WAIT);
    const older = screen.getByRole("button", { name: "Older" });
    const newer = screen.getByRole("button", { name: "Newer" });
    expect(newer).toHaveAttribute("aria-disabled", "true");
    expect(newer).toHaveAccessibleDescription("This is the newest page.");
    await t.user.click(older);
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]?.searchParams.get("cursor")).toBe("c-2");
    expect(older).toHaveFocus();
    await t.user.click(older);
    await waitFor(() => expect(seen).toHaveLength(3));
    expect(seen[2]?.searchParams.get("cursor")).toBe("c-3");
    await waitFor(() => expect(older).toHaveAttribute("aria-disabled", "true"));
    // The reason for a disabled end is read from a hidden line (design v6).
    expect(older).toHaveAccessibleDescription("There are no older events in this window.");
    await t.user.click(newer);
    await waitFor(() => expect(seen).toHaveLength(4));
    expect(seen[3]?.searchParams.get("cursor")).toBe("c-2");
    expect(newer).toHaveFocus();
    expect(screen.getByRole("navigation", { name: "Audit pages" })).toHaveTextContent(
      "2 rows on this page, newest first.",
    );
  });

  it("Rows per page reloads from the first page with the new limit", async () => {
    const { seen, t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    await t.user.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "100");
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]?.searchParams.get("limit")).toBe("100");
    expect(seen[1]?.searchParams.has("cursor")).toBe(false);
  });
});

describe("paging reset", () => {
  it("Rows per page on a later page returns to the first page", async () => {
    const { seen, t } = await openAudit("admin", {
      pages: (url) =>
        HttpResponse.json(
          url.searchParams.get("cursor") === null
            ? auditPage(2, "c-2", 10)
            : auditPage(2, null, 20),
        ),
    });
    await screen.findByRole("table", {}, MAX_WAIT);
    await t.user.click(screen.getByRole("button", { name: "Older" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    await t.user.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "25");
    await waitFor(() => expect(seen).toHaveLength(3));
    expect(seen.at(-1)?.searchParams.get("limit")).toBe("25");
    expect(seen.at(-1)?.searchParams.has("cursor")).toBe(false);
  });
});

describe("rows", () => {
  it("shows the event in words, an unknown type raw, and the stored details", async () => {
    await openAudit("admin", {
      pages: () =>
        HttpResponse.json({
          events: [
            {
              ...auditPage(1, null).events[0],
              id: 1,
              type: "futureEvent",
              details: { queryType: "VEH", rowCount: 2 },
            },
            { ...auditPage(1, null).events[0], id: 2, type: "adminViewed", details: {} },
          ],
          nextCursor: null,
        }),
    });
    const table = await screen.findByRole("table", {}, MAX_WAIT);
    expect(within(table).getByText("futureEvent")).toBeInTheDocument();
    expect(within(table).getByText("Request viewed by an admin")).toBeInTheDocument();
    expect(within(table).getByText("No details")).toBeInTheDocument();
    const summary = within(table).getByText("2 items");
    expect(summary.closest("details")).toHaveTextContent("queryType");
    expect(summary.closest("details")).toHaveTextContent("VEH");
    const link = within(table).getAllByRole("link")[0];
    expect(link).toHaveAttribute("href", "/admin/queries/0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
    // Each link and disclosure says which row it belongs to (design v6, hidden text).
    expect(link).toHaveAccessibleName("2e3f4a5b, open this request");
    expect(summary.closest("summary")).toHaveAccessibleName(
      /^2 items for futureEvent at \d\d-\d\d-\d\d \d\d:\d\d:\d\d$/,
    );
  });

  it("an empty page says so and offers Reset filters, which hands focus to the form's Reset", async () => {
    const { t } = await openAudit("admin", { pages: () => HttpResponse.json(auditPage(0, null)) });
    expect(await screen.findByText("No audit events match", {}, MAX_WAIT)).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset" })).toHaveFocus());
  });
});

describe("error states", () => {
  it.each([
    [403, "You can't read the audit log"],
    [404, "The audit log is not turned on"],
    [400, "The server did not accept these filters. Check the window and the IDs."],
  ])("a server %i shows its state", async (status, text) => {
    await openAudit("admin", { pages: () => HttpResponse.json({}, { status }) });
    const message = await screen.findByText(text, {}, MAX_WAIT);
    // A 404 is a plain state; the others are alerts.
    expect(message.closest('[role="alert"]') !== null).toBe(status !== 404);
  });

  it("a server error shows Try again, which fetches again with the filters kept", async () => {
    let calls = 0;
    const { seen, t } = await openAudit("admin", {
      pages: () =>
        ++calls === 1
          ? HttpResponse.json({}, { status: 500 })
          : HttpResponse.json(auditPage(1, null)),
    });
    const message = await screen.findByText("The audit log did not load", {}, MAX_WAIT);
    const alert = message.closest<HTMLElement>('[role="alert"]') as HTMLElement;
    await t.user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("table", {}, MAX_WAIT);
    // The button left with the error: focus goes to the results region (design v6).
    expect(document.querySelector(".qm-audit__body")).toHaveFocus();
    expect(seen).toHaveLength(2);
    expect(seen[1]?.searchParams.get("from")).toBe(seen[0]?.searchParams.get("from"));
  });
});

describe("export", () => {
  it("states the filters it will use and saves a file for them", async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
    const exported: URL[] = [];
    server.use(
      http.get(`${AUDIT}/export`, ({ request }) => {
        exported.push(new URL(request.url));
        return new HttpResponse('{"id":1}\n', {
          headers: { "content-disposition": 'attachment; filename="audit.ndjson"' },
        });
      }),
    );
    const { seen, t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    expect(
      screen.getByText(
        /^Exports every row for: any user, any event, \d\d-\d\d-\d\d \d\d:\d\d to \d\d-\d\d-\d\d \d\d:\d\d\. One JSON object per line\.$/,
      ),
    ).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: "Export NDJSON" }));
    await screen.findByText("Export saved.");
    expect(clicked).toEqual(["audit.ndjson"]);
    expect(exported[0]?.searchParams.get("from")).toBe(seen[0]?.searchParams.get("from"));
    expect(exported[0]?.searchParams.get("to")).toBe(seen[0]?.searchParams.get("to"));
    expect(exported[0]?.searchParams.has("cursor")).toBe(false);
  });
});

describe("after a failed fetch", () => {
  it("never shows the earlier rows under the new window's caption", async () => {
    let calls = 0;
    const { t } = await openAudit("admin", {
      pages: () =>
        ++calls === 1
          ? HttpResponse.json(auditPage(2, null))
          : HttpResponse.json({}, { status: 500 }),
    });
    await screen.findByRole("table", {}, MAX_WAIT);
    await t.user.click(screen.getByRole("button", { name: "Apply filters" }));
    await screen.findByText("The audit log did not load", {}, MAX_WAIT);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Audit pages" })).toBeNull();
  });

  it("a server 403 after the page opened is the full-page state, with no filter form", async () => {
    let calls = 0;
    const { t } = await openAudit("admin", {
      pages: () =>
        ++calls === 1
          ? HttpResponse.json(auditPage(1, null))
          : HttpResponse.json({}, { status: 403 }),
    });
    await screen.findByRole("table", {}, MAX_WAIT);
    await t.user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("You can't read the audit log", {}, MAX_WAIT)).toBeVisible();
    expect(screen.queryByRole("form", { name: "Audit filters" })).toBeNull();
  });
});

describe("pager details", () => {
  it("an empty first page has no pager", async () => {
    await openAudit("admin", { pages: () => HttpResponse.json(auditPage(0, null)) });
    await screen.findByText("No audit events match", {}, MAX_WAIT);
    expect(screen.queryByRole("navigation", { name: "Audit pages" })).toBeNull();
  });

  it("on a single page each end names its own reason", async () => {
    await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    expect(screen.getByRole("button", { name: "Newer" })).toHaveAccessibleDescription(
      "This is the newest page.",
    );
    expect(screen.getByRole("button", { name: "Older" })).toHaveAccessibleDescription(
      "There are no older events in this window.",
    );
  });
});

describe("StrictMode", () => {
  it("opening sends one request (one auditViewed row)", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user: { ...TEST_USER, role: "admin" } }),
      ),
      http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
      http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json({ users: [] })),
      http.get(AUDIT, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(auditPage(1, null));
      }),
    );
    // Back from a request view mounts the page with its filters already applied: that is the open
    // a StrictMode effect pass would send twice.
    const services = testServices();
    const form = {
      user: "",
      correlationId: "",
      type: "",
      from: "10-17-26 00:00",
      to: "10-18-26 00:00",
    };
    auditStore(services).set({ form, applied: validateAuditForm(form).filters });
    render(
      <StrictMode>
        <Root
          services={services}
          clientVersion="0.1.0"
          createRouter={(routes) =>
            createMemoryRouter(routes, { initialEntries: ["/admin/audit"] })
          }
        />
      </StrictMode>,
    );
    await screen.findByRole("table", {}, MAX_WAIT);
    expect(seen).toHaveLength(1);
  });
});

describe("export in flight", () => {
  it("a second click while an export runs sends nothing (one auditExported row)", async () => {
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.get(`${AUDIT}/export`, async () => {
        calls += 1;
        await gate;
        return new HttpResponse("", { headers: { "content-type": "application/x-ndjson" } });
      }),
    );
    const { t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    const button = screen.getByRole("button", { name: "Export NDJSON" });
    await t.user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    await t.user.click(button);
    release();
    await screen.findByText("Export saved.");
    expect(calls).toBe(1);
  });
});

describe("filter errors", () => {
  it("announces the count and the first message, never typed text", async () => {
    const { t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    await t.user.type(screen.getByRole("textbox", { name: "Request ID" }), "secret-typed-text");
    await t.user.click(screen.getByRole("button", { name: "Apply filters" }));
    const polite = t.services.announcer.current().polite?.text ?? "";
    expect(polite).toBe(
      "1 filter needs attention. Enter a request ID like 0192f3a1-7c2e-7b10-9a4c-5d3e8f1a2b4c.",
    );
    expect(polite).not.toContain("secret");
  });
});

describe("regulated data (spec 6.7)", () => {
  it("keeps the filters out of storage, and the recorded line is shown", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    await t.user.type(
      screen.getByRole("textbox", { name: "Request ID" }),
      "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    );
    await t.user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(setItem).not.toHaveBeenCalled();
    expect(
      screen.getByText("Viewing and exporting the audit log is recorded."),
    ).toBeInTheDocument();
  });

  it("draws the download icon on Export and the eye on the recorded line, hidden from the reader (mockup v6, #774)", async () => {
    await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    const exportButton = screen.getByRole("button", { name: "Export NDJSON" });
    expect(exportButton.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const recorded = screen.getByText("Viewing and exporting the audit log is recorded.");
    expect(recorded.closest(".qm-audit__recorded")?.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("a sign-out empties the filters and the rows", async () => {
    const { t } = await openAudit();
    await screen.findByRole("table", {}, MAX_WAIT);
    await t.user.type(screen.getByRole("textbox", { name: "Request ID" }), "x");
    t.services.reset.resetAll();
    const { auditStore } = await import("./audit-store.js");
    expect(auditStore(t.services).getState().form).toBeNull();
  });
});
