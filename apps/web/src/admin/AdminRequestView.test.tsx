import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Root } from "../app/Root.js";
import {
  ACK_202,
  API,
  adminDetail202,
  auditPage,
  CLIENT_CONFIG,
  server,
  TEST_USER,
} from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { testServices } from "../test/render-routes.js";

beforeAll(preloadAdminRoutes);
afterEach(() => vi.restoreAllMocks());

// Task 4 (#727, FR-063, SEC-012; spec 5.1, 6.2, 6.7): the admin request view. Read only, recorded,
// one fetch per open. Fixtures are synthetic.

const ID = ACK_202.correlationId;
const MAX_WAIT = { timeout: 5000 };
const STOLEN = { status: "STOLEN", plate: "ZZ-0001", remarks: "STOLEN VEHICLE" };

async function openView(options: { role?: string; detail?: () => Response; id?: string } = {}) {
  const user = { ...TEST_USER, role: options.role ?? "admin" };
  const seen: URL[] = [];
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json({ users: [] })),
    http.get(`${API}/api/v1/admin/audit`, () => HttpResponse.json(auditPage(2, null))),
    http.get(`${API}/api/v1/admin/queries/:id`, ({ request }) => {
      seen.push(new URL(request.url));
      return (
        options.detail?.() ??
        HttpResponse.json(
          adminDetail202({
            sources: [
              { sourceId: "stateSource", status: "returned", payload: STOLEN },
              { sourceId: "nationalSource", status: "returned", payload: { status: "NO RECORD" } },
            ],
            values: { plate: "ZZ-0001" },
          }),
        )
      );
    }),
  );
  const t = renderRoot({ path: `/admin/queries/${options.id ?? ID}` });
  return { seen, t };
}

describe("a settled request", () => {
  it("shows the recorded banner first, the cards with severity badges, and one fetch", async () => {
    const { seen } = await openView();
    const card = await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    expect(within(card).getByText("Critical")).toBeVisible();
    expect(card.querySelector("mark")).toHaveTextContent("STOLEN");
    expect(
      within(screen.getByRole("region", { name: "National system: returned" })).getByText("Info"),
    ).toBeVisible();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.searchParams.get("includeHidden")).toBe("false");
    // The banner sits before the content, so it is read first.
    const banner = screen.getByText("This view is recorded in the audit log.");
    expect(banner.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws the entry as the query screen does: heading, breadcrumb, command, badge, meta, Copy ID", async () => {
    await openView();
    await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    expect(screen.getByRole("heading", { level: 2, name: /^Request 2e3f4a5b$/ })).toBeVisible();
    // The page heading names the one request, so the list draws none of its own (#754): the list is
    // still a named region, and the entry's own h3 stands between the page's h2 and the cards' h4.
    expect(screen.queryByRole("heading", { level: 3, name: "Request" })).toBeNull();
    expect(screen.getByRole("region", { name: "Request" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 3, name: "Vehicle" })).toBeVisible();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Audit log" })).toHaveAttribute(
      "href",
      "/admin/audit",
    );
    const entry = document.querySelector("li.qm-request") as HTMLElement;
    expect(entry.querySelector(".qm-request__summary")).toHaveTextContent("ZZ-0001");
    // The entry head carries the request's highest severity, apart from each card's own badge.
    expect(entry.querySelector(".qm-request__severity")).toHaveTextContent("Critical");
    expect(within(entry).getByText("2e3f4a5b")).toBeVisible();
    // The status line of the mockup (#754): done of total, then the counts.
    expect(entry).toHaveTextContent("2 of 2 sources done. 2 returned.");
    expect(within(entry).getByRole("button", { name: /^Copy reference/ })).toBeVisible();
    expect(screen.getByText("Vehicle query as it was sent and answered. Read only.")).toBeVisible();
    expect(screen.getByText("Your filters are kept.")).toBeVisible();
  });

  it("shows Include hidden results disabled with its reason", async () => {
    await openView();
    await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    const control = screen.getByRole("checkbox", { name: "Include hidden results" });
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).not.toBeChecked();
    expect(screen.getByText("Hide arrives in M3.")).toBeVisible();
  });

  it("sends no further request on a window focus or when the tab becomes visible", async () => {
    const { seen } = await openView();
    await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(seen).toHaveLength(1);
  });

  it("links back to the audit log with its filters kept in memory", async () => {
    const { t } = await openView();
    await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    await t.user.click(screen.getByRole("link", { name: "Back to audit log" }));
    await screen.findByRole("table", {}, MAX_WAIT);
    expect(screen.getByRole("heading", { level: 2, name: "Audit log" })).toBeVisible();
  });
});

describe("other states", () => {
  it.each([404, 400])(
    "a %i says there is no such request, as a plain state with a way back",
    async (status) => {
      await openView({ detail: () => HttpResponse.json({}, { status }) });
      const title = await screen.findByText("No such request", {}, MAX_WAIT);
      expect(title.closest('[role="alert"]')).toBeNull();
      expect(
        screen.getByText(
          "There is no request with this ID. It may be mistyped, or from another site.",
        ),
      ).toBeVisible();
      expect(screen.queryByRole("region", { name: /returned$/ })).toBeNull();
      expect(screen.getAllByRole("link", { name: "Back to audit log" }).length).toBeGreaterThan(0);
      // Nothing was recorded for a request that is not there, so the page does not say it was.
      expect(screen.queryByText("This view is recorded in the audit log.")).toBeNull();
      expect(screen.queryByRole("checkbox", { name: "Include hidden results" })).toBeNull();
    },
  );

  it("a server 403 says access is missing", async () => {
    await openView({ detail: () => HttpResponse.json({}, { status: 403 }) });
    const title = await screen.findByText("You can't read the audit log", {}, MAX_WAIT);
    expect(title.closest('[role="alert"]')).not.toBeNull();
  });

  it("a server error offers Try again, which fetches once more", async () => {
    let calls = 0;
    const { seen, t } = await openView({
      detail: () =>
        ++calls === 1
          ? HttpResponse.json({}, { status: 500 })
          : HttpResponse.json(adminDetail202({ values: {} })),
    });
    const message = await screen.findByText("The request did not load", {}, MAX_WAIT);
    await t.user.click(
      within(message.closest('[role="alert"]') as HTMLElement).getByRole("button", {
        name: "Try again",
      }),
    );
    await waitFor(() => expect(seen).toHaveLength(2));
    // The button left with the error: focus goes to the results region.
    expect(document.querySelector(".qm-request-view__results")).toHaveFocus();
  });

  it("an implementer typing the URL gets the full-page 403 state and fetches nothing", async () => {
    const { seen } = await openView({ role: "implementer" });
    expect(await screen.findByText("You can't read the audit log", {}, MAX_WAIT)).toBeVisible();
    expect(seen).toHaveLength(0);
  });

  it("opening under StrictMode still sends one request (one adminViewed row)", async () => {
    const user = { ...TEST_USER, role: "admin" };
    const seen: URL[] = [];
    server.use(
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user }),
      ),
      http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
      http.get(`${API}/api/v1/admin/queries/:id`, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(adminDetail202({ values: {} }));
      }),
    );
    render(
      <StrictMode>
        <Root
          services={testServices()}
          clientVersion="0.1.0"
          createRouter={(routes) =>
            createMemoryRouter(routes, { initialEntries: [`/admin/queries/${ID}`] })
          }
        />
      </StrictMode>,
    );
    await screen.findByText("This view is recorded in the audit log.", {}, MAX_WAIT);
    await screen.findByRole("region", { name: "Request" }, MAX_WAIT);
    expect(seen).toHaveLength(1);
  });

  it("Back returns focus to the request link that was used", async () => {
    const user = userEvent.setup();
    const { t } = await openView({ id: ID });
    await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    await t.user.click(screen.getByRole("link", { name: "Back to audit log" }));
    await screen.findByRole("table", {}, MAX_WAIT);
    // A first visit through the table: open a request from its row, then come back.
    const link = screen.getAllByRole("link", { name: /open this request$/ })[0] as HTMLElement;
    await user.click(link);
    await screen.findByRole("heading", { level: 2, name: /^Request / }, MAX_WAIT);
    await t.user.click(screen.getByRole("link", { name: "Back to audit log" }));
    await screen.findByRole("table", {}, MAX_WAIT);
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: /open this request$/ })[0]).toHaveFocus(),
    );
  });
});

describe("regulated data (spec 6.7)", () => {
  it("writes nothing to browser storage and drops the payload on leaving", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { t } = await openView();
    await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    await t.user.click(screen.getByRole("link", { name: "Back to audit log" }));
    await screen.findByRole("table", {}, MAX_WAIT);
    expect(screen.queryByText("STOLEN VEHICLE")).toBeNull();
    expect(screen.queryByText("ZZ-0001")).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("a purged request (Task 6, #735; spec 5.5)", () => {
  /** The canned detail with retention applied: payloads gone, and with them the values. */
  const purged = (values: boolean) => () => {
    const base = adminDetail202({
      values: { plate: "ZZ-0001" },
      sources: [
        { sourceId: "stateSource", status: "returned", payload: STOLEN },
        { sourceId: "nationalSource", status: "returned", payload: STOLEN },
      ],
    });
    return HttpResponse.json({
      ...base,
      parts: base.parts.map((part) => ({
        ...part,
        ...(values
          ? { purged: true, values: undefined, typeValues: { plateType: "PASSENGER" } }
          : {}),
        sources: part.sources.map((source) => ({ ...source, purged: true, payload: undefined })),
      })),
    });
  };

  it("draws each purged result as the purged card, with no badge and a status line that says purged", async () => {
    await openView({ detail: purged(false) });
    const card = await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    expect(card).toHaveTextContent("Purged under retention");
    expect(within(card).queryByText("Critical")).toBeNull();
    const entry = document.querySelector("li.qm-request") as HTMLElement;
    expect(entry.querySelector(".qm-request__severity")).toBeNull();
    expect(entry).toHaveTextContent("2 of 2 sources done. 2 returned, 2 purged.");
    // The values survived this time: the command shows.
    expect(entry.querySelector(".qm-request__summary")).toHaveTextContent("ZZ-0001");
  });

  it("with the values purged too it keeps the type values and says the rest are purged", async () => {
    await openView({ detail: purged(true) });
    await screen.findByRole("region", { name: "State system: returned" }, MAX_WAIT);
    const entry = document.querySelector("li.qm-request") as HTMLElement;
    expect(entry.querySelector(".qm-request__summary")).toHaveTextContent("PASSENGER");
    expect(entry).toHaveTextContent("Other values purged under retention");
    expect(entry).not.toHaveTextContent("ZZ-0001");
  });
});
