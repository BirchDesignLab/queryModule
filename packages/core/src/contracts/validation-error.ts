import { z } from "zod";
import { MessageKeySchema } from "./primitives";

export const ValidationErrorSchema = z.strictObject({
  key: MessageKeySchema,
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export type ValidationError = z.infer<typeof ValidationErrorSchema>;
