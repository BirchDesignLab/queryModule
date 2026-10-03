import { describe, expect, it } from "vitest";
import { adminConfigBody, CLIENT_CONFIG, RAW_SITE } from "../test/msw-server.js";
import { documentFrom, editorOf, startOf } from "./admin-config.js";
import { docFromClient, type JsonObject } from "./draft.js";

// Task 33 part 2a (#358, BR-001): the builder edits the client-shaped view of the server draft's
// siteConfig; server-only sections ride along untouched when the draft is saved back.

describe("editorOf (the server document to the builder's draft)", () => {
  it("projects the raw site config to the same view the client config gives", () => {
    const { doc, labels } = editorOf({ siteConfig: RAW_SITE, locales: {} });
    expect(doc).toEqual(docFromClient(CLIENT_CONFIG));
    expect(labels).toEqual({});
  });

  it("carries the version's locale overlay as the draft's labels", () => {
    const { labels } = editorOf({ siteConfig: RAW_SITE, locales: { en: { "site.x": "X" } } });
    expect(labels).toEqual({ en: { "site.x": "X" } });
  });

  it("still projects a siteConfig that does not validate (a draft may be invalid)", () => {
    const broken = { ...RAW_SITE, terminal: { delimiter: 5 } };
    const { doc } = editorOf({ siteConfig: broken, locales: {} });
    expect((doc.terminal as JsonObject).delimiter).toBe(5);
    expect(doc.queryTypes).toEqual(RAW_SITE.queryTypes);
    expect(doc).not.toHaveProperty("auth");
  });
});

describe("documentFrom (the builder's draft back to a server document)", () => {
  const base = { siteConfig: RAW_SITE, locales: {} };

  it("an untouched draft saves back the base siteConfig exactly", () => {
    const { doc, labels } = editorOf(base);
    expect(documentFrom(base, doc, labels)).toEqual(base);
  });

  it("applies an edit and keeps the server-only sections", () => {
    const { doc, labels } = editorOf(base);
    const next = { ...doc, terminal: { delimiter: ";" } };
    const out = documentFrom(base, next, labels);
    expect(out.siteConfig.terminal).toEqual({ delimiter: ";" });
    expect(out.siteConfig.auth).toEqual(RAW_SITE.auth);
    expect(out.siteConfig.retention).toEqual(RAW_SITE.retention);
    expect(out.siteConfig.delegation).toEqual(RAW_SITE.delegation);
    expect(out.siteConfig.sources).toEqual(RAW_SITE.sources);
  });

  it("an edited source keeps its server-only settings; a new one is a mock source", () => {
    const { doc, labels } = editorOf(base);
    const sources = doc.sources as JsonObject[];
    const next = {
      ...doc,
      sources: [
        { ...sources[0], timeoutMs: 1234 },
        ...sources.slice(1),
        {
          id: "extra",
          labelKey: "source.extra",
          scope: "state",
          timeoutMs: 100,
          requiresCredentials: false,
        },
      ],
    };
    const out = documentFrom(base, next, labels).siteConfig.sources as JsonObject[];
    const first = (RAW_SITE.sources as JsonObject[])[0] as JsonObject;
    expect(out[0]).toEqual({ ...first, timeoutMs: 1234 });
    expect(out.at(-1)).toMatchObject({ id: "extra", kind: "mock" });
  });

  it("an edited delegation purpose keeps its role list", () => {
    const { doc, labels } = editorOf(base);
    const delegation = doc.delegation as { purposes: JsonObject[]; maxDurationMinutes: number };
    const next = { ...doc, delegation: { ...delegation, maxDurationMinutes: 60 } };
    const out = documentFrom(base, next, labels).siteConfig.delegation as JsonObject;
    expect(out.maxDurationMinutes).toBe(60);
    expect(out.purposes).toEqual((RAW_SITE.delegation as JsonObject).purposes);
  });

  it("writes the label overlay and drops locales with no labels", () => {
    const { doc } = editorOf(base);
    const out = documentFrom(base, doc, { en: { "site.x": "X" }, fr: {} });
    expect(out.locales).toEqual({ en: { "site.x": "X" } });
  });

  it("keeps the mock section of the base document", () => {
    const withMock = { ...base, mock: { responses: [] } };
    const { doc, labels } = editorOf(withMock);
    expect(documentFrom(withMock, doc, labels).mock).toEqual({ responses: [] });
  });

  it("a key the raw tab added outside the client view goes through for the server to judge", () => {
    const { doc, labels } = editorOf(base);
    const out = documentFrom(base, { ...doc, surprise: 1 }, labels);
    expect(out.siteConfig.surprise).toBe(1);
  });
});

describe("startOf (what the builder opens on)", () => {
  const withDraft = (baseVersion: number) => {
    const body = adminConfigBody({
      liveVersion: 3,
      draft: { version: 4, siteConfig: { ...RAW_SITE, terminal: { delimiter: ";" } } },
    });
    return startOf({ ...body, draft: { ...body.draft, baseVersion } } as never, {});
  };

  it("opens on the live version when there is no draft", () => {
    const start = startOf(adminConfigBody({ liveVersion: 3 }) as never);
    expect(start.server).toMatchObject({ baseVersion: 3, draftVersion: null });
    expect(start.doc).toEqual(start.server.liveDoc);
    expect(start.server.savedDoc).toBe(start.doc);
  });

  it("opens on the draft, based on the live version the draft says", () => {
    const start = withDraft(3);
    expect((start.doc.terminal as JsonObject).delimiter).toBe(";");
    expect(start.server).toMatchObject({ baseVersion: 3, draftVersion: 4 });
    expect((start.server.liveDoc.terminal as JsonObject).delimiter).toBe(".");
  });

  it("a draft based on an older version still opens (its work is not lost), keeping its old base", () => {
    expect(withDraft(2).server).toMatchObject({ baseVersion: 2, draftVersion: 4 });
  });

  it("after a conflict, a stale draft is not offered again: the live version loads", () => {
    const body = adminConfigBody({
      liveVersion: 3,
      draft: { version: 4, siteConfig: { ...RAW_SITE, terminal: { delimiter: ";" } } },
    });
    const stale = { ...body, draft: { ...body.draft, baseVersion: 2 } };
    const start = startOf(stale as never, { preferLive: true });
    expect(start.server).toMatchObject({ baseVersion: 3, draftVersion: null });
    expect((start.doc.terminal as JsonObject).delimiter).toBe(".");
    // A current draft is kept.
    expect(startOf(withDraftBody(), { preferLive: true }).server.draftVersion).toBe(4);
  });
});

function withDraftBody() {
  return adminConfigBody({
    liveVersion: 3,
    draft: { version: 4, siteConfig: RAW_SITE },
  }) as never;
}

describe("startOf carries the site id (export file names)", () => {
  it("takes it from the admin config response", () => {
    expect(startOf(adminConfigBody()).server.siteId).toBe("default");
  });
});
