import { z } from "zod";
import { BoundedIdSchema, FieldKeySchema, TypeValuesSchema } from "./primitives";

/**
 * Mock file schema (spec 5.4): the prototype's mock data source, never real CJIS data.
 * Track A M1 P3 (mock adapter, scripts/mock-data/generate.ts) consumes these (FR-043, FR-044, SEC-002).
 */

export const SourcePayloadSchema = z.record(z.string(), z.unknown());
export type SourcePayload = z.infer<typeof SourcePayloadSchema>;

export const MOCK_BEHAVIORS = ["timeout", "error", "credentialsRejected"] as const;

export const MockScenarioSchema = z
  .strictObject({
    when: z.record(FieldKeySchema, z.union([z.string(), z.number(), z.boolean()])),
    respond: SourcePayloadSchema.optional(),
    behavior: z.enum(MOCK_BEHAVIORS).optional(),
  })
  .refine((s) => (s.respond === undefined) !== (s.behavior === undefined), {
    message: "exactly one of respond or behavior",
    path: ["behavior"],
  });
export type MockScenario = z.infer<typeof MockScenarioSchema>;

export const MockResponseSchema = z.strictObject({
  queryType: BoundedIdSchema,
  types: TypeValuesSchema.optional(),
  default: SourcePayloadSchema,
  scenarios: z.array(MockScenarioSchema).default([]),
});
export type MockResponse = z.infer<typeof MockResponseSchema>;

export const MockSourceSchema = z
  .strictObject({
    latencyMs: z.tuple([z.int().min(0), z.int().min(0)]),
    responses: z.array(MockResponseSchema).min(1),
  })
  .refine((s) => s.latencyMs[0] <= s.latencyMs[1], {
    message: "latencyMs min must be <= max",
    path: ["latencyMs"],
  });
export type MockSource = z.infer<typeof MockSourceSchema>;

export const MockFileSchema = z.strictObject({
  siteId: BoundedIdSchema,
  sources: z.record(BoundedIdSchema, MockSourceSchema),
});
export type MockFile = z.infer<typeof MockFileSchema>;
