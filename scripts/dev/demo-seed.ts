// One-time demo seed: signs in as a demo account (the dispatcher unless DEMO_EMAIL names another
// seeded @example.test account that may query) and submits each demo story once through the normal
// API, so the request list already shows history when the demo opens. Every row is a real, audited
// request. Run once per account against the demo database, then leave it.
//
//   SEED_PASSWORD_SECRET_FILE=<file> node scripts/dev/demo-seed.ts <baseUrl>
//   DEMO_PASSWORD=<password> node scripts/dev/demo-seed.ts <baseUrl>
//   DEMO_EMAIL=admin@example.test DEMO_PASSWORD=<password> node scripts/dev/demo-seed.ts <baseUrl>
//
// The password comes from the environment (DEMO_PASSWORD, or the older DEMO_DISPATCHER_PASSWORD),
// never argv, and is never printed. It refuses to run when the account already has requests. It
// writes nothing but POST /api/v1/queries: no deletes, no resets, no direct database access. Mock
// data only; the values are the synthetic mock triggers.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

export const DEMO_EMAIL = "dispatcher@example.test";
const SOURCES = ["stateSource", "nationalSource"] as const;

export interface DemoStory {
  /** Stable id: names the story in messages and builds its idempotency key. */
  id: string;
  queryType: string;
  values: Readonly<Record<string, string>>;
  sourceIds: readonly string[];
}

const story = (
  id: string,
  queryType: string,
  values: Record<string, string>,
  sourceIds: readonly string[] = SOURCES,
): DemoStory => ({ id, queryType, values, sourceIds });

/**
 * Oldest first, so the list (newest first) opens on the critical vehicle hit. Each story is one
 * line in docs/demo.md "Demo stories".
 */
export const DEMO_STORIES: readonly DemoStory[] = [
  story("veh-timeout", "VEH", { plate: "TIMEOUT", state: "TX", year: "26" }),
  story("veh-partial", "VEH", { plate: "FAIL1", state: "TX", year: "26" }),
  story("dl-zzdltest", "DL", { licenseNumber: "ZZDLTEST", state: "TX" }),
  story("per-hit", "PER", { last: "EXAMPLESON", first: "SAMPLE", dob: "01011901", state: "TX" }),
  story("pro-stolen", "PRO", {
    serial: "ZZSTOLEN1",
    propertyType: "ELECTRONICS",
    state: "TX",
    agency: "EXAMPLEPD",
  }),
  // Wanted checks go to the national system only (the WNT query type lists no other source).
  story("wnt-wanted", "WNT", { last: "WANTED" }, ["nationalSource"]),
  story("veh-no-record", "VEH", { plate: "ABC123", state: "TX", year: "26" }),
  story("veh-calm-hit", "VEH", { plate: "ZZ-0010", state: "TX", year: "26" }),
  story("veh-stolen", "VEH", { plate: "ZZ-0001", state: "TX", year: "26" }),
];

/** base64url(HMAC-SHA256(trimmed secret, lowercase email)), as scripts/ops/smoke.sh derives it. */
export function demoPassword(secret: string, email: string): string {
  return createHmac("sha256", secret.trim()).update(email.toLowerCase()).digest("base64url");
}

export class DemoSeedRefusedError extends Error {
  constructor() {
    super("demo-seed: the account already has requests; this seed runs once. Nothing was sent.");
    this.name = "DemoSeedRefusedError";
  }
}

export type DemoFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export interface RunDemoSeedOptions {
  origin: string;
  /** The demo account to sign in as; defaults to DEMO_EMAIL (#679). */
  email?: string;
  password: string;
  fetchFn?: DemoFetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  log?: (line: string) => void;
  /** How long to wait for every source to leave "pending" (the timeout story takes ~10 s). */
  settleTimeoutMs?: number;
}

export interface RunDemoSeedResult {
  submitted: number;
  /** False when a source was still pending at the timeout; the requests are recorded either way. */
  settled: boolean;
}

interface ListedRequests {
  requests: { parts?: { sources?: { status?: string }[] }[] }[];
}

/** Signs in, refuses if the account has requests, submits each story once, waits for them to settle. */
export async function runDemoSeed(opts: RunDemoSeedOptions): Promise<RunDemoSeedResult> {
  const origin = opts.origin.replace(/\/+$/, "");
  const fetchFn: DemoFetch = opts.fetchFn ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.nowFn ?? Date.now;
  const log = opts.log ?? ((line) => console.log(line));
  const jsonHeaders = { "content-type": "application/json", origin };

  const signIn = await fetchFn(`${origin}/api/v1/auth/sign-in/email`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: opts.email ?? DEMO_EMAIL, password: opts.password }),
  });
  if (!signIn.ok) throw new Error(`demo-seed: sign-in failed (HTTP ${signIn.status})`);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.includes("qm_session="));
  if (cookie === undefined) throw new Error("demo-seed: sign-in set no session cookie");
  const auth = { cookie };

  const list = async (limit: number): Promise<ListedRequests> => {
    const res = await fetchFn(`${origin}/api/v1/queries?limit=${limit}`, { headers: auth });
    if (!res.ok) throw new Error(`demo-seed: reading the request list failed (HTTP ${res.status})`);
    return (await res.json()) as ListedRequests;
  };

  if ((await list(1)).requests.length > 0) throw new DemoSeedRefusedError();

  const configRes = await fetchFn(`${origin}/api/v1/config`, { headers: auth });
  if (!configRes.ok)
    throw new Error(`demo-seed: reading the config failed (HTTP ${configRes.status})`);
  const { configHash } = (await configRes.json()) as { configHash: string };

  for (const s of DEMO_STORIES) {
    const res = await fetchFn(`${origin}/api/v1/queries`, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        ...auth,
        "x-requested-with": "querymodule",
        "idempotency-key": `demo-seed-${s.id}`,
      },
      body: JSON.stringify({
        queryType: s.queryType,
        values: s.values,
        sourceIds: s.sourceIds,
        mode: "normal",
        configHash,
      }),
    });
    if (res.status !== 202) throw new Error(`demo-seed: ${s.id} was rejected (HTTP ${res.status})`);
    log(`submitted ${s.id}`);
  }

  const deadline = now() + (opts.settleTimeoutMs ?? 30_000);
  let settled = false;
  while (!settled && now() < deadline) {
    const { requests } = await list(100);
    settled = !requests.some((r) =>
      r.parts?.some((p) => p.sources?.some((src) => src.status === "pending")),
    );
    if (!settled) await sleep(1000);
  }
  log(
    settled
      ? "all sources settled"
      : "a source was still pending at the timeout; the requests are recorded",
  );
  return { submitted: DEMO_STORIES.length, settled };
}

/** The account to seed: DEMO_EMAIL when set, else the demo dispatcher. Only @example.test (#679). */
export function demoEmailFromEnv(env: NodeJS.ProcessEnv): string {
  const raw = env.DEMO_EMAIL?.trim().toLowerCase();
  if (raw === undefined || raw === "") return DEMO_EMAIL;
  if (!/^[a-z0-9._+-]+@example\.test$/.test(raw)) {
    throw new Error("demo-seed: DEMO_EMAIL must be a seeded demo account (@example.test)");
  }
  return raw;
}

export function passwordFromEnv(env: NodeJS.ProcessEnv, email: string): string {
  for (const direct of [env.DEMO_PASSWORD, env.DEMO_DISPATCHER_PASSWORD]) {
    if (direct !== undefined && direct !== "") return direct;
  }
  const file = env.SEED_PASSWORD_SECRET_FILE;
  if (file === undefined || file === "") {
    throw new Error("demo-seed: set DEMO_PASSWORD or SEED_PASSWORD_SECRET_FILE");
  }
  let secret: string;
  try {
    secret = readFileSync(file, "utf8");
  } catch {
    throw new Error("demo-seed: SEED_PASSWORD_SECRET_FILE is unreadable");
  }
  return demoPassword(secret, email);
}

if (import.meta.main) {
  const origin = process.argv[2] ?? "http://localhost:3000";
  try {
    const email = demoEmailFromEnv(process.env);
    await runDemoSeed({ origin, email, password: passwordFromEnv(process.env, email) });
  } catch (e) {
    console.error(e instanceof Error ? e.message : "demo-seed: failed");
    process.exit(e instanceof DemoSeedRefusedError ? 3 : 1);
  }
}
