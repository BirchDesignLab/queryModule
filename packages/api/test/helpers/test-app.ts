import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/app";
import { sessionCookieName } from "../../src/auth/auth";
import { createLocalUser } from "../../src/auth/users";
import { buildDeps } from "../../src/deps";
import { attachWebSocket } from "../../src/ws/server";
import {
  closeWhenTestFinishes,
  createTestClock,
  TEST_SECRETS,
  type TestClock,
  testEnv,
} from "./fixture";

/** The assembled app on a fresh database, closed when the test finishes. Call inside it() only. */
export async function createTestApp(o: { env?: NodeJS.ProcessEnv; clock?: TestClock } = {}) {
  const env = testEnv(o.env);
  const clock = o.clock ?? createTestClock();
  const logLines: string[] = [];
  const deps = await buildDeps({
    env,
    secrets: TEST_SECRETS,
    clock,
    logSink: (l) => logLines.push(l),
  });
  closeWhenTestFinishes(deps.db, "createTestApp");
  const app = createApp(deps);
  const request = (path: string, init: RequestInit = {}) =>
    Promise.resolve(
      app.request(path, {
        ...init,
        headers: {
          origin: env.publicOrigin,
          ...(init.headers as Record<string, string> | undefined),
        },
      }),
    );
  const signIn = (email: string, password: string, headers: Record<string, string> = {}) =>
    request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email, password }),
    });
  return {
    app,
    deps,
    env,
    clock,
    logLines,
    request,
    signIn,
    createUser: async (email: string, password: string) =>
      (await createLocalUser(deps.auth, { email, name: "Test User", password })).id,
    async cookieFor(email: string, password: string) {
      const r = await signIn(email, password);
      const c = r.headers.getSetCookie().find((s) => s.startsWith(`${sessionCookieName(env)}=`));
      if (!c) throw new Error(`sign-in failed: ${r.status}`);
      return c.split(";")[0] ?? "";
    },
    async auditRows(type: string) {
      const rows = (
        await deps.db.$client.execute({
          sql: "SELECT id, actor_user_id, details FROM audit_event WHERE type = ? ORDER BY id",
          args: [type],
        })
      ).rows;
      return rows.map((r) => ({
        id: Number(r.id),
        actorUserId: String(r.actor_user_id),
        details: JSON.parse(String(r.details)) as Record<string, unknown>,
      }));
    },
    async sessionUpdatedAt(userId: string) {
      const rows = (
        await deps.db.$client.execute({
          sql: "SELECT updated_at FROM session WHERE user_id = ?",
          args: [userId],
        })
      ).rows;
      return Number(rows[0]?.updated_at ?? 0);
    },
  };
}
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** Serves `t.app` on a real port and attaches the WebSocket handler, for socket-level tests. */
export async function startTestServer(t: TestApp, o: { idleMs?: number } = {}) {
  const server = serve({ fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
  if (!server.listening) await once(server, "listening");
  const ws = attachWebSocket(server, t.deps, o);
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/api/v1/ws`,
    close: async () => {
      await ws.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
