import type { Db } from "../db/client";

export interface LoginStatsRow {
  email: string;
  signIns: number;
  distinctIps: number;
  /** Epoch ms of the latest loginSucceeded, or null for an account that never signed in. */
  lastSignIn: number | null;
}

const USAGE = "usage: login-stats [--since <YYYY-MM-DD>]";

/**
 * Parses the CLI flags: none, or `--since <YYYY-MM-DD>` (UTC midnight). Anything else, including
 * the `--since=<date>` form, is a usage error, so a typo fails loudly instead of counting everything.
 */
export function parseLoginStatsArgs(argv: string[]): { since: number | undefined } {
  if (argv.length === 0) return { since: undefined };
  const raw = argv[1];
  if (
    argv.length !== 2 ||
    argv[0] !== "--since" ||
    raw === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw)
  )
    throw new Error(USAGE);
  const since = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(since) || new Date(since).toISOString().slice(0, 10) !== raw)
    throw new Error(USAGE);
  return { since };
}

/**
 * Sign-ins per account from the append-only audit (SEC-010): the loginSucceeded count, the number
 * of distinct client IPs and the latest sign-in, for every user, ordered by email. Read only; the
 * IP values themselves never leave this query (only their count), so the output carries no
 * client addresses.
 */
export async function loginStats(db: Db, since?: number): Promise<LoginStatsRow[]> {
  const r = await db.$client.execute({
    sql: `SELECT u.email AS email,
                 count(a.id) AS sign_ins,
                 count(DISTINCT json_extract(a.details, '$.clientIp')) AS distinct_ips,
                 max(a.at) AS last_at
            FROM user u
            LEFT JOIN audit_event a
              ON a.actor_user_id = u.id AND a.type = 'loginSucceeded' AND a.at >= ?
           GROUP BY u.id
           ORDER BY u.email`,
    args: [since ?? 0],
  });
  return r.rows.map((row) => ({
    email: String(row.email),
    signIns: Number(row.sign_ins),
    distinctIps: Number(row.distinct_ips),
    lastSignIn: row.last_at === null ? null : Number(row.last_at),
  }));
}

/** Tab-separated table for the operator console, one line per account, times in UTC. */
export function formatLoginStats(rows: LoginStatsRow[]): string {
  const lines = ["account\tsign-ins\tdistinct IPs\tlast sign-in (UTC)"];
  for (const r of rows) {
    const last =
      r.lastSignIn === null ? "never" : `${new Date(r.lastSignIn).toISOString().slice(0, 19)}Z`;
    lines.push(`${r.email}\t${r.signIns}\t${r.distinctIps}\t${last}`);
  }
  return `${lines.join("\n")}\n`;
}
