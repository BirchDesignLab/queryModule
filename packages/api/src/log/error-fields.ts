// packages/api/src/log/error-fields.ts

/** A class whose message is fixed text the app wrote, never a value (spec 5.9). */
export type FixedTextError = abstract new (...args: never[]) => Error;

export interface ErrorFields {
  name: string;
  message?: string;
  code?: string;
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
/** Driver result codes are fixed tokens such as SQLITE_CONSTRAINT_TRIGGER, never data. */
const DRIVER_CODE = /^SQLITE_[A-Z_]{1,64}$/;
/** Node system error codes (EADDRINUSE, EACCES) are fixed tokens too; the message is not. */
const SYSTEM_CODE = /^E[A-Z]{1,31}$/;
const MAX_CAUSES = 5;

/**
 * What an error may put in a log line or on stderr (spec 5.9; M1 phase review LS-1, LS-2). A
 * query error's message quotes the statement's params (an email, a password hash, a session
 * token, a config document), so only the error's name is kept, plus the first driver or Node
 * system code found on it or its causes. The message is kept only for an instance of one of `fixedText`, the
 * classes whose message the app builds from fixed text.
 */
export function errorFields(err: unknown, fixedText: readonly FixedTextError[] = []): ErrorFields {
  if (!(err instanceof Error)) return { name: "unknown" };
  const name = SAFE_NAME.test(err.name) ? err.name : "unknown";
  if (fixedText.some((C) => err instanceof C)) return { name, message: err.message };
  let e: unknown = err;
  for (let i = 0; i < MAX_CAUSES && e !== null && typeof e === "object"; i++) {
    const code: unknown = (e as { code?: unknown }).code;
    if (typeof code === "string" && (DRIVER_CODE.test(code) || SYSTEM_CODE.test(code)))
      return { name, code };
    e = (e as { cause?: unknown }).cause;
  }
  return { name };
}
