import { z } from "zod";
import { RoleSchema } from "./identity";
import { BoundedIdSchema, EpochMsSchema, Uuid7Schema } from "./primitives";

/**
 * Client IP as the API resolves it: an IPv4 or IPv6 address (IPv4-mapped and %zone forms included)
 * from cf-connecting-ip or the socket, or the fallbacks "local" and "unknown" (Task 16 clientIp).
 * Address characters only, capped, so header text never reaches an audit row (spec 4.7).
 */
export const CLIENT_IP_MAX_LENGTH = 64;
export const ClientIpSchema = z
  .string()
  .regex(new RegExp(`^[0-9A-Za-z:.%_-]{1,${CLIENT_IP_MAX_LENGTH}}$`));

/** The session row id (Better Auth generateId is uuidv7), never the session token. */
const SessionIdSchema = Uuid7Schema;

/** SEC-010: a sign-in that created a session (spec 5.6). */
export const LoginSucceededDetailsSchema = z.strictObject({
  method: z.enum(["password", "totp", "hostJwt"]),
  sessionId: SessionIdSchema,
  clientIp: ClientIpSchema,
});

/**
 * SEC-005, SEC-010: a refused sign-in. targetUserId is null for an unknown account; lockoutUntil
 * is set on the failure that starts a lockout (spec 5.6). accountDisabled: a sign-in to a disabled
 * account, refused whatever the password (D-A26, C-I1): Better Auth checks it as for any account
 * and any session it creates is discarded (rr:N-I1), so the row states no password fact.
 */
export const LoginFailedDetailsSchema = z.strictObject({
  targetUserId: BoundedIdSchema.nullable(),
  reason: z.enum([
    "badPassword",
    "unknownAccount",
    "mfaFailed",
    "lockedOut",
    "hostJwtInvalid",
    "accountDisabled",
  ]),
  clientIp: ClientIpSchema,
  lockoutUntil: EpochMsSchema.optional(),
});

/** SEC-010: a sign-out that ended a session. */
export const LogoutDetailsSchema = z.strictObject({ sessionId: SessionIdSchema });

/**
 * SEC-010: roles change through the grant-role ops script (spec 5.6) or an admin in the admin
 * console (ADR-0011 item 8).
 */
export const RoleChangedDetailsSchema = z.strictObject({
  targetUserId: BoundedIdSchema,
  role: RoleSchema,
  change: z.enum(["granted", "revoked"]),
  via: z.enum(["grant-role", "adminConsole"]),
});

/** SEC-010: a session ended by an admin, by a user disable, or by the sweeper on expiry (spec 4.7). */
export const SessionRevokedDetailsSchema = z.strictObject({
  sessionId: SessionIdSchema,
  reason: z.enum(["userDisabled", "admin", "expired"]),
});
