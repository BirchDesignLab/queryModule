import { z } from "zod";

export const SOURCE_STATUSES = [
  "pending",
  "returned",
  "failed",
  "timedOut",
  "interrupted",
  "credentialsMissing",
  "credentialsRejected",
] as const;
export const SourceStatusSchema = z.enum(SOURCE_STATUSES);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;
export type TerminalSourceStatus = Exclude<SourceStatus, "pending">;

export const TERMINAL_SOURCE_STATUSES: readonly TerminalSourceStatus[] = [
  "returned",
  "failed",
  "timedOut",
  "interrupted",
  "credentialsMissing",
  "credentialsRejected",
];

/** A status is written once from pending and never changes after (spec 4.7, 5.2). */
export function isTerminalSourceStatus(s: SourceStatus): s is TerminalSourceStatus {
  return s !== "pending";
}

/** SourceError codes (spec 5.4); anything else an adapter throws maps to failed. */
export const ADAPTER_ERROR_CODES = ["credentialsRejected", "failed"] as const;
export const AdapterErrorCodeSchema = z.enum(ADAPTER_ERROR_CODES);
export type AdapterErrorCode = z.infer<typeof AdapterErrorCodeSchema>;
