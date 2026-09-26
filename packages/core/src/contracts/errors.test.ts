import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  API_ERROR_HTTP_STATUS,
  ApiErrorSchema,
  apiErrorStatus,
} from "./api-error";
import { ValidationErrorSchema } from "./validation-error";

describe("NFR-001 ValidationError is a key with params, no prose", () => {
  it("accepts key and scalar params", () => {
    const e = { key: "validation.required", params: { field: "plateType", position: 3, ok: true } };
    expect(ValidationErrorSchema.parse(e)).toEqual(e);
  });
  it("rejects an empty key and object params", () => {
    expect(ValidationErrorSchema.safeParse({ key: "" }).success).toBe(false);
    expect(
      ValidationErrorSchema.safeParse({ key: "k", params: { nested: { a: 1 } } }).success,
    ).toBe(false);
  });
  it("rejects unknown keys such as message", () => {
    expect(ValidationErrorSchema.safeParse({ key: "k", message: "x" }).success).toBe(false);
  });
});

describe("ApiError shape (spec 4.7)", () => {
  it("maps every code to its HTTP status", () => {
    expect(API_ERROR_CODES).toHaveLength(12);
    expect(API_ERROR_HTTP_STATUS).toEqual({
      validationFailed: 400,
      unauthenticated: 401,
      stepUpRequired: 403,
      mfaEnrollmentRequired: 403,
      forbidden: 403,
      notFound: 404,
      configHashMismatch: 409,
      delegationCredentialsMissing: 409,
      payloadTooLarge: 413,
      rateLimited: 429,
      internal: 500,
      unavailable: 503,
    });
    expect(apiErrorStatus("rateLimited")).toBe(429);
  });
  it("parses a validationFailed body", () => {
    const body = {
      error: {
        code: "validationFailed",
        errors: [{ key: "terminal.unknownCommand", params: { code: "XYZ" } }],
        requestId: "req-1",
      },
    };
    expect(ApiErrorSchema.parse(body)).toEqual(body);
  });
  it("rejects an unknown code, a missing requestId and extra keys", () => {
    expect(ApiErrorSchema.safeParse({ error: { code: "teapot", requestId: "r" } }).success).toBe(
      false,
    );
    expect(ApiErrorSchema.safeParse({ error: { code: "internal" } }).success).toBe(false);
    expect(
      ApiErrorSchema.safeParse({ error: { code: "internal", requestId: "r", detail: "x" } })
        .success,
    ).toBe(false);
  });
});
