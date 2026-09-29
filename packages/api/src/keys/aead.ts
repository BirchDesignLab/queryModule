import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** The one AES-256-GCM implementation in the API: 12-byte random IV, 16-byte tag (SEC-006). */
export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/** Fixed message: never carries key, plaintext or AAD values (spec 5.9). */
export class AeadError extends Error {
  constructor() {
    super("authenticated decryption failed");
    this.name = "AeadError";
  }
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function seal(key: Buffer, plaintext: Buffer, aad: string): Sealed {
  if (key.length !== KEY_BYTES) throw new AeadError();
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([c.update(plaintext), c.final()]);
  return { ciphertext, iv, tag: c.getAuthTag() };
}

/**
 * Throws AeadError on any failure: wrong key, wrong AAD, tampered ciphertext or tag,
 * or an IV or tag of the wrong length (IV 12, tag 16 pinned; a short tag would weaken forgery resistance).
 */
export function open(key: Buffer, s: Sealed, aad: string): Buffer {
  try {
    if (key.length !== KEY_BYTES || s.iv.length !== IV_BYTES || s.tag.length !== TAG_BYTES) {
      throw new Error();
    }
    const d = createDecipheriv("aes-256-gcm", key, s.iv, { authTagLength: TAG_BYTES }).setAAD(
      Buffer.from(aad, "utf8"),
    );
    d.setAuthTag(s.tag);
    return Buffer.concat([d.update(s.ciphertext), d.final()]);
  } catch {
    throw new AeadError();
  }
}
