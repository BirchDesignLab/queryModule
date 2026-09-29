import {
  type ApiError,
  type ApiErrorCode,
  apiErrorStatus,
  type ValidationError,
} from "@querymodule/core/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { uuidv7 } from "../ids";
import type { AppEnv } from "./types";

export function apiError(
  c: Context<AppEnv>,
  code: ApiErrorCode,
  params?: Record<string, string | number>,
  /** validationFailed only: message keys and params, never submitted values (spec 4.7). */
  errors?: ValidationError[],
): Response {
  const body: ApiError = {
    error: {
      code,
      ...(params ? { params } : {}),
      ...(errors ? { errors } : {}),
      requestId: c.get("requestId") ?? uuidv7(),
    },
  };
  return c.json(body, apiErrorStatus(code) as ContentfulStatusCode);
}

export function rateLimited(c: Context<AppEnv>, retryAfterSeconds: number): Response {
  const s = Math.max(1, Math.ceil(retryAfterSeconds));
  c.header("Retry-After", String(s));
  return apiError(c, "rateLimited", { retryAfterSeconds: s });
}
