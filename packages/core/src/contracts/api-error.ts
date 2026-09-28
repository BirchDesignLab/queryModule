import { z } from "zod";
import { ValidationErrorSchema } from "./validation-error";

export const API_ERROR_CODES = [
  "validationFailed",
  "unauthenticated",
  "stepUpRequired",
  "mfaEnrollmentRequired",
  "forbidden",
  "notFound",
  "configHashMismatch",
  "delegationCredentialsMissing",
  "unsupportedMediaType",
  "payloadTooLarge",
  "rateLimited",
  "internal",
  "unavailable",
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const API_ERROR_HTTP_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  validationFailed: 400,
  unauthenticated: 401,
  stepUpRequired: 403,
  mfaEnrollmentRequired: 403,
  forbidden: 403,
  notFound: 404,
  configHashMismatch: 409,
  delegationCredentialsMissing: 409,
  unsupportedMediaType: 415,
  payloadTooLarge: 413,
  rateLimited: 429,
  internal: 500,
  unavailable: 503,
};

export function apiErrorStatus(code: ApiErrorCode): number {
  return API_ERROR_HTTP_STATUS[code];
}

/** Params never carry submitted field values, credentials or payload text (spec 4.7). */
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    errors: z.array(ValidationErrorSchema).optional(),
    correlationId: z.string().min(1).optional(),
    requestId: z.string().min(1),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
