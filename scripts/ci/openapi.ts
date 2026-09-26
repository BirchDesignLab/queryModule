import { API_VERSION, ApiErrorSchema, type RouteDef } from "@querymodule/core/contracts";
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema> };
}

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
    // unrepresentable left at its default ("throw"): a type JSON Schema cannot
    // express fails generation instead of publishing {} (a loosened contract).
  }) as JsonSchema;
  const { $schema: _dropped, ...rest } = json;
  return rest;
}

const safe = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_");

/** Register a schema as a named component; its local $defs become sibling components. */
export function registerSchema(
  name: string,
  schema: z.ZodType,
  components: Record<string, JsonSchema>,
): { $ref: string } {
  const json = toJsonSchema(schema);
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
            out[k] = `#/components/schemas/${name}_${safe(v.slice("#/$defs/".length))}`;
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
  for (const [def, body] of Object.entries(defs))
    components[`${name}_${safe(def)}`] = rewrite(body) as JsonSchema;
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
          "application/json": { schema: registerSchema(`${r.id}Body`, r.request.body, components) },
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
