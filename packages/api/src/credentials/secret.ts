import { inspect } from "node:util";

const REDACTED = "[secret]" as const;

/**
 * A value that prints as "[secret]" through JSON.stringify, String(), template strings,
 * util.inspect and console output (spec 5.7, 5.9, 10.3). The value lives in a private field,
 * so no own property carries it; reveal() hands it over, only at the adapter's wire boundary.
 */
export class Secret<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  reveal(): T {
    return this.#value;
  }

  toJSON(): typeof REDACTED {
    return REDACTED;
  }

  toString(): typeof REDACTED {
    return REDACTED;
  }

  [inspect.custom](): typeof REDACTED {
    return REDACTED;
  }
}
