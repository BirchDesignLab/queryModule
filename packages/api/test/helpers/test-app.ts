import { createApp } from "../../src/app";
import { sessionCookieName } from "../../src/auth/auth";
import { createLocalUser } from "../../src/auth/users";
import { buildDeps } from "../../src/deps";
import { createTestClock, TEST_SECRETS, type TestClock, testEnv } from "./fixture";

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
  };
}
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
