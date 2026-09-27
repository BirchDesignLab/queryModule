// board-data-schema.mjs: zod schema and JSON-pointer validator for
// docs/board/board-data.json (Task 604, issue #92 "board data out of the
// gate path"). No IO: the caller reads the JSON file and the script's own
// MILESTONES/label constants and passes them in here.
//
// R2 (what stays in the script, gh-setup-project.mjs): milestone names and
// the label vocabulary are supplied by the caller, never hardcoded in this
// module, so the schema can only ever accept a milestone or label the script
// itself knows about. A data file edit can add a follow-up or record an
// issue number; it can never invent a new milestone or label the script
// would then have to create.
//
// Label vocabulary: the script's own LABELS array (gh-setup-project.mjs)
// creates only `epic`, `follow-up`, `decision`; the track and phase labels
// (`platform`, `web`, `core`, `mobile`, `p0`-`p3`), `sensitive`, `contract`
// and `api-breaking` are created by scripts/ops/gh-setup-labels.sh, and
// `documentation`, `bug`, `enhancement`, `question`, `accessibility` are
// GitHub's own defaults (docs/project-board.md "## Labels"). All of these are
// labels the *scripts* (setup-project and setup-labels together) manage or
// rely on, so `KNOWN_LABELS` in gh-setup-project.mjs lists the full set; see
// the report for Task 604 (planVsSpec: R3 says "the script's LABELS names",
// which taken literally is only 3 names and would reject most of the
// existing follow-up data).

import { z } from "zod";

export const PHASE_CODES = ["P0", "P1", "P2", "P3"];
export const TRACKS = ["Platform (A)", "Web (B)", "Core", "Mobile (D)"];
export const SIZES = ["S", "M", "L", "XL"];
export const PRIORITIES = ["Urgent", "High", "Medium", "Low"];
export const WAVE_STATES = ["todo", "ready", "review", "done"];

const positiveInt = z.int().positive();
const positiveIntOrNull = z.union([positiveInt, z.null()]);

/** Build a JSON pointer (RFC 6901) from path segments, escaping "~" and "/". */
export function pointer(...segments) {
  return segments.map((s) => `/${String(s).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

/**
 * Build the board-data schema. `milestoneNames` and `labelNames` come from
 * the script's own MILESTONES and KNOWN_LABELS constants (R2, R3): a
 * milestone or label the script does not know about fails validation.
 *
 * @param {{milestoneNames: string[], labelNames: string[]}} known
 */
export function buildBoardDataSchema({ milestoneNames, labelNames }) {
  const Milestone = z.enum(milestoneNames);
  const Label = z.enum(labelNames);

  const Phase = z
    .object({
      number: positiveInt,
      title: z.string().min(1),
      milestone: Milestone,
      phase: z.enum(PHASE_CODES),
      gate: z.string().min(1).nullable(),
      plan: z.string().min(1).nullable(),
    })
    .strict();

  const Wave = z
    .object({
      number: positiveInt,
      k: positiveInt,
      title: z.string().min(1),
      tasks: z
        .tuple([positiveInt, positiveInt])
        .refine(([a, b]) => a <= b, { message: "tasks must be an ascending [start, end] range" }),
      pr: positiveIntOrNull,
      state: z.enum(WAVE_STATES),
    })
    .strict();

  const FollowUp = z
    .object({
      number: positiveInt,
      title: z.string().min(1),
      labels: z.array(Label).min(1),
      milestone: Milestone,
      parent: positiveInt.optional(),
      track: z.enum(TRACKS).nullable(),
      phase: z.enum(PHASE_CODES),
      size: z.enum(SIZES),
      priority: z.enum(PRIORITIES),
      reqIds: z.string(),
      body: z.string().min(1),
      assignee: z.string().min(1).optional(),
    })
    .strict();

  return z
    .object({
      phases: z.array(Phase).min(1),
      contractsM0P0: positiveInt,
      milestoneParentNumbers: z.record(Milestone, positiveIntOrNull),
      waves: z.array(Wave).min(1),
      followUps: z.array(FollowUp).min(1),
    })
    .strict();
}

/**
 * Validate board data, fail closed: on error, returns every issue with a
 * JSON pointer to its location and no partial data (R3).
 *
 * @param {unknown} data
 * @param {{milestoneNames: string[], labelNames: string[]}} known
 * @returns {{ok: true, data: object} | {ok: false, errors: Array<{pointer: string, message: string}>}}
 */
export function validateBoardData(data, known) {
  const schema = buildBoardDataSchema(known);
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  const errors = result.error.issues.map((issue) => ({
    pointer: pointer(...issue.path),
    message: issue.message,
  }));
  return { ok: false, errors };
}
