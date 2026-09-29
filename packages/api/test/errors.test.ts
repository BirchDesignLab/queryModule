import { ApiErrorSchema } from "@querymodule/core/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { apiError, rateLimited } from "../src/http/errors";
import type { AppEnv } from "../src/http/types";

function app() {
  const a = new Hono<AppEnv>();
  a.get("/fractional", (c) => rateLimited(c, 0.2));
  a.get("/whole", (c) => rateLimited(c, 2.5));
  return a;
}

describe("SEC-006 rateLimited", () => {
  it("clamps a fractional retryAfterSeconds up to a floor of 1", async () => {
    const r = await app().request("/fractional");
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("1");
    const body = ApiErrorSchema.parse(await r.json());
    expect(body.error.code).toBe("rateLimited");
    expect(body.error.params?.retryAfterSeconds).toBe(1);
  });

  it("ceils a non-integer retryAfterSeconds", async () => {
    const r = await app().request("/whole");
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("3");
    const body = ApiErrorSchema.parse(await r.json());
    expect(body.error.code).toBe("rateLimited");
    expect(body.error.params?.retryAfterSeconds).toBe(3);
  });
});

describe("spec 4.7 apiError errors[]", () => {
  function errorsApp() {
    const a = new Hono<AppEnv>();
    a.get("/with", (c) =>
      apiError(c, "validationFailed", undefined, [{ key: "validation.idempotencyKey" }]),
    );
    a.get("/without", (c) => apiError(c, "validationFailed"));
    return a;
  }

  it("carries validation errors when given", async () => {
    const r = await errorsApp().request("/with");
    expect(r.status).toBe(400);
    const body = ApiErrorSchema.parse(await r.json());
    expect(body.error.errors).toEqual([{ key: "validation.idempotencyKey" }]);
    expect(body.error.params).toBeUndefined();
  });

  it("omits errors when not given", async () => {
    const body = (await (await errorsApp().request("/without")).json()) as { error: object };
    expect(body.error).not.toHaveProperty("errors");
  });
});
