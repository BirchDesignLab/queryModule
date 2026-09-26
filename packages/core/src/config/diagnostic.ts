import { z } from "zod";

export const DiagnosticSchema = z.strictObject({
  level: z.enum(["error", "warning"]),
  path: z.string(),
  key: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export type DiagnosticParams = Diagnostic["params"];

export function pointer(...segments: (string | number)[]): string {
  return segments.map((s) => `/${String(s).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

export class DiagnosticSink {
  readonly errors: Diagnostic[] = [];
  readonly warnings: Diagnostic[] = [];

  error(path: string, key: string, params: DiagnosticParams = {}): void {
    this.errors.push({ level: "error", path, key, params });
  }

  warn(path: string, key: string, params: DiagnosticParams = {}): void {
    this.warnings.push({ level: "warning", path, key, params });
  }

  result(): { errors: Diagnostic[]; warnings: Diagnostic[] } {
    return { errors: this.errors, warnings: this.warnings };
  }
}
