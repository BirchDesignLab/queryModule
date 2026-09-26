import { z } from "zod";

/** strict: server parse, unknown keys are errors. client: forward-tolerant, unknown keys stripped. */
export type SchemaMode = "strict" | "client";

export function objectFor(mode: SchemaMode) {
  return <T extends z.ZodRawShape>(shape: T): z.ZodObject<T> =>
    (mode === "strict" ? z.strictObject(shape) : z.object(shape)) as unknown as z.ZodObject<T>;
}

/** Optional enum; in client mode an unknown value becomes undefined instead of failing. */
export function optionalEnum<const T extends readonly [string, ...string[]]>(mode: SchemaMode, values: T) {
  const base = z.enum(values).optional();
  return mode === "client" ? (base.catch(undefined) as unknown as typeof base) : base;
}
