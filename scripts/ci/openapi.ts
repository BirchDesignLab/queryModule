import { ClientConditionSchema } from "@querymodule/core/config";
import { API_VERSION, ApiErrorSchema, type RouteDef } from "@querymodule/core/contracts";
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema> };
}

/**
 * Registry ids for shared, recursive schemas (#69): zod names an anonymous
 * recursive schema from an internal counter (`__schema0`), which drifts on a
 * zod upgrade. An id makes it a stable, shared component.
 */
const SHARED_IDS: ReadonlyArray<[z.ZodType, string]> = [[ClientConditionSchema, "Condition"]];
for (const [schema, id] of SHARED_IDS) {
  const meta = z.globalRegistry.get(schema);
  if (meta?.id !== id) z.globalRegistry.add(schema, { ...meta, id });
}

/**
 * JSON Schema for one zod schema. `io` is "output" for what the API sends
 * (responses, server WS messages) and "input" for what it accepts (request
 * bodies, client WS messages), so a defaulted field is optional on input (#69).
 */
export function toJsonSchema(schema: z.ZodType, io: "input" | "output" = "output"): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    // unrepresentable left at its default ("throw"): a type JSON Schema cannot
    // express fails generation instead of publishing {} (a loosened contract).
  }) as JsonSchema;
  const { $schema: _dropped, ...rest } = json;
  return rest;
}

const safe = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_");

/** Anonymous $defs (zod's `__schema<n>`) stay scoped to their component; a registry id is shared. */
const isAnonymousDef = (def: string) => def.startsWith("__");
const defName = (name: string, def: string) =>
  isAnonymousDef(def) ? `${name}_${safe(def)}` : safe(def);

/**
 * Register a schema as a named component; its local $defs become sibling
 * components. A def with a registry id becomes one shared component under that
 * id; the same id with a different body throws (fails closed on a clash).
 */
export function registerSchema(
  name: string,
  schema: z.ZodType,
  components: Record<string, JsonSchema>,
  io: "input" | "output" = "output",
): { $ref: string } {
  const json = toJsonSchema(schema, io);
  const defs = (json.$defs ?? {}) as Record<string, unknown>;
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "$defs") continue;
        if (k === "$ref" && typeof v === "string") {
          if (v === "#") out[k] = `#/components/schemas/${name}`;
          else if (v.startsWith("#/$defs/"))
            out[k] = `#/components/schemas/${defName(name, v.slice("#/$defs/".length))}`;
          else out[k] = v;
        } else {
          out[k] = rewrite(v);
        }
      }
      return out;
    }
    return value;
  };
  components[name] = rewrite(json) as JsonSchema;
  for (const [def, body] of Object.entries(defs)) {
    const key = defName(name, def);
    const value = rewrite(body) as JsonSchema;
    const existing = components[key];
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value))
      throw new Error(`component ${key} is defined twice with different bodies`);
    components[key] = value;
  }
  return { $ref: `#/components/schemas/${name}` };
}

export function buildOpenApiDocument(routes: readonly RouteDef[]): OpenApiDocument {
  const components: Record<string, JsonSchema> = {};
  const errorRef = registerSchema("ApiError", ApiErrorSchema, components);
  const paths: OpenApiDocument["paths"] = {};

  for (const r of routes) {
    const parameters: unknown[] = [];
    const sources = [
      ["path", r.request?.params],
      ["query", r.request?.query],
      ["header", r.request?.headers],
    ] as const;
    for (const [where, schema] of sources) {
      if (!schema) continue;
      for (const [name, s] of Object.entries(schema.shape)) {
        const field = s as z.ZodType;
        parameters.push({
          name,
          in: where,
          required: where === "path" || !field.safeParse(undefined).success,
          schema: toJsonSchema(field),
        });
      }
    }

    const responses: Record<string, unknown> = {};
    for (const [status, resp] of Object.entries(r.responses)) {
      if (!resp.schema) {
        responses[status] = { description: resp.description };
        continue;
      }
      const schemaRef =
        resp.schema === ApiErrorSchema
          ? errorRef
          : registerSchema(`${r.id}${status}`, resp.schema, components);
      responses[status] = {
        description: resp.description,
        content: { "application/json": { schema: schemaRef } },
      };
    }

    const op: Record<string, unknown> = { operationId: r.id, summary: r.summary };
    if (r.feature) op["x-feature"] = r.feature;
    if (r.requires) op["x-requires"] = r.requires;
    if (parameters.length > 0) op.parameters = parameters;
    if (r.request?.body) {
      op.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: registerSchema(`${r.id}Body`, r.request.body, components, "input"),
          },
        },
      };
    }
    op.responses = responses;
    paths[r.path] = { ...(paths[r.path] ?? {}), [r.method]: op };
  }

  return {
    openapi: "3.1.0",
    info: { title: "Query Module API", version: API_VERSION },
    paths,
    components: { schemas: components },
  };
}
