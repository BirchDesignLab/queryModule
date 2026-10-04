import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SiteConfigSchema, toClientSiteConfig } from "@querymodule/core/config";
import type { ConfigVersion } from "@querymodule/core/contracts";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { EN_BUNDLE } from "./en-bundle.js";

export const API = "http://localhost:3000";
export const TEST_USER = { id: "user-0001", email: "tester@querymodule.test", role: "user" };
export const TEST_PASSWORD = "fixture-only-pass";
export const META = {
  apiVersion: "v1",
  coreVersion: "0.1.0",
  configSchemaVersion: 1,
  configHash: "0000000000000000000000000000000000000000000000000000000000000001",
  minClientVersion: null,
};

// jsdom's global URL breaks new URL(relative, import.meta.url) here; resolve via node:path (see en-bundle.ts).
const defaultSitePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/config/sites/default.json",
);
/** ClientSiteConfig of the parsed default site, with a fixed hash. */
export const CLIENT_CONFIG = toClientSiteConfig(
  SiteConfigSchema.parse(JSON.parse(readFileSync(defaultSitePath, "utf8"))),
  META.configHash,
);

/** The raw default site file: what an empty config store seeds as version 1 (ADR-0011 item 1). */
export const RAW_SITE: Record<string, unknown> = JSON.parse(readFileSync(defaultSitePath, "utf8"));

const FIXTURE_ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
/** Later versions are later in time, as on a real site. */
const FIXTURE_TIME = Date.UTC(2026, 8, 29, 17, 0, 0);
/** One site_config_version row as the admin API answers it (metadata only, no document). */
export function versionRow(
  version: number,
  status: "draft" | "published" | "superseded",
  over: Partial<ConfigVersion> = {},
): ConfigVersion {
  return {
    id: FIXTURE_ID,
    version,
    status,
    configHash: status === "draft" ? null : "a".repeat(64),
    baseVersion: status === "draft" ? version - 1 : null,
    createdBy: "user-0001",
    createdAt: FIXTURE_TIME + version * 1000,
    publishedBy: status === "draft" ? null : "user-0001",
    publishedAt: status === "draft" ? null : FIXTURE_TIME + version * 1000,
    rollbackOf: null,
    ...over,
  };
}

/** GET /api/v1/admin/config: live version 1 with the default site, and an optional draft. */
export function adminConfigBody(
  options: {
    liveVersion?: number;
    /** The live siteConfig; the default site file when omitted. */
    siteConfig?: Record<string, unknown>;
    draft?: {
      version: number;
      siteConfig: Record<string, unknown>;
      locales?: Record<string, Record<string, string>>;
    } | null;
  } = {},
) {
  const liveVersion = options.liveVersion ?? 1;
  return {
    siteId: "default",
    live: {
      ...versionRow(liveVersion, "published"),
      document: { siteConfig: options.siteConfig ?? RAW_SITE, locales: {} },
    },
    draft:
      options.draft === undefined || options.draft === null
        ? null
        : {
            ...versionRow(options.draft.version, "draft", { baseVersion: liveVersion }),
            document: {
              siteConfig: options.draft.siteConfig,
              locales: options.draft.locales ?? {},
            },
          },
  };
}

/** The contract shape of GET/PUT /api/v1/me/preferences (openapi.json getMePreferences200). */
export const PREFERENCES = {
  layout: { orientation: "horizontal", terminal: "toggle" },
  personaOverride: null,
  themeMode: "night",
} as const;

let signedIn = false;

/** What POST /api/v1/queries received, in order; the body is the parsed JSON. */
export const submitRecorder: { calls: { key: string | null; body: unknown }[] } = { calls: [] };

/** A canned 202 for POST /api/v1/queries (mock data only). */
export const ACK_202 = {
  correlationId: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  acknowledgedAt: Date.UTC(2026, 8, 29, 17, 4, 5),
  parts: [
    {
      partId: 1,
      queryType: "VEH",
      status: "dispatched",
      sourceIds: ["stateSource", "nationalSource"],
      droppedSourceIds: [],
    },
  ],
};

export function resetMswState(): void {
  signedIn = false;
  submitRecorder.calls = [];
}

/** Stand-in for Track A P1 routes until they merge; shapes per spec 5.1 and Better Auth. */
export const server = setupServer(
  http.get(`${API}/api/v1/meta`, () => HttpResponse.json(META)),
  http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
  http.get(`${API}/api/v1/admin/config`, () => HttpResponse.json(adminConfigBody())),
  http.get(`${API}/api/v1/locales/en`, () => HttpResponse.json(EN_BUNDLE)),
  http.get(`${API}/api/v1/auth/get-session`, () =>
    HttpResponse.json(signedIn ? { session: { id: "s1" }, user: TEST_USER } : null),
  ),
  http.post(`${API}/api/v1/auth/sign-in/email`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === TEST_USER.email && body.password === TEST_PASSWORD) {
      signedIn = true;
      return HttpResponse.json({ redirect: false, token: "t", user: TEST_USER });
    }
    return HttpResponse.json(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      { status: 401 },
    );
  }),
  http.post(`${API}/api/v1/auth/sign-out`, () => {
    signedIn = false;
    return HttpResponse.json({ success: true });
  }),
  http.post(`${API}/api/v1/queries`, async ({ request }) => {
    submitRecorder.calls.push({
      key: request.headers.get("idempotency-key"),
      body: await request.json(),
    });
    return HttpResponse.json(ACK_202, { status: 202 });
  }),
  http.get(`${API}/api/v1/me/preferences`, () => HttpResponse.json(PREFERENCES)),
  http.put(`${API}/api/v1/me/preferences`, async ({ request }) =>
    HttpResponse.json(await request.json()),
  ),
);
