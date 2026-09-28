import { createHmac } from "node:crypto";

/** Spec 8.5: base64url(HMAC-SHA256(secret, lowercase email)), 43 chars. */
export function derivePassword(secret: string, email: string): string {
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("base64url");
}
