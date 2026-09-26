import { z } from "zod";

export const ValidationErrorSchema = z.strictObject({
  key: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export type ValidationError = z.infer<typeof ValidationErrorSchema>;
