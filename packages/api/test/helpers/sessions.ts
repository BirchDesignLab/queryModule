import type { Db } from "../../src/db/client";
import { session } from "../../src/db/schema";
import { uuidv7 } from "../../src/ids";

const DAY = 24 * 60 * 60_000;

/**
 * Inserts a session older than the 7-day ceiling (created and last used 8 days before `now`), so
 * the next sweeper tick expires it. Shared by the drain and startup tests (#760 T9 Q3).
 */
export async function insertExpiredSession(db: Db, now: number, userId: string): Promise<string> {
  const at = now - 8 * DAY;
  const id = uuidv7(at);
  await db.insert(session).values({
    id,
    userId,
    token: uuidv7(at),
    expiresAt: new Date(now + DAY),
    createdAt: new Date(at),
    updatedAt: new Date(at),
  });
  return id;
}
