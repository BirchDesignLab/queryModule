import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { AppDeps } from "../deps";
import { apiError } from "./errors";
import { buildCsp } from "./security";
import type { AppEnv } from "./types";

export const injectNonce = (html: string, nonce: string): string =>
  html.replaceAll("<script", `<script nonce="${nonce}"`);

export function mountWeb(app: Hono<AppEnv>, d: AppDeps): void {
  const dist = d.env.webDist;
  if (!dist) return;
  const index = readFileSync(join(dist, "index.html"), "utf8"); // missing build fails startup (closed)
  // c.header() inside serveStatic's onFound is a no-op here (@hono/node-server 2.1.1: it builds
  // the Response via c.body() before onFound runs, so the mutation lands on a headers copy that
  // is never returned); set the header in a wrapping middleware instead, the same after-next()
  // pattern securityHeaders and noStore already use.
  app.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.status === 200)
      c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("/assets/*", serveStatic({ root: relative(process.cwd(), dist) }));
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return apiError(c, "notFound");
    const nonce = randomBytes(16).toString("base64");
    c.header("Content-Security-Policy", buildCsp(d.env, nonce));
    c.header("Cache-Control", "no-store");
    return c.html(injectNonce(index, nonce));
  });
}
