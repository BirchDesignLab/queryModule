import { z } from "zod";
import { RoleSchema } from "./identity";
import { BoundedIdSchema, EpochMsSchema } from "./primitives";

/**
 * Client IP as the API resolves it: an IPv4 or IPv6 address from cf-connecting-ip or the socket,
 * or the fallbacks "local" and "unknown" (Task 16 clientIp). Printable ASCII with no spaces, capped,
 * so a header value can never smuggle text into an audit row.
 */
export const CLIENT_IP_MAX_LENGTH = 64;
export const ClientIpSchema = z
  .string()
  .regex(new RegExp(`^[\\x21-\\x7e]{1,${CLIENT_IP_MAX_LENGTH}}$`));

/** SEC-010: a sign-in that created a session (spec 5.6). */
export const LoginSucceededDetailsSchema = z.strictObject({
  method: z.enum(["password", "totp", "hostJwt"]),
  sessionId: BoundedIdSchema,
  clientIp: ClientIpSchema,
});

/**
 * SEC-005, SEC-010: a refused sign-in. targetUserId is null for an unknown account; lockoutUntil
 * is set on the failure that starts a lockout (spec 5.6).
 */
export const LoginFailedDetailsSchema = z.strictObject({
  targetUserId: BoundedIdSchema.nullable(),
  reason: z.enum(["badPassword", "unknownAccount", "mfaFailed", "lockedOut", "hostJwtInvalid"]),
  clientIp: ClientIpSchema,
  lockoutUntil: EpochMsSchema.optional(),
});

/** SEC-010: a sign-out that ended a session. */
export const LogoutDetailsSchema = z.strictObject({ sessionId: BoundedIdSchema });

/** SEC-010: roles change only through the grant-role ops script (spec 5.6). */
export const RoleChangedDetailsSchema = z.strictObject({
  targetUserId: BoundedIdSchema,
  role: RoleSchema,
  change: z.enum(["granted", "revoked"]),
  via: z.literal("grant-role"),
});
