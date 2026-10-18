import { type ClientPlatform, createApiClient } from "@querymodule/client";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API, adminDetail202, auditPage, server } from "../test/msw-server.js";
import {
  type AuditFilters,
  downloadAuditExport,
  fetchAdminQuery,
  fetchAuditPage,
  REVOKE_DELAY_MS,
} from "./audit-api.js";

const signal = { current: () => true, subscribe: () => () => undefined };
const platform: ClientPlatform = {
  authTransport: "cookie",
  tokenStore: null,
  online: signal,
  visible: signal,
};
const api = createApiClient({ baseUrl: API, platform, onUnauthenticated: () => undefined });

const FROM = Date.UTC(2026, 9, 17, 0, 0, 0);
const DAY = 86_400_000;
const FILTERS: AuditFilters = { from: FROM, to: FROM + DAY };
const ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const AUDIT = `${API}/api/v1/admin/audit`;
const EXPORT = `${API}/api/v1/admin/audit/export`;
const QUERY = `${API}/api/v1/admin/queries/:id`;

const REAL_URL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  URL.createObjectURL = REAL_URL.create;
  URL.revokeObjectURL = REAL_URL.revoke;
});

/** Records the `download` name of each anchor click instead of navigating. */
function recordClicks(): { download: string; href: string }[] {
  const clicked: { download: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href });
  });
  return clicked;
}

describe("fetchAuditPage", () => {
  it("parses a page and sends only the filters, cursor and limit as query", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(AUDIT, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(auditPage(3, "cursor-2"));
      }),
    );
    const page = await fetchAuditPage(
      api,
      { ...FILTERS, user: "user-0001", correlationId: ID, type: "acknowledged" },
      "cursor-1",
      50,
    );
    expect(page).toMatchObject({ nextCursor: "cursor-2" });
    expect("events" in page && page.events).toHaveLength(3);
    expect(Object.fromEntries(seen[0]?.searchParams ?? [])).toEqual({
      user: "user-0001",
      correlationId: ID,
      type: "acknowledged",
      from: String(FROM),
      to: String(FROM + DAY),
      cursor: "cursor-1",
      limit: "50",
    });
  });

  it("omits empty filters and no cursor on the first page", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(AUDIT, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(auditPage(0, null));
      }),
    );
    await fetchAuditPage(api, FILTERS);
    expect([...(seen[0]?.searchParams.keys() ?? [])].sort()).toEqual(["from", "to"]);
  });

  it.each([
    [400, "validation"],
    [403, "forbidden"],
    [404, "notFound"],
    [500, "failed"],
  ] as const)("maps status %i to %s", async (status, kind) => {
    server.use(http.get(AUDIT, () => HttpResponse.json({}, { status })));
    expect(await fetchAuditPage(api, FILTERS)).toEqual({ kind });
  });

  it("is failed for a body that does not parse, and for a network error", async () => {
    server.use(http.get(AUDIT, () => HttpResponse.json({ nope: 1 })));
    expect(await fetchAuditPage(api, FILTERS)).toEqual({ kind: "failed" });
    server.use(http.get(AUDIT, () => HttpResponse.error()));
    expect(await fetchAuditPage(api, FILTERS)).toEqual({ kind: "failed" });
  });

  it("sends no X-Background header (a user action)", async () => {
    let background: string | null = "unset";
    server.use(
      http.get(AUDIT, ({ request }) => {
        background = request.headers.get("x-background");
        return HttpResponse.json(auditPage(0, null));
      }),
    );
    await fetchAuditPage(api, FILTERS);
    expect(background).toBeNull();
  });
});

describe("fetchAdminQuery", () => {
  it("parses the detail and sends includeHidden", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(QUERY, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(adminDetail202());
      }),
    );
    const detail = await fetchAdminQuery(api, ID, false);
    expect(detail).toMatchObject({ correlationId: ID });
    expect(seen[0]?.pathname).toBe(`/api/v1/admin/queries/${ID}`);
    expect(seen[0]?.searchParams.get("includeHidden")).toBe("false");
  });

  it("maps 404 to notFound and 403 to forbidden", async () => {
    server.use(http.get(QUERY, () => HttpResponse.json({}, { status: 404 })));
    expect(await fetchAdminQuery(api, ID, false)).toEqual({ kind: "notFound" });
    server.use(http.get(QUERY, () => HttpResponse.json({}, { status: 403 })));
    expect(await fetchAdminQuery(api, ID, false)).toEqual({ kind: "forbidden" });
  });
});

describe("downloadAuditExport", () => {
  it("saves one file named as the header says and revokes its URL after the click", async () => {
    const seen: URL[] = [];
    const body = '{"id":1}\n{"id":2}\n';
    server.use(
      http.get(EXPORT, ({ request }) => {
        seen.push(new URL(request.url));
        return new HttpResponse(body, {
          headers: {
            "content-type": "application/x-ndjson",
            "content-disposition": 'attachment; filename="audit-2026-10-17.ndjson"',
          },
        });
      }),
    );
    const create = vi.fn(() => "blob:audit-1");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    const clicked = recordClicks();
    expect(await downloadAuditExport(api, { ...FILTERS, type: "acknowledged" })).toBe(true);
    expect(clicked).toEqual([{ download: "audit-2026-10-17.ndjson", href: "blob:audit-1" }]);
    expect(Object.fromEntries(seen[0]?.searchParams ?? [])).toEqual({
      type: "acknowledged",
      from: String(FROM),
      to: String(FROM + DAY),
    });
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toBe(body);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revoke).toHaveBeenCalledWith("blob:audit-1");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("falls back to a safe name when the header names an unsafe one", async () => {
    server.use(
      http.get(
        EXPORT,
        () =>
          new HttpResponse("", {
            headers: { "content-disposition": 'attachment; filename="../../evil name.sh"' },
          }),
      ),
    );
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
    const clicked = recordClicks();
    await downloadAuditExport(api, FILTERS);
    expect(clicked.map((c) => c.download)).toEqual(["audit-export.ndjson"]);
  });

  it("returns false and saves nothing on an error status", async () => {
    server.use(http.get(EXPORT, () => HttpResponse.json({}, { status: 400 })));
    const create = vi.fn();
    Object.assign(URL, { createObjectURL: create });
    expect(await downloadAuditExport(api, FILTERS)).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("no persistence (spec 6.7)", () => {
  it("writes nothing to localStorage or sessionStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    server.use(http.get(AUDIT, () => HttpResponse.json(auditPage(2, null))));
    await fetchAuditPage(api, FILTERS);
    await fetchAdminQuery(api, ID, false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
