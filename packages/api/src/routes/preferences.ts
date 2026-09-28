import { UserPreferenceSchema } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { userPreference } from "../db/schema";
import type { AppDeps } from "../deps";
import { apiError } from "../http/errors";
import { requireSession } from "../http/session";
import type { AppEnv } from "../http/types";

const EMPTY = { themeMode: null, personaOverride: null, layout: null } as const;

export function mountPreferencesRoute(app: Hono<AppEnv>, d: AppDeps): void {
  app.get("/api/v1/me/preferences", requireSession(d.identity), async (c) => {
    const userId = c.get("principal").userId;
    const row = (
      await d.db.select().from(userPreference).where(eq(userPreference.userId, userId))
    )[0];
    if (!row) return c.json(EMPTY);
    return c.json(
      UserPreferenceSchema.parse({
        themeMode: row.themeMode,
        personaOverride: row.personaOverride,
        layout: row.layout,
      }),
    );
  });
  app.put("/api/v1/me/preferences", requireSession(d.identity), async (c) => {
    const parsed = UserPreferenceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, "validationFailed");
    const userId = c.get("principal").userId;
    const now = new Date(d.clock.now());
    const values = {
      userId,
      themeMode: parsed.data.themeMode,
      personaOverride: parsed.data.personaOverride,
      layout: parsed.data.layout,
      updatedAt: now,
    };
    await d.db
      .insert(userPreference)
      .values(values)
      .onConflictDoUpdate({ target: userPreference.userId, set: values });
    return c.json(parsed.data);
  });
}
