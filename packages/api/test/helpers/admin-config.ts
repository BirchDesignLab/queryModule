import { resolve } from "node:path";
import {
  type ApiError,
  ApiErrorSchema,
  type ConfigDocument,
  ConfigDocumentSchema,
  type Role,
} from "@querymodule/core/contracts";
import { grantRole } from "../../src/ops/grant-role";
import { createTestApp } from "./test-app";

/** The default site with every feature flag on, adminConfig included (ADR-0011). */
export const ALL_ON = resolve(import.meta.dirname, "../../../config/test/all-on.json");
const PASSWORD = "correct-horse-battery-1";

export type Caller = Role | "anonymous";
export const API = "/api/v1/admin/config";

/**
 * The assembled app with one signed-in user per role (created on first use) and a caller-aware
 * request helper that sends X-Requested-With. Call inside it() only (createTestApp).
 */
export async function adminConfigApp(o: { siteConfig?: string; env?: NodeJS.ProcessEnv } = {}) {
  const t = await createTestApp({ env: { SITE_CONFIG: o.siteConfig ?? ALL_ON, ...o.env } });
  const cookies = new Map<Role, string>();
  const ids = new Map<Role, string>();
  async function signedIn(role: Role): Promise<string> {
    const have = cookies.get(role);
    if (have) return have;
    const email = `${role.toLowerCase()}@example.test`;
    ids.set(role, await t.createUser(email, PASSWORD));
    if (role !== "user") await grantRole(t.deps, { email, role, change: "granted" });
    const cookie = await t.cookieFor(email, PASSWORD);
    cookies.set(role, cookie);
    return cookie;
  }
  async function call(
    who: Caller,
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = { "x-requested-with": "querymodule", ...extra };
    if (who !== "anonymous") headers.cookie = await signedIn(who);
    if (body !== undefined) headers["content-type"] = "application/json";
    return t.request(path, {
      method,
      headers,
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  }
  async function userId(role: Role): Promise<string> {
    await signedIn(role);
    const id = ids.get(role);
    if (!id) throw new Error(`no ${role} user`);
    return id;
  }
  async function exportVersion(version: number): Promise<ConfigDocument> {
    const r = await call("admin", "GET", `${API}/versions/${version}/export`);
    if (r.status !== 200) throw new Error(`export ${version}: ${r.status}`);
    return ConfigDocumentSchema.parse(await r.json());
  }
  async function versionRows() {
    const r = await t.deps.db.$client.execute(
      "SELECT version, status, document, config_hash, base_version, rollback_of, created_by, published_by FROM site_config_version ORDER BY version",
    );
    return r.rows.map((x) => ({
      version: Number(x.version),
      status: String(x.status),
      document: String(x.document),
      configHash: x.config_hash === null ? null : String(x.config_hash),
      baseVersion: x.base_version === null ? null : Number(x.base_version),
      rollbackOf: x.rollback_of === null ? null : Number(x.rollback_of),
      createdBy: String(x.created_by),
      publishedBy: x.published_by === null ? null : String(x.published_by),
    }));
  }
  return { t, call, userId, exportVersion, versionRows };
}
export type AdminConfigApp = Awaited<ReturnType<typeof adminConfigApp>>;

export async function errorOf(r: Response): Promise<ApiError["error"]> {
  return ApiErrorSchema.parse(await r.json()).error;
}

/** A deep copy of `doc` with `edit` applied to its siteConfig (plain JSON). */
export function withSiteConfig(
  doc: ConfigDocument,
  edit: (siteConfig: Record<string, unknown>) => void,
): ConfigDocument {
  const copy = structuredClone(doc);
  edit(copy.siteConfig);
  return copy;
}
