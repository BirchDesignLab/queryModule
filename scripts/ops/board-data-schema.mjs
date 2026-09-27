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
// Label vocabulary: the script's own LABELS array (board-config.mjs)
// creates only `epic`, `follow-up`, `decision`; the track and phase labels
// (`platform`, `web`, `core`, `mobile`, `p0`-`p3`), `sensitive`, `contract`
// and `api-breaking` are created by scripts/ops/gh-setup-labels.sh, and
// `documentation`, `bug`, `enhancement`, `question`, `accessibility` are
// GitHub's own defaults (docs/project-board.md "## Labels"). All of these are
// labels the *scripts* (setup-project and setup-labels together) manage or
// rely on, so `KNOWN_LABELS` in board-config.mjs lists the full set; see
// the report for Task 604 (planVsSpec: R3 says "the script's LABELS names",
// which taken literally is only 3 names and would reject most of the
// existing follow-up data).

import { z } from "zod";

export const WAVE_STATES = ["todo", "ready", "review", "done"];

/** Option names of one single-select field in the script's FIELDS (board-config.mjs). */
function optionNames(fields, name) {
  const f = fields.find((x) => x.name === name);
  if (!f?.options?.length) throw new Error(`board-data schema: FIELDS has no options for ${name}`);
  return f.options.map((o) => o.name);
}

const positiveInt = z.int().positive();
const positiveIntOrNull = z.union([positiveInt, z.null()]);

/** Build a JSON pointer (RFC 6901) from path segments, escaping "~" and "/". */
export function pointer(...segments) {
  return segments.map((s) => `/${String(s).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

/**
 * Build the board-data schema. `milestoneNames`, `labelNames` and `fields` come
 * from the script's own MILESTONES, KNOWN_LABELS and FIELDS (R2, R3): a
 * milestone, label or field option the script does not know about fails
 * validation, so a data edit can never reach a write the script cannot make
 * (W6 critic C2: a wave k with no W<k> option used to throw mid --apply).
 * Every issue number is unique across phases, waves, their task issues (task
 * N is issue #N+1), follow-ups and milestone parents (W6 critic C3: a reused
 * number would rename and rewrite the wrong live issue). A follow-up's parent
 * must be a phase or wave issue (#96 G-M3).
 *
 * @param {{milestoneNames: string[], labelNames: string[], fields: Array<{name: string, options?: Array<{name: string}>}>}} known
 */
export function buildBoardDataSchema({ milestoneNames, labelNames, fields }) {
  const Milestone = z.enum(milestoneNames);
  const Label = z.enum(labelNames);
  const PhaseCode = z.enum(optionNames(fields, "Phase"));
  const waveOptions = new Set(optionNames(fields, "Wave"));

  const Phase = z
    .object({
      number: positiveInt,
      title: z.string().min(1),
      milestone: Milestone,
      phase: PhaseCode,
      gate: z.string().min(1).nullable(),
      plan: z.string().min(1).nullable(),
    })
    .strict();

  const Wave = z
    .object({
      number: positiveInt,
      k: positiveInt.refine((k) => waveOptions.has(`W${k}`), {
        message: "no W<k> option in the Wave field (board-config.mjs FIELDS)",
      }),
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
      track: z.enum(optionNames(fields, "Track")).nullable(),
      phase: PhaseCode,
      size: z.enum(optionNames(fields, "Size")),
      priority: z.enum(optionNames(fields, "Priority")),
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
    .strict()
    .superRefine((d, ctx) => {
      const seen = new Map();
      const claim = (n, path) => {
        if (n === null) return;
        const first = seen.get(n);
        if (first === undefined) seen.set(n, path);
        else
          ctx.addIssue({
            code: "custom",
            path,
            message: `issue #${n} is used more than once (first at ${pointer(...first)})`,
          });
      };
      for (const [i, p] of d.phases.entries()) claim(p.number, ["phases", i, "number"]);
      for (const [m, n] of Object.entries(d.milestoneParentNumbers))
        claim(n, ["milestoneParentNumbers", m]);
      d.waves.forEach((w, i) => {
        claim(w.number, ["waves", i, "number"]);
        for (let t = w.tasks[0]; t <= w.tasks[1]; t++) claim(t + 1, ["waves", i, "tasks"]);
      });
      for (const [i, f] of d.followUps.entries()) claim(f.number, ["followUps", i, "number"]);
      // #96 G-M3: a follow-up's parent must be a phase or wave parent issue, so a bad
      // parent fails validation instead of throwing mid --apply after earlier writes.
      const parents = new Set([...d.phases.map((p) => p.number), ...d.waves.map((w) => w.number)]);
      for (const [i, f] of d.followUps.entries()) {
        if (f.parent !== undefined && !parents.has(f.parent)) {
          ctx.addIssue({
            code: "custom",
            path: ["followUps", i, "parent"],
            message: `parent #${f.parent} is not a phase or wave issue`,
          });
        }
      }
    });
}

/**
 * Validate board data, fail closed: on error, returns every issue with a
 * JSON pointer to its location and no partial data (R3).
 *
 * @param {unknown} data
 * @param {{milestoneNames: string[], labelNames: string[], fields: Array<{name: string, options?: Array<{name: string}>}>}} known
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
