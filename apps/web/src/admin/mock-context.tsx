import type { MockFile } from "@querymodule/core/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useServices } from "../app/services-context.js";
import { configDraftStore, useDraft } from "./builder-store.js";
import { useLabelText } from "./controls.js";
import type { JsonObject } from "./draft.js";
import { mockIssuesOf } from "./mock-checks.js";
import { parseMock } from "./mock-model.js";
import { type MockSite, mockSiteOf } from "./mock-site.js";

/**
 * What the mock editor's parts share (Task 3a, #549): the parsed mock, the site's sources and query
 * types, plain names for them, one way to write the mock back to the draft, and one way to ask for
 * focus on an element that is not rendered yet (a new response's heading, a new scenario's first
 * trigger). The mock never leaves the admin views: announcements and names carry ids and counts only.
 */

export interface MockEnv {
  mock: MockFile;
  site: MockSite;
  /** Writes the changed mock to the draft; an unchanged mock is not a step. */
  edit(change: (m: MockFile) => MockFile, options?: { coalesce?: string }): void;
  announce(text: string): void;
  /** How many errors the draft's mock has right now (read fresh, for "n errors left"). */
  errorCount(): number;
  sourceName(id: string): string;
  typeName(code: string): string;
  fieldName(code: string, key: string): string;
  codeName(code: string, typeCode: string): string;
}

const MockEnvContext = createContext<MockEnv | null>(null);

export function useMockEnv(): MockEnv {
  const env = useContext(MockEnvContext);
  if (env === null) throw new Error("useMockEnv outside the mock editor");
  return env;
}

/** Elements asked to take focus once they render: [owner, role], matched on data-owner and data-role. */
let pendingFocus: readonly [string, string] | null = null;
export function requestMockFocus(owner: string, role: string): void {
  pendingFocus = [owner, role];
}

/** Takes the pending focus request when its element has rendered. Runs after every render. */
function useMockFocus(): void {
  useEffect(() => {
    if (pendingFocus === null) return;
    const [owner, role] = pendingFocus;
    const el = document.querySelector<HTMLElement>(
      `[data-owner="${CSS.escape(owner)}"][data-role="${role}"]`,
    );
    if (el === null) return;
    pendingFocus = null;
    el.focus();
  });
  // A request nobody took (its element never rendered) must not steal focus later.
  useEffect(
    () => () => {
      pendingFocus = null;
    },
    [],
  );
}

/** The env, or null when the draft has no readable mock (a site without mocks, or a broken file). */
export function useMockEnvValue(doc: JsonObject): MockEnv | null {
  const services = useServices();
  const store = configDraftStore(services);
  const { mock: raw } = useDraft();
  const labelText = useLabelText();
  const site = useMemo(() => mockSiteOf(doc), [doc]);
  const parsed = useMemo(() => (raw === null ? null : parseMock(raw)), [raw]);
  const { announcer } = services;
  const edit = useCallback<MockEnv["edit"]>(
    (change, options) => {
      const now = parseMock(store.getState().mock);
      if (!now.ok) return;
      const next = change(now.mock);
      if (next !== now.mock) store.getState().setMock(next as JsonObject, options);
    },
    [store],
  );
  const env = useMemo<MockEnv | null>(() => {
    if (parsed === null || !parsed.ok) return null;
    const type = (code: string) => site.queryTypes.find((q) => q.code === code);
    return {
      mock: parsed.mock,
      site,
      edit,
      announce: (text) => announcer.announce(text),
      errorCount: () =>
        mockIssuesOf(doc, store.getState().mock).filter((i) => i.level === "error").length,
      sourceName: (id) => labelText(site.sources.find((s) => s.id === id)?.labelKey) || id,
      typeName: (code) => labelText(type(code)?.labelKey) || code,
      fieldName: (code, key) =>
        labelText(type(code)?.fields.find((f) => f.key === key)?.labelKey) || key,
      codeName: (code, typeCode) =>
        labelText(type(typeCode)?.typeField?.codes.find((c) => c.code === code)?.labelKey) || code,
    };
  }, [parsed, site, edit, announcer, labelText, doc, store]);
  useMockFocus();
  return env;
}

export { MockEnvContext };
