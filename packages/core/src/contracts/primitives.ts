import { z } from "zod";

/**
 * Shared id, key, code and time primitives for contracts and config (ADR-0005).
 * Config (Task 7 and later) and audit import the same bounds: an audit stricter than config
 * would fail every submit of a valid type, because an audit write failure fails the submit (spec 5.2).
 */

/** Canonical lowercase UUIDv7 (spec 5.5: ids are UUIDv7 text unless stated). */
export const UUID7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const Uuid7Schema = z.string().regex(UUID7_PATTERN);
export type Uuid7 = z.infer<typeof Uuid7Schema>;

/** SHA-256 as lowercase hex (spec 5.8 step 6: configHash). */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
export const Sha256HexSchema = z.string().regex(SHA256_HEX_PATTERN);
export type Sha256Hex = z.infer<typeof Sha256HexSchema>;

/** User, source, site, query-type and adapter-kind ids. */
export const BOUNDED_ID_MAX_LENGTH = 64;
export const BOUNDED_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${BOUNDED_ID_MAX_LENGTH}}$`);
export const BoundedIdSchema = z.string().regex(BOUNDED_ID_PATTERN);
export type BoundedId = z.infer<typeof BoundedIdSchema>;

/**
 * Message and label keys: lowerCamel segments separated by dots, for example
 * "config.unknownToken" (ADR-0005, #61). One definition for config, validation
 * errors, diagnostics and audit, so a valid config never fails an audit write.
 * Linear time: segments are split by a literal dot, so no two branches overlap.
 */
export const MESSAGE_KEY_MAX_LENGTH = 128;
export const MESSAGE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/;
// min(1) is implied by the pattern but kept explicit: the generated OpenAPI then keeps
// minLength 1, and oasdiff treats dropping it from a response as breaking.
export const MessageKeySchema = z
  .string()
  .min(1)
  .max(MESSAGE_KEY_MAX_LENGTH)
  .regex(MESSAGE_KEY_PATTERN);
export type MessageKey = z.infer<typeof MessageKeySchema>;

/** Host JWT subject (embedded mode): issued by the host, so any printable text, capped. */
export const HOST_SUBJECT_MAX_LENGTH = 255;
export const HOST_SUBJECT_PATTERN = new RegExp(`^\\P{C}{1,${HOST_SUBJECT_MAX_LENGTH}}$`, "u");
export const HostSubjectSchema = z.string().regex(HOST_SUBJECT_PATTERN);
export type HostSubject = z.infer<typeof HostSubjectSchema>;

/** Field keys: alphanumeric so no terminal delimiter or `=` can collide (spec 4.1, 4.4). */
export const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
export const FieldKeySchema = z.string().regex(FIELD_KEY_PATTERN);
export type FieldKey = z.infer<typeof FieldKeySchema>;

/** Codes of picklists referenced by a role:"type" field (the audited typeValues). */
export const TYPE_PICKLIST_CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/;
export const TypePicklistCodeSchema = z.string().regex(TYPE_PICKLIST_CODE_PATTERN);
export type TypePicklistCode = z.infer<typeof TypePicklistCodeSchema>;

/** role:"type" field values: field key to picklist code (audit typeValues, mock file types). */
export const TypeValuesSchema = z.record(FieldKeySchema, TypePicklistCodeSchema);
export type TypeValues = z.infer<typeof TypeValuesSchema>;

/** Epoch milliseconds UTC (spec 5.5). */
export const EpochMsSchema = z.int().min(0);
export type EpochMs = z.infer<typeof EpochMsSchema>;

/** Monotonic-clock duration in milliseconds (spec 5.5). */
export const DurationMsSchema = z.number().min(0);
export type DurationMs = z.infer<typeof DurationMsSchema>;

/** Fixed cap on alsoRun entries (spec 4.6 limits, 5.2). Config validation imports this. */
export const MAX_ALSO_RUN = 4;
/** Part 0 is the primary; a nested part is its alsoRun index plus 1 (spec 4.6, 5.2). */
export const PartIdSchema = z.int().min(0).max(MAX_ALSO_RUN);
export const NestedPartIdSchema = z.int().min(1).max(MAX_ALSO_RUN);
/** One nesting level: a nested part's parent is always the primary (spec 4.6 PlanPart). */
export const ParentPartIdSchema = z.literal(0);
export type PartId = z.infer<typeof PartIdSchema>;
