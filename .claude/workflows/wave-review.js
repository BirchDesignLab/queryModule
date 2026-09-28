/*
 * wave-review: whole-branch review of one wave PR that touches sensitive paths, one ruled fix
 * pass, one re-review, and the review artifact (ADR-0006, amended by #92).
 * Full reference: .claude/workflows/README.md. Test the control flow after any edit:
 * node scripts/sdd/workflow-harness.mjs
 *
 * Invoke: Workflow({ name: "wave-review", args: {
 *   pr: 32, branch: "feat/p0-wave-6",         // at least one of pr, branch is required (both allowed)
 *   base: "<merge-base sha with main>", head: "<wave branch head sha>",
 *   repoDir: "C:\\git\\queryModule", planPath: "docs/superpowers/plans/2026-09-25-p0-contracts.md",
 *   ledgerPath, workDir,                      // SDD workspace: review, fix report, re-review files
 *   scratchRoot, runLabel: "w6-t2",           // agent scratch: <scratchRoot>/<runLabel>/<agent>/
 *   sensitiveFiles: ["packages/core/src/audit/..."], questions: ["..."],
 *   criticalFiles: [], gateFiles: [],          // optional tier slices (#92); see R3 below
 *   reviewedLines: 12,                         // optional small-diff fast path (#92); see R4 below
 *   contextPath: "docs/sdd/.../w6-context.md", // optional context excerpt (#92); see R5 below;
 *                                               // planPath becomes optional when this is given
 *   artifactPath: "docs/reviews/feat-p0-wave-6.md",  // optional; must equal the computed path
 *   specPath, requirementsDoc,                // optional; defaults below
 *   date: "09-27-26",                         // optional MM-DD-YY for the artifact body
 *   trailer: "Co-Authored-By: ...",           // fallback commit trailer for the fixer
 *   tier: "critical",                         // optional: "critical" (default) | "gate" (ADR-0007);
 *                                             // "ordinary" throws (no wave-review needed); when
 *                                             // criticalFiles or gateFiles is given, tier is derived
 *                                             // (critical if criticalFiles is non-empty, else gate)
 *                                             // and a tier that disagrees throws
 *   roles: { reviewer: { model: "opus", effort: "high" }, ... },  // optional overrides; win over
 *                                             // tier defaults; an effort of xhigh or max is logged
 *   answers: [{ at, text?, decisions? }]      // only on a re-run after a stop (below)
 * } })
 * Required: base, head, repoDir, workDir, scratchRoot, runLabel, trailer, at least one of pr or
 * branch, and planPath unless contextPath is given.
 *
 * Artifact path (R2, #92): with branch, docs/reviews/<branch, "/" turned to "-">.md; without it,
 * docs/reviews/pr-<pr>.md. branch is validated exactly like branchArtifactPath in
 * scripts/ci/sensitive-review.ts (every "/"-separated segment matches ^[A-Za-z0-9_][A-Za-z0-9._-]*$
 * and contains no ".."); an invalid branch throws before any agent runs. Prompts name the PR
 * number only when pr is given.
 *
 * Roles and defaults (#92, no default is xhigh or max anywhere): tier "critical" (default):
 * reviewer opus/high, ruler opus/medium, fixer opus/medium, progressChecker sonnet/low, reReviewer
 * opus/high. tier "gate": reviewer opus/medium, ruler opus/low, fixer opus/medium, progressChecker
 * sonnet/low, reReviewer opus/medium. A roles override may still set xhigh or max; the script logs
 * one warning line per role overridden that way.
 *
 * R3 Tier slices: when criticalFiles or gateFiles is given, one reviewer runs per non-empty slice,
 * sequential, gate slice first, critical slice last (role reviewer-gate opus/medium, role
 * reviewer-critical opus/high; a plain roles.reviewer override applies to both, a slice-named
 * override wins over it). Each slice prompt lists and reviews only its own files. Finding ids are
 * prefixed G- or C- and merge into one Rule, Fix, Re-review flow. Only the last slice (the highest
 * tier present) may write the artifact on the first pass, and only when every slice approved clean.
 * When neither list is given, one reviewer runs over sensitiveFiles at tier (today's behaviour).
 *
 * R4 Small-diff fast path: reviewedLines (added plus deleted lines over critical and gate files,
 * from git diff --numstat) <= FAST_PATH_MAX_LINES (50, must equal the constant of the same name in
 * scripts/ci/sensitive-review.ts) runs exactly one reviewer (no slices) at the highest tier's
 * reviewer role. A clean approve writes the artifact with mode: "fast" and the run ends there (no
 * ruler, fixer, progress checker or re-reviewer); a blocking finding runs the normal flow and the
 * re-reviewer's artifact carries no mode line.
 *
 * R5 Context diet: contextPath, when given, replaces the whole plan and ledger in the reviewer,
 * ruler and re-reviewer prompts with a controller-written excerpt (the ledger rulings and the plan
 * and spec lines that touch the changed files); the spec and requirements stay binding.
 *
 * Returns { verdict: "approve" | "fixes", reviewedSha, artifactWritten, findings, residual,
 * answers, declined, rulings, supersededRulings, fixCommits?, strayArtifact?, answersUnconsumed?,
 * stopped?, problem?, escalated?, questions? }.
 * Shas (#222): reviewedSha and the fix head come from verifyHead (a Haiku role that runs git
 * rev-parse and git cat-file -e <sha>^{commit} in repoDir), never from a reviewer, fixer, progress
 * checker or re-reviewer field; a reported sha that differs is logged. An invalid answer stops the
 * run (stopped "precondition", stopPoint "precondition:verifyHead"; answer once to re-run it).
 *   verdict "approve" with artifactWritten: commit the artifact (it records reviewedSha, the
 *     reviewed head, so the artifact commit sits on top) and push.
 *   verdict "approve" without artifactWritten: re-run the review; never hand-write the artifact.
 *   verdict "fixes" without stopped: the single fix pass left residual findings. Adjudicate
 *     them; there is no second fix pass.
 *   stopped set: a controller decision is needed. Each value is a stop point for answers, with
 *   the agent that consumes them:
 *     "reviewer"     the reviewer (or a slice's reviewer, named in problem) returned nothing; text
 *                    goes to the ruler, fixer, re-reviewer.
 *     "precondition" (problem says what) HEAD, base ancestry or a dirty tree, with the files
 *                    named (a stray artifact is called out); stopPoint is precondition:<label>.
 *                    Fix the repo, then answer: the failing agent (reviewer or fixer) re-runs
 *                    once as <label>-retry.
 *     "ruler"        escalated lists the rulings to decide (a critical ruled stands is always
 *                    escalated); decisions settle them, text goes to the fixer and re-reviewer.
 *     "fixer"        questions from a BLOCKED or NEEDS_CONTEXT fixer; text goes to the fixer.
 *     "re-review"    the re-reviewer returned nothing; text goes to the re-reviewer.
 *   strayArtifact set: an artifact file was written without a final approve; delete it.
 * Answering a stop: re-run with resumeFromRunId and the SAME args plus
 *   answers: a list, one entry per answered stop, appended across re-runs, never replaced:
 *   [{ at: <the stopped value, or stopPoint for a precondition>, text: "...", decisions: [{ item,
 *   decision: "fix" | "stands" | "verified", reason, fixInstruction? }] }] (one object = one entry)
 * The reviewer prompt never carries answers, so the review replays from cache. Each entry's text
 * goes to exactly one agent (the first consumer at or after its stop point that runs), so an
 * earlier stop's retry replays from cache too. Decisions from all entries become controller
 * rulings (a later entry wins; final; never re-escalated; a controller stands on a critical is
 * final for the run). Never answer by editing questions: that re-runs the whole review.
 * A fresh run (no resumeFromRunId) is always safe: nothing changes before the fixer.
 * Constraints: wave-review takes no globalConstraints, but the sdd-task rule holds here too:
 * binding text (questions, answers) carries product and code constraints only (runtime, TDD,
 * purity, fixtures, logging, docs style), never process bullets (model and effort plan, PR and
 * push steps, commit trailers, branch naming).
 * Controller before: wave branch committed, clean tree in repoDir, head = the sha to review,
 * ledger current. The script checks nothing out.
 * Resume after a pause, kill or script edit: Workflow({ scriptPath:
 * ".claude/workflows/wave-review.js", args: <the same args>, resumeFromRunId: "<runId>" }).
 * This script never pushes or merges.
 */
export const meta = {
  name: 'wave-review',
  description: 'Whole-branch review of a sensitive wave PR, one ruled fix pass, one re-review, and the review artifact',
  whenToUse: 'Once per wave PR that touches sensitive paths, after every task of the wave has run through sdd-task',
  phases: [
    { title: 'Review', detail: 'whole-branch review against the plan, the spec and the ledger (or a fast-path or tier-sliced review, #92)' },
    { title: 'Rule', detail: 'ruler on plan-mandated or contested findings' },
    { title: 'Fix', detail: 'one fixer pass with the complete findings list, then the progress checker' },
    { title: 'Re-review', detail: 'one fresh re-review of the fix diff; writes the artifact on approve' },
  ],
}

// ---------- arguments ----------
const A = args || {}
for (const k of ['base', 'head', 'repoDir', 'workDir', 'scratchRoot', 'runLabel', 'trailer']) {
  const v = A[k]
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    throw new Error(`wave-review: required arg "${k}" is missing or empty (see .claude/workflows/README.md)`)
  }
}
const hasBranch = typeof A.branch === 'string' && A.branch.trim() !== ''
const hasPr = A.pr !== undefined && A.pr !== null && String(A.pr).trim() !== ''
if (!hasBranch && !hasPr) {
  throw new Error('wave-review: at least one of "branch" or "pr" is required (see .claude/workflows/README.md)')
}
const CONTEXT_PATH = A.contextPath || ''
if (!CONTEXT_PATH) {
  const v = A.planPath
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    throw new Error('wave-review: required arg "planPath" is missing or empty (required unless contextPath is given; see .claude/workflows/README.md)')
  }
}
const QUESTIONS = Array.isArray(A.questions) ? A.questions : []
const prLabel = () => (hasPr ? `PR #${A.pr}` : `branch ${A.branch}`)

// Branch-keyed artifact (R2, #92): mirrors branchArtifactPath in scripts/ci/sensitive-review.ts.
const REF_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/
function branchArtifactPath(ref) {
  const segments = String(ref).split('/')
  if (!segments.every((seg) => REF_SEGMENT_RE.test(seg) && !seg.includes('..'))) return null
  return `docs/reviews/${segments.join('-')}.md`
}
let COMPUTED_ARTIFACT
if (hasBranch) {
  const p = branchArtifactPath(A.branch)
  if (!p) throw new Error(`wave-review: branch "${A.branch}" is not a plain branch name (each "/"-separated segment must match ^[A-Za-z0-9_][A-Za-z0-9._-]*$ and contain no "..")`)
  COMPUTED_ARTIFACT = p
} else {
  COMPUTED_ARTIFACT = `docs/reviews/pr-${A.pr}.md`
}
const ARTIFACT = A.artifactPath || COMPUTED_ARTIFACT
if (String(ARTIFACT).replace(/\\/g, '/') !== COMPUTED_ARTIFACT) {
  throw new Error(`wave-review: artifactPath "${ARTIFACT}" must be ${COMPUTED_ARTIFACT} (the sensitive-review check reads that path)`)
}

// Review tier (ADR-0007) and tier slices (R3, #92).
const TIERS = ['critical', 'gate']
// A non-array or non-string-array criticalFiles/gateFiles must throw, not silently become []: an
// empty list derives the wrong (lower) tier and drops the real file list from review (#92 C3).
function fileListArg(v, name) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.some((f) => typeof f !== 'string' || f.trim() === '')) {
    throw new Error(`wave-review: "${name}" must be an array of non-empty strings, got ${JSON.stringify(v)}`)
  }
  return v
}
const CRITICAL_FILES = fileListArg(A.criticalFiles, 'criticalFiles')
const GATE_FILES = fileListArg(A.gateFiles, 'gateFiles')
const HAS_SLICES = A.criticalFiles !== undefined || A.gateFiles !== undefined
let TIER
let SENSITIVE_FILES
if (HAS_SLICES) {
  if (CRITICAL_FILES.length === 0 && GATE_FILES.length === 0) {
    throw new Error('wave-review: criticalFiles and gateFiles are both empty (no wave-review needed)')
  }
  const derivedTier = CRITICAL_FILES.length ? 'critical' : 'gate'
  if (A.tier !== undefined && A.tier !== null && A.tier !== derivedTier) {
    throw new Error(`wave-review: tier "${A.tier}" disagrees with the derived tier "${derivedTier}" (criticalFiles non-empty means critical, else gate)`)
  }
  TIER = derivedTier
  SENSITIVE_FILES = [...new Set([...GATE_FILES, ...CRITICAL_FILES])]
} else {
  TIER = A.tier === undefined || A.tier === null ? 'critical' : A.tier
  if (TIER === 'ordinary') throw new Error('wave-review: tier "ordinary": no wave-review needed (a PR with only [deps] or [exempt] changes, or no sensitive path, needs no artifact)')
  if (!TIERS.includes(TIER)) throw new Error(`wave-review: tier must be "critical" or "gate", got ${JSON.stringify(A.tier)}`)
  SENSITIVE_FILES = Array.isArray(A.sensitiveFiles) ? A.sensitiveFiles : []
}
const SPEC = A.specPath || 'docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md'
const REQ_DOC = A.requirementsDoc || 'Requirements Definition - Query Module Usability Enhancements.md'
const MAX_LISTED_FILES = 200

// Small-diff fast path (R4, #92).
const FAST_PATH_MAX_LINES = 50 // must equal FAST_PATH_MAX_LINES in scripts/ci/sensitive-review.ts
let REVIEWED_LINES = null
if (A.reviewedLines !== undefined && A.reviewedLines !== null) {
  const n = A.reviewedLines
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    throw new Error(`wave-review: reviewedLines must be a non-negative integer, got ${JSON.stringify(A.reviewedLines)}`)
  }
  REVIEWED_LINES = n
}
const FAST_PATH = REVIEWED_LINES !== null && REVIEWED_LINES <= FAST_PATH_MAX_LINES
const usingSlices = HAS_SLICES && !FAST_PATH

// ---------- answers to stopped runs: a history, one entry per answered stop ----------
// answers: [{ at, text?, decisions? }], appended across re-runs, never replaced; a single object
// is a one-entry list. Positions: reviewer 0 (never gets answers), ruler 2, fixer 3, re-reviewer 5.
// Each entry's text is delivered to exactly one agent: the first consumer at or after its stop
// point that runs, so a later entry never changes an earlier agent's prompt. precondition[:<label>]
// re-runs the failing agent (reviewer or fixer) once. Decisions from all entries apply; a later
// entry wins for the same item.
const STOP_POS = { reviewer: 1, ruler: 2, fixer: 3, 're-review': 5 }
const STOP_POINTS = 'reviewer, precondition (or precondition:<label> from stopPoint: reviewer, fixer, verifyHead), ruler, fixer, re-review'
const PRECONDITION_AT = /^precondition(?::(reviewer|fixer|verifyHead))?$/
let ANSWERS = null
const CONTROLLER = new Map()
if (A.answers !== undefined && A.answers !== null) {
  const list = Array.isArray(A.answers) ? A.answers : [A.answers]
  if (!list.length) throw new Error('wave-review: answers is an empty list')
  const entries = list.map((e, i) => {
    const at = String((e && e.at) || '')
    const pre = PRECONDITION_AT.exec(at)
    if (!pre && !(at in STOP_POS)) {
      throw new Error(`wave-review: answers[${i}].at "${at}" is not a stop point; use the returned stopped value: ${STOP_POINTS}`)
    }
    const text = typeof e.text === 'string' ? e.text.trim() : ''
    const decisions = Array.isArray(e.decisions) ? e.decisions : []
    if (!text && !decisions.length) throw new Error(`wave-review: answers[${i}] needs text or decisions (or both)`)
    for (const d of decisions) {
      if (!d || typeof d.item !== 'string' || !['fix', 'stands', 'verified'].includes(d.decision) || typeof d.reason !== 'string') {
        throw new Error(`wave-review: answers[${i}].decisions entry ${JSON.stringify(d)} needs item, decision (fix | stands | verified) and reason`)
      }
      CONTROLLER.set(d.item, { decision: d.decision, reason: d.reason, fixInstruction: d.fixInstruction || '' })
    }
    return { index: i, at, pos: pre ? -1 : STOP_POS[at], preLabel: pre ? pre[1] || '' : null, text, delivered: !text }
  })
  ANSWERS = { entries, decisionsUsed: new Set() }
  log(`answers: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (${entries.map((e) => e.at).join(', ')}), ${CONTROLLER.size} controller decision(s); the review replays from cache`)
}
const answerBlock = (es, what) => `Controller answers to ${what} (binding):\n${es.map((e) => `* (stop point ${e.at}) ${e.text}`).join('\n')}`
function answersFor(consumerPos) {
  if (!ANSWERS) return ''
  const es = ANSWERS.entries.filter((e) => !e.delivered && e.pos >= 0 && e.pos <= consumerPos)
  if (!es.length) return ''
  for (const e of es) e.delivered = true
  return answerBlock(es, 'the questions of the stopped run')
}
function preconditionAnswers(label) {
  if (!ANSWERS) return ''
  let es = ANSWERS.entries.filter((e) => e.preLabel === label && !e.usedPre)
  if (!es.length) es = ANSWERS.entries.filter((e) => e.preLabel === '' && !e.usedPre).slice(0, 1)
  if (!es.length) return ''
  for (const e of es) { e.usedPre = true; e.delivered = true }
  const withText = es.filter((e) => e.text)
  return withText.length ? answerBlock(withText, 'the precondition failure') : 'The controller reports the precondition failure resolved; check again.'
}

// ---------- roles (R1, #92: no default is xhigh or max anywhere) ----------
const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULTS_BY_TIER = {
  critical: {
    reviewer: { model: 'opus', effort: 'high' },
    ruler: { model: 'opus', effort: 'medium' },
    fixer: { model: 'opus', effort: 'medium' },
    progressChecker: { model: 'sonnet', effort: 'low' },
    reReviewer: { model: 'opus', effort: 'high' },
    verifyHead: { model: 'haiku' }, // reads shas from git (#222); model only: the API rejects effort on Haiku
  },
  gate: {
    reviewer: { model: 'opus', effort: 'medium' },
    ruler: { model: 'opus', effort: 'low' },
    fixer: { model: 'opus', effort: 'medium' },
    progressChecker: { model: 'sonnet', effort: 'low' },
    reReviewer: { model: 'opus', effort: 'medium' },
    verifyHead: { model: 'haiku' },
  },
}
const DEFAULTS = DEFAULTS_BY_TIER[TIER]
const OVR = A.roles || {}
const HOT_EFFORTS = ['xhigh', 'max']
const warnedHotRoles = new Set()
function warnHotOverride(name, effort) {
  if (HOT_EFFORTS.includes(effort) && !warnedHotRoles.has(name)) {
    warnedHotRoles.add(name)
    log(`roles: "${name}" overridden to effort "${effort}" (xhigh or max; no default role uses it)`)
  }
}
function resolveRole(base, overrideObj, name) {
  const r = Object.assign({}, base, overrideObj || {})
  if (!r.model) throw new Error(`wave-review: role "${name}" has no model`)
  if (!MODELS.includes(r.model)) throw new Error(`wave-review: role "${name}" model "${r.model}" is not one of ${MODELS.join(', ')}`)
  if (r.model === 'haiku') return { model: 'haiku' }
  if (!r.effort) throw new Error(`wave-review: role "${name}" (${r.model}) has no effort`)
  if (!EFFORTS.includes(r.effort)) throw new Error(`wave-review: role "${name}" effort "${r.effort}" is invalid`)
  warnHotOverride(name, r.effort)
  return { model: r.model, effort: r.effort }
}
// Returns { model, effort } for agent(); effort omitted for Haiku; throws on a missing model.
function role(name) {
  if (!DEFAULTS[name]) throw new Error(`wave-review: unknown role "${name}"`)
  return resolveRole(DEFAULTS[name], OVR[name], name)
}
// Slice reviewer roles (R3): reviewer-gate / reviewer-critical. A plain roles.reviewer override
// applies to both; a roles["reviewer-<tier>"] override wins over it.
function sliceRole(sliceTier) {
  const name = `reviewer-${sliceTier}`
  const merged = Object.assign({}, OVR.reviewer || {}, OVR[name] || {})
  return resolveRole(DEFAULTS_BY_TIER[sliceTier].reviewer, merged, name)
}
const tier = (name) => { const r = role(name); return r.effort ? `${r.model}/${r.effort}` : r.model }
const sliceTierText = (t) => { const r = sliceRole(t); return r.effort ? `${r.model}/${r.effort}` : r.model }
// Front-matter reviewer and effort follow the role that writes the artifact (defaults give "opus-5.5" / "high").
const REVIEWER_NAME = { opus: 'opus-5.5', sonnet: 'sonnet-5.5', haiku: 'haiku-4.5' }
function frontMatter(roleObj, sha, mode) {
  const lines = ['---', `reviewer: "${REVIEWER_NAME[roleObj.model]}"`, `effort: "${roleObj.effort || 'n/a'}"`, `reviewedSha: "${sha}"`, 'verdict: "approve"']
  if (mode) lines.push(`mode: "${mode}"`)
  lines.push('---')
  return lines.join('\n')
}

// ---------- paths ----------
const fwd = (p) => String(p).replace(/\\/g, '/')
const join = (...p) => p.map((s, i) => (i === 0 ? fwd(s).replace(/\/+$/, '') : fwd(s).replace(/^\/+|\/+$/g, ''))).join('/')
const REPO = fwd(A.repoDir)
const scratch = (label) => join(A.scratchRoot, A.runLabel, label)
const REVIEW_FILE = join(A.workDir, `${A.runLabel}-review.md`)
const sliceReviewFile = (sliceT) => join(A.workDir, `${A.runLabel}-review-${sliceT}.md`)
const REVIEW_FILE_REF = usingSlices
  ? [GATE_FILES.length ? sliceReviewFile('gate') : null, CRITICAL_FILES.length ? sliceReviewFile('critical') : null].filter(Boolean).join(' and ')
  : REVIEW_FILE
const FIX_REPORT = join(A.workDir, `${A.runLabel}-fix-report.md`)
const REREVIEW_FILE = join(A.workDir, `${A.runLabel}-re-review.md`)
const ARTIFACT_ABS = join(REPO, ARTIFACT)

// ---------- schemas ----------
const COMMITS = { type: 'array', items: { type: 'object', properties: { sha: { type: 'string' }, subject: { type: 'string' } }, required: ['sha', 'subject'] } }
const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'important', 'minor'] },
    file: { type: 'string' },
    line: { type: 'string', description: 'line or range; "" if not line-bound' },
    summary: { type: 'string' },
    fix: { type: 'string' },
    planMandated: { type: 'boolean' },
    contests: { type: 'string', description: 'the ledger Ruling line this finding disputes, verbatim; "" if none' },
  },
  required: ['id', 'severity', 'file', 'line', 'summary', 'fix', 'planMandated', 'contests'],
}
const ANSWERS_SCHEMA = { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] } }
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'fixes'] },
    reviewedSha: { type: 'string', description: 'full sha of the reviewed head (git rev-parse)' },
    preconditionFailed: { type: 'string', description: 'what failed in the precondition check; "" when it holds' },
    findings: { type: 'array', items: FINDING },
    answers: ANSWERS_SCHEMA,
    declined: { type: 'array', items: { type: 'object', properties: { behavior: { type: 'string' }, reason: { type: 'string' } }, required: ['behavior', 'reason'] } },
    artifactWritten: { type: 'boolean' },
  },
  required: ['verdict', 'reviewedSha', 'preconditionFailed', 'findings', 'answers', 'declined', 'artifactWritten'],
}
const RULINGS = {
  type: 'object',
  properties: {
    rulings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'the finding id exactly as given' },
          decision: { type: 'string', enum: ['fix', 'stands', 'verified', 'escalate'] },
          reason: { type: 'string' },
          costIfWrong: { type: 'string' },
          fixInstruction: { type: 'string' },
          command: { type: 'string' },
        },
        required: ['item', 'decision', 'reason', 'costIfWrong'],
      },
    },
  },
  required: ['rulings'],
}
const WORK = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
    commits: COMMITS,
    head: { type: 'string' },
    testSummary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['planVsSpec', 'correctness', 'observation'] }, text: { type: 'string' } }, required: ['kind', 'text'] } },
    questions: { type: 'array', items: { type: 'string' } },
    preconditionFailed: { type: 'string', description: 'set (with what you found) only when the stated precondition does not hold; then change nothing' },
  },
  required: ['status', 'commits', 'head', 'testSummary', 'concerns', 'questions'],
}
const PROGRESS = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    head: { type: 'string' },
    newCommits: COMMITS,
    testCount: { type: 'integer' },
  },
  required: ['ok', 'problems', 'head', 'newCommits', 'testCount'],
}
const REREVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'fixes'] },
    reviewedSha: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['ADDRESSED', 'NOT ADDRESSED', 'STANDS'] }, evidence: { type: 'string' } },
        required: ['id', 'verdict', 'evidence'],
      },
    },
    acceptedStands: {
      type: 'array',
      description: 'every important finding you accept as STANDS, with the id of the ruling that keeps it',
      items: { type: 'object', properties: { id: { type: 'string' }, rulingId: { type: 'string' } }, required: ['id', 'rulingId'] },
    },
    newFindings: { type: 'array', items: FINDING },
    artifactWritten: { type: 'boolean' },
  },
  required: ['verdict', 'reviewedSha', 'verdicts', 'acceptedStands', 'newFindings', 'artifactWritten'],
}

// ---------- shared prompt pieces ----------
const GIT = `Shell: Git Bash. Run every git and shell command in ${REPO} (cd there, or git -C "${REPO}").`
const HOUSE = [
  'Rules:',
  '- Never dispatch subagents. Do all of this work yourself; if the diff is too large for one pass, review it in passes and say so.',
  '- Finish every command before you reply; leave nothing running in the background.',
  '- No filesystem-wide searches: read the files named here and the files they lead you to.',
  '- Do not push, open a PR, merge or commit unless this prompt says to commit.',
].join('\n')
const READONLY = 'Read-only on this checkout: never change the working tree, the index, HEAD or any branch. For another revision use a separate worktree under your scratch directory. You write only your report file, your scratch directory, and (when this prompt allows it) the artifact.'
const RULER_RULE = 'In wave-review the ruler must escalate any ruling that would: (a) weaken a security, audit, credential, delegation or dispatch invariant; (b) change a shape frozen at a phase gate or listed as a contract file (master plan 8.2); (c) keep a Critical finding with stands. Everything else it rules. A Critical finding may be ruled fix or escalate, never stands.'
const findingsText = (fs) => fs.map((f) => `- [${f.id}] ${f.severity.toUpperCase()} ${f.file}${f.line ? ':' + f.line : ''}: ${f.summary}${f.fix ? ' Fix: ' + f.fix : ''}`).join('\n')
const DATE_RULE = A.date ? `Date: ${A.date}.` : 'Date: today in MM-DD-YY (run date +%m-%d-%y).'
// R6: every reviewer prompt (slices, fast path and re-reviewer) allows at most 3 cross-cutting checks.
const CROSS_CUTTING = 'Cross-cutting budget: at most 3 checks outside the diff, each for a named risk (examples: a new file in a sensitive area missing from .github/sensitive-paths; a guard or check that a changed path can now bypass; a dependency or lockfile rule). List each one, with the risk and what you found, under "Cross-cutting checks" in your review file.'
// R5: contextPath replaces the whole plan and ledger in the reviewer, ruler and re-reviewer prompts.
function planLedgerLines() {
  if (CONTEXT_PATH) {
    return [`Context excerpt (in place of the whole plan and ledger): ${CONTEXT_PATH}. It holds the ledger rulings and the plan and spec lines that touch the changed files; read only what it cites unless a named risk needs more. The spec and the requirements stay binding.`]
  }
  return [
    `Plan: ${A.planPath} (the tasks this range delivers).`,
    A.ledgerPath ? `Ledger: ${A.ledgerPath}. Read every "Ruling:" and "minor (deferred):" line for these tasks. A deferred minor is known, not new; re-raise it only if it is worse than recorded. A finding that disputes a Ruling sets contests to that Ruling line.` : 'No ledger given.',
  ]
}
const planRef = () => (CONTEXT_PATH ? `the context excerpt ${CONTEXT_PATH}` : `the plan ${A.planPath}`)
function artifactRule(roleObj, shaWord, opts = {}) {
  const condition = opts.condition || 'your verdict is approve with no open critical or important finding'
  return [
    `Write the artifact ${ARTIFACT_ABS} ONLY when ${condition}. Do not commit it. It starts with exactly this front matter, with <sha> replaced by the full ${shaWord} sha:`,
    '```',
    frontMatter(roleObj, '<sha>', opts.mode),
    '```',
    `Then a short body: Scope (${prLabel()}, range, what the wave delivers), Findings summary (counts by severity, how each critical or important was resolved, each ruling id kept as stands, each controller ruling), Cross-cutting checks (each named risk checked outside the diff and what you found), Answers to the controller's questions, Remaining Minors. No em dashes. ${DATE_RULE}`,
    'Otherwise do not create or touch the artifact. Set artifactWritten accordingly.',
  ].join('\n')
}

// ---------- rulings: one in force per item; controller > ruler, later > earlier ----------
const state = { rulings: new Map(), superseded: [], fixCommits: [], answers: [], declined: [] }
const blocking = (f) => f.severity === 'critical' || f.severity === 'important'
const inForce = () => [...state.rulings.values()]
function setRuling(rec) {
  const old = state.rulings.get(rec.item)
  if (old && old.source === 'controller' && rec.source !== 'controller') {
    log(`rule: ruler ruling on ${rec.item} ignored; the controller ruling stays`)
    return
  }
  if (old) state.superseded.push({ item: rec.item, old, new: rec })
  state.rulings.set(rec.item, rec)
}
function rulingsText() {
  const list = inForce()
  if (!list.length) return ''
  return ['Rulings in force (binding; never reverse one):', ...list.map((r) => `* ruling ${r.item}: ${r.decision}${r.source === 'controller' ? ' (controller, final)' : ''}: ${r.reason}`)].join('\n')
}
// ---------- verifyHead (#222) ----------
// The only source of a reviewed or fix-head sha in this script. One Haiku agent reads git
// (git rev-parse <rev> and git cat-file -e <sha>^{commit}); the script accepts only a 40-hex sha it
// confirmed exists. agentSha is what a reviewer, fixer or progress checker reported: compared and
// logged on a difference, never used. rev is A.head for the review (the reviewer resolves
// reviewedSha with git rev-parse <head>) and HEAD after the fix pass. Returns { head, differs } (differs: agentSha named another commit) or { problem }.
const SHA40 = /^[0-9a-f]{40}$/
const VERIFY_HEAD = {
  type: 'object',
  properties: {
    revParse: { type: 'string', description: 'the raw stdout of the rev-parse command, copied exactly' },
    catFile: { type: 'string', description: 'the raw stdout of the cat-file check: EXISTS <sha> or MISSING' },
  },
  required: ['revParse', 'catFile'],
}
const gitSha = (v) => {
  const head = String((v && v.revParse) || '').trim()
  return SHA40.test(head) && String((v && v.catFile) || '').trim() === `EXISTS ${head}` ? head : null
}
async function verifyHead(agentSha, label, rev) {
  const prompt = [
    `Read-only git check in ${REPO}. Run these two commands in Git Bash and return the raw stdout of each, copied exactly, with no interpretation. Change nothing.`,
    `1. git -C "${REPO}" rev-parse ${rev}`,
    `2. sha=$(git -C "${REPO}" rev-parse ${rev}) && git -C "${REPO}" cat-file -e "$sha^{commit}" && echo "EXISTS $sha" || echo MISSING`,
    'Return revParse (the stdout of command 1) and catFile (the stdout of command 2).',
    HOUSE,
  ].join('\n')
  const run = (p, l) => agent(p, { label: l, phase: 'Review', schema: VERIFY_HEAD, ...role('verifyHead') })
  let v = await run(prompt, label)
  let head = gitSha(v)
  if (!head) {
    const ans = preconditionAnswers('verifyHead')
    if (ans) {
      log(`verifyHead: ${label} returned no valid sha; retrying with the controller answer`)
      v = await run(`${prompt}\n\n${ans}`, `${label}-retry`)
      head = gitSha(v)
    }
  }
  if (!head) {
    const shown = v ? JSON.stringify({ revParse: String(v.revParse).slice(0, 60), catFile: String(v.catFile).slice(0, 20) }) : 'no result'
    return { problem: `verifyHead: ${label} did not return a 40-hex sha that exists in git (${shown}); check the repository in ${REPO}, then answer at precondition:verifyHead to re-run it once` }
  }
  const a = String(agentSha || '').trim().toLowerCase()
  const differs = !!a && !(a.length >= 7 && head.startsWith(a))
  if (differs) log(`agent-reported head ${a.slice(0, 16)}... differs from git; using git`)
  return { head, differs }
}
function done(extra) {
  const out = Object.assign({ answers: state.answers, declined: state.declined, rulings: inForce(), supersededRulings: state.superseded }, extra)
  if (ANSWERS) {
    const unused = [...CONTROLLER.keys()].filter((k) => !ANSWERS.decisionsUsed.has(k))
    if (unused.length) log(`answers: decision(s) matched no finding and were not applied: ${unused.join(', ')}`)
    const pending = ANSWERS.entries.filter((e) => !e.delivered)
    if (pending.length) {
      log(`answers not consumed: ${pending.map((e) => `answers[${e.index}] (${e.at})`).join(', ')} (no consumer ran in this run)`)
      out.answersUnconsumed = true
    }
  }
  return out
}

// ================= 1. Whole-branch review (single, tier-sliced, or fast path) =================
phase('Review')
{
  const roleSummary = usingSlices
    ? `reviewer-gate ${GATE_FILES.length ? sliceTierText('gate') : 'n/a'}, reviewer-critical ${CRITICAL_FILES.length ? sliceTierText('critical') : 'n/a'}`
    : `reviewer ${tier('reviewer')}`
  log(`wave-review ${prLabel()} ${String(A.base).slice(0, 7)}..${String(A.head).slice(0, 7)}; tier ${TIER}${FAST_PATH ? `; fast path (reviewedLines ${REVIEWED_LINES})` : usingSlices ? '; tier slices' : ''}; roles: ${roleSummary}, ruler ${tier('ruler')}, fixer ${tier('fixer')}, progress ${tier('progressChecker')}, re-review ${tier('reReviewer')}`)
}

// Shared reviewer-prompt pieces (main/fast reviewer and each slice reviewer).
const SPEC_INTRO = [
  `Spec: ${SPEC}. Requirements: "${REQ_DOC}".`,
  'The spec is binding authority: where the plan and the spec disagree, the spec wins unless a ledger Ruling or an ADR in docs/decisions/ says otherwise; say which governs each such finding. For behaviour the spec is silent on, a reasonable user\'s expectation is a requirement, and a spec\'s silence is not permission.',
]
const CHECKS = [
  'Check: plan alignment (all planned functionality present, deviations justified); correctness and edge cases; error handling; type safety; security, CJIS and GDPR exposure in the sensitive files (credentials, audit rows never deleted or rewritten, fail-open paths, real-looking records in fixtures); architecture and integration; tests verify real behaviour; production readiness (migrations, backward compatibility, docs).',
  'Severity: critical = broken behaviour, security or data risk; important = must fix before merge; minor = polish. A defect the plan explicitly mandates is still a finding: important, planMandated true. Every finding cites file:line and says why it matters and how to fix.',
  'Declined to judge: list every behaviour you considered and set aside as outside the plan or spec, one per entry with the reason. The controller rules on each; nothing set aside is dropped silently.',
]
const TESTS_LINE = 'Tests: each task already ran its suite and an independent gate. Run pnpm lint, pnpm typecheck or pnpm test at the head only for a named doubt; record the result.'
function preconditionLine() {
  return `Precondition, checked first: git rev-parse ${A.head} resolves, ${A.base} is its ancestor (git merge-base --is-ancestor ${A.base} ${A.head}), and git status --porcelain prints nothing. If any fails, set preconditionFailed to what you found, write nothing, report no findings, and stop. It is never a finding. For a dirty tree, name each untracked or modified file from git status --porcelain; an untracked ${ARTIFACT} is a stray artifact from an earlier run, so say "stray artifact ${ARTIFACT}: delete it before re-running".`
}

let review
if (usingSlices) {
  // ---- R3: tier slices, sequential, gate first, critical last ----
  async function runSliceReviewer(sliceT, files, isLast, earlier) {
    const label = `reviewer-${sliceT}`
    const roleObj = sliceRole(sliceT)
    const out = sliceReviewFile(sliceT)
    const isCapped = files.length > MAX_LISTED_FILES
    const capped = isCapped ? files.slice(0, MAX_LISTED_FILES) : files
    if (isCapped) log(`cap: ${sliceT}Files has ${files.length} entries; ${label} lists the first ${MAX_LISTED_FILES} and derives the rest from the sensitive-path globs`)
    // The diff pathspec always covers every file in the slice, even when the prompt's printed file
    // list is capped for readability: a capped pathspec would silently drop files 201+ from the
    // diff itself, which the reviewer has no way to notice (#92 C2).
    const pathspec = files.map((f) => `"${f}"`).join(' ')
    const earlierNote = earlier
      ? `The gate slice already ran: verdict ${earlier.verdict}, ${earlier.openCount} open critical or important finding(s). ${isLast ? 'Write the artifact only when your own verdict is also approve with no open critical or important finding, and that count above is 0.' : ''}`
      : ''
    const artifactClause = isLast
      ? artifactRule(roleObj, 'reviewed head', {
          condition: earlier
            ? 'your verdict is approve with no open critical or important finding, and the gate slice above also approved with no open critical or important finding'
            : 'your verdict is approve with no open critical or important finding',
        })
      : `Do not write the artifact ${ARTIFACT_ABS}: only the last slice's reviewer may write it, and only when every slice approved clean. Set artifactWritten to false.`
    const prompt = [
      `You are the ${sliceT}-tier reviewer for ${prLabel()}, one tier slice of this run (gate slice first, critical slice last${isLast && !earlier ? ', and the only slice this run' : ''}): review every commit in ${A.base}..${A.head} that touches your files. Review completed work against its plan and requirements and find issues before they merge.`,
      ...SPEC_INTRO,
      ...planLedgerLines(),
      `Your files, ${sliceT} tier only (read each in full, not only its hunks):\n${capped.map((f) => `* ${f}`).join('\n')}${isCapped ? `\n(and ${files.length - MAX_LISTED_FILES} more not listed here; the diff above still covers them. Derive the rest of your ${sliceT} tier from the sensitive-path globs in .github/sensitive-paths.)` : ''}`,
      QUESTIONS.length ? `Controller questions (answer each in answers, with file:line evidence):\n${QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : 'No controller questions.',
      earlierNote,
      '',
      preconditionLine(),
      `Build your view first: mkdir -p "${scratch(label)}" && cd "${REPO}" && { git log --oneline ${A.base}..${A.head} -- ${pathspec}; echo; git diff --stat ${A.base}..${A.head} -- ${pathspec}; echo; git diff -U10 ${A.base}..${A.head} -- ${pathspec}; } > "${scratch(label)}/branch.diff"; then read it. Resolve reviewedSha with git rev-parse ${A.head}.`,
      'Diff scope: your files only. After the diff, read outside them only files that call or are called by the changed code, and only for a concrete risk you can name, one focused check per risk (see the cross-cutting budget below); the plan, spec and requirement lines the changed tasks cite and the ledger Rulings still apply; do not read unrelated files. Name each file you read outside your files and the risk that sent you there.',
      READONLY,
      TESTS_LINE,
      '',
      ...CHECKS,
      CROSS_CUTTING,
      `Write your full report to ${out}: Strengths, Issues (Critical, Important, Minor), Cross-cutting checks, Answers, Declined to judge, Assessment (approve or fixes, with reasoning).`,
      artifactClause,
      HOUSE,
      'verdict: approve only with no critical or important finding. preconditionFailed: "" when the precondition holds.',
    ].filter(Boolean).join('\n')
    let res = await agent(prompt, { label, phase: 'Review', schema: REVIEW, ...roleObj })
    const pre = res && res.preconditionFailed ? preconditionAnswers('reviewer') : ''
    if (pre) {
      log(`review: cached precondition failure (${res.preconditionFailed}) on the ${sliceT} slice; retrying with the controller answer`)
      res = await agent(`${prompt}\n\n${pre}`, { label: `${label}-retry`, phase: 'Review', schema: REVIEW, ...roleObj })
    }
    return res
  }

  const sliceResults = []
  let earlier = null
  for (const [sliceT, files, isLast] of [
    ['gate', GATE_FILES, CRITICAL_FILES.length === 0],
    ['critical', CRITICAL_FILES, true],
  ]) {
    if (!files.length) continue
    const res = await runSliceReviewer(sliceT, files, isLast, earlier)
    if (!res) {
      log(`review: ${sliceT} slice reviewer returned null (skipped or died); stopping`)
      return done({ verdict: 'fixes', stopped: 'reviewer', problem: `${sliceT} slice reviewer returned no result`, reviewedSha: null, artifactWritten: false, findings: [], residual: [] })
    }
    if (res.preconditionFailed) {
      log(`review: ${sliceT} slice precondition failed: ${res.preconditionFailed}; stopping before any ruler or fixer`)
      return done({ verdict: 'fixes', stopped: 'precondition', stopPoint: 'precondition:reviewer', problem: `${sliceT} slice reviewer: ${res.preconditionFailed}`, reviewedSha: null, artifactWritten: false, findings: [], residual: [] })
    }
    const prefix = sliceT === 'gate' ? 'G-' : 'C-'
    const findings = res.findings.map((f) => Object.assign({}, f, { id: `${prefix}${f.id}` }))
    const openCount = findings.filter(blocking).length
    log(`review: ${sliceT} slice ${res.verdict}, ${findings.length} finding(s) (${openCount} critical/important), artifact ${isLast && res.artifactWritten ? 'written' : 'not written'}`)
    // artifactWritten is masked to isLast (only the designated writer's claim counts for the
    // "did the real write happen" success signal); rawArtifactWritten is never masked, so a write
    // by any slice (including one that was told not to) still surfaces below (#92 C1).
    const data = { tier: sliceT, verdict: res.verdict, openCount, findings, answers: res.answers, declined: res.declined, reviewedSha: res.reviewedSha, artifactWritten: !!(isLast && res.artifactWritten), rawArtifactWritten: !!res.artifactWritten }
    sliceResults.push(data)
    earlier = data
  }
  const last = sliceResults[sliceResults.length - 1]
  const allApprove = sliceResults.every((s) => s.verdict === 'approve' && s.openCount === 0)
  review = {
    verdict: allApprove ? 'approve' : 'fixes',
    rawArtifactWritten: sliceResults.some((s) => s.rawArtifactWritten),
    reviewedSha: last.reviewedSha,
    preconditionFailed: '',
    findings: sliceResults.flatMap((s) => s.findings),
    answers: sliceResults.flatMap((s) => s.answers),
    declined: sliceResults.flatMap((s) => s.declined),
    artifactWritten: allApprove && last.artifactWritten,
  }
} else {
  // ---- single reviewer: today's whole-tier review, or the R4 fast path over every critical/gate file ----
  const roleObj = role('reviewer')
  const capped = SENSITIVE_FILES.length > MAX_LISTED_FILES ? SENSITIVE_FILES.slice(0, MAX_LISTED_FILES) : SENSITIVE_FILES
  if (SENSITIVE_FILES.length > MAX_LISTED_FILES) log(`cap: sensitiveFiles has ${SENSITIVE_FILES.length} entries; the prompt lists the first ${MAX_LISTED_FILES} and tells the reviewer to derive the rest from the sensitive-path globs`)
  const reviewPrompt = [
    `You are the whole-branch reviewer for ${prLabel()}: every commit in ${A.base}..${A.head}.${FAST_PATH ? ` Small-diff fast path: reviewedLines ${REVIEWED_LINES} (<= ${FAST_PATH_MAX_LINES}); you are the only reviewer and cover every critical and gate file.` : ''} Review completed work against its plan and requirements and find issues before they merge.`,
    ...SPEC_INTRO,
    ...planLedgerLines(),
    SENSITIVE_FILES.length ? `Sensitive files in this range (read each in full, not only its hunks):\n${capped.map((f) => `* ${f}`).join('\n')}` : 'No sensitive-file list given; derive it from the sensitive-path globs in the repo if present.',
    QUESTIONS.length ? `Controller questions (answer each in answers, with file:line evidence):\n${QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : 'No controller questions.',
    '',
    preconditionLine(),
    `Build your view first: mkdir -p "${scratch('reviewer')}" && cd "${REPO}" && { git log --oneline ${A.base}..${A.head}; echo; git diff --stat ${A.base}..${A.head}; echo; git diff -U10 ${A.base}..${A.head}; } > "${scratch('reviewer')}/branch.diff"; then read it. Resolve reviewedSha with git rev-parse ${A.head}.`,
    'Diff scope: after the diff, read outside the diff only files that call or are called by the changed code, and only for a concrete risk you can name, one focused check per risk; the plan, spec and requirement lines the changed tasks cite and the ledger Rulings still apply; do not read unrelated files. The controller questions and the sensitive-file list steer where you look first. Name each file you read outside the diff and the risk that sent you there.',
    READONLY,
    TESTS_LINE,
    '',
    ...CHECKS,
    CROSS_CUTTING,
    `Write your full report to ${REVIEW_FILE}: Strengths, Issues (Critical, Important, Minor), Cross-cutting checks, Answers, Declined to judge, Assessment (approve or fixes, with reasoning).`,
    artifactRule(roleObj, 'reviewed head', FAST_PATH ? { mode: 'fast' } : {}),
    HOUSE,
    'verdict: approve only with no critical or important finding. preconditionFailed: "" when the precondition holds.',
  ].filter(Boolean).join('\n')
  review = await agent(reviewPrompt, { label: 'reviewer', phase: 'Review', schema: REVIEW, ...roleObj })

  const reviewPre = review && review.preconditionFailed ? preconditionAnswers('reviewer') : ''
  if (reviewPre) {
    log(`review: cached precondition failure (${review.preconditionFailed}); retrying the reviewer with the controller answer`)
    review = await agent(`${reviewPrompt}\n\n${reviewPre}`, { label: 'reviewer-retry', phase: 'Review', schema: REVIEW, ...roleObj })
  }
}

if (!review) {
  log('review: reviewer returned null (skipped or died); stopping')
  return done({ verdict: 'fixes', stopped: 'reviewer', reviewedSha: null, artifactWritten: false, findings: [], residual: [] })
}
if (review.preconditionFailed) {
  log(`review: precondition failed: ${review.preconditionFailed}; stopping before any ruler or fixer`)
  return done({ verdict: 'fixes', stopped: 'precondition', stopPoint: 'precondition:reviewer', problem: `reviewer: ${review.preconditionFailed}`, reviewedSha: null, artifactWritten: false, findings: [], residual: [] })
}
// The single-reviewer path never masks its own artifactWritten claim, so rawArtifactWritten (set
// by the slice path above) mirrors it here rather than being left unset (#92 C1).
if (review.rawArtifactWritten === undefined) review.rawArtifactWritten = !!review.artifactWritten
// The reviewed sha is read from git (#222), never taken from the reviewer's JSON.
let badArtifact = false
{
  const vr = await verifyHead(review.reviewedSha, 'verify-head-review', A.head)
  if (vr.problem) {
    log(`review: ${vr.problem}; stopping`)
    return done({ verdict: 'fixes', stopped: 'precondition', stopPoint: 'precondition:verifyHead', problem: vr.problem, reviewedSha: null, artifactWritten: false, findings: [], residual: [], strayArtifact: review.artifactWritten || review.rawArtifactWritten ? ARTIFACT : undefined })
  }
  review.reviewedSha = vr.head
  // K2: an artifact the reviewer wrote records the sha it reported; when that is not git's, the file
  // vouches for a head that was not reviewed, so it is never returned as the written artifact.
  if (vr.differs && (review.artifactWritten || review.rawArtifactWritten)) {
    log('review: the reviewer reported a reviewedSha that differs from git, so the artifact it wrote records the wrong sha; returned as strayArtifact, re-run the review')
    review.artifactWritten = false
    badArtifact = true
  }
}
state.answers = review.answers
state.declined = review.declined
const firstBlocking = review.findings.filter(blocking)
log(`review: ${review.verdict}, ${review.findings.length} finding(s) (${firstBlocking.length} critical/important), ${review.answers.length} answer(s), ${review.declined.length} declined, artifact ${review.artifactWritten ? 'written' : 'not written'}`)
if (review.declined.length) log(`review: ${review.declined.length} declined-to-judge item(s) returned for the controller to rule on`)

if (review.verdict === 'approve' && firstBlocking.length === 0) {
  if (!review.artifactWritten) log('review: approve but the artifact was not written; re-run the review, never hand-write it')
  return done({ verdict: 'approve', reviewedSha: review.reviewedSha, artifactWritten: review.artifactWritten, findings: review.findings, residual: review.findings.filter((f) => !blocking(f)), strayArtifact: badArtifact ? ARTIFACT : undefined })
}
if (review.verdict === 'approve') log(`review: verdict approve but ${firstBlocking.length} critical/important finding(s); treating as fixes`)
// rawArtifactWritten catches a write by any slice (not only the last one the merge credits), so a
// stray write is never masked away by the merge that computes the success-path artifactWritten
// (#92 C1).
let stray = !!(review.artifactWritten || review.rawArtifactWritten)
if (stray) log('review: artifact written despite blocking findings; the re-review overwrites it on approve, otherwise it is returned as strayArtifact')

// ================= 2. Controller decisions, then the ruler =================
let toFix = review.findings.map((f) => Object.assign({}, f))
for (const f of review.findings) {
  const d = CONTROLLER.get(f.id)
  if (!d) continue
  ANSWERS.decisionsUsed.add(f.id)
  setRuling({ item: f.id, what: f.summary.slice(0, 160), decision: d.decision, reason: d.reason, costIfWrong: 'controller decision', fixInstruction: d.fixInstruction, command: '', source: 'controller' })
  log(`rule: ${f.id} settled by controller decision: ${d.decision}`)
  if (d.decision === 'fix') toFix = toFix.map((x) => (x.id === f.id ? Object.assign({}, x, { fix: d.fixInstruction || d.reason }) : x))
  else toFix = toFix.filter((x) => x.id !== f.id)
}
const contested = toFix.filter((f) => !CONTROLLER.has(f.id) && blocking(f) && (f.planMandated || (f.contests && f.contests.trim())))
if (contested.length) {
  phase('Rule')
  log(`rule: ${contested.length} plan-mandated or contested finding(s) to the ruler (${tier('ruler')})`)
  const res = await agent(
    [
      `You are the ruler for ${prLabel()} (${A.base}..${review.reviewedSha}). The spec (${SPEC}) is binding; the plan is not when it conflicts. ${CONTEXT_PATH ? `Context excerpt: ${CONTEXT_PATH} (ledger rulings and the plan and spec lines that touch the changed files); read only what it cites unless an item needs more.` : `ADRs in docs/decisions/ and ledger Rulings${A.ledgerPath ? ` (${A.ledgerPath})` : ''} are in force unless the spec contradicts them.`}`,
      `The full review is ${REVIEW_FILE_REF}. Read only the spec sections, ${CONTEXT_PATH ? 'the context excerpt' : 'plan text'} and files each item needs. ${GIT}`,
      rulingsText(),
      answersFor(2),
      '',
      'Items:',
      ...contested.map((f) => `- [${f.id}] ${f.severity} ${f.file}${f.line ? ':' + f.line : ''}: ${f.summary}${f.planMandated ? ' (plan-mandated)' : ''}${f.contests ? ` (contests: ${f.contests})` : ''} Reviewer fix: ${f.fix}`),
      '',
      'Decide each: fix (give fixInstruction, the smallest change), stands (code stays; cite why), verified (you checked it and it passed; put the command and result in command; a failed check is fix), or escalate (only when every path is a guess, or the action is irreversible or security-sensitive).',
      RULER_RULE,
      'costIfWrong: one line. You are read-only: edit and commit nothing. Scratch: ' + scratch('ruler'),
      HOUSE,
      'Return one ruling per item, item = the id exactly as given.',
    ].filter(Boolean).join('\n'),
    { label: 'ruler', phase: 'Rule', schema: RULINGS, ...role('ruler') },
  )
  const byId = new Map(((res && res.rulings) || []).map((r) => [r.item.replace(/^\[|\]$/g, '').trim(), r]))
  const escalated = []
  for (const f of contested) {
    let r = byId.get(f.id)
    if (!r) { log(`rule: no ruling for ${f.id}; it stays in the fix list`); continue }
    if (f.severity === 'critical' && (r.decision === 'stands' || r.decision === 'verified')) {
      log(`rule: ${f.id} is critical and was ruled ${r.decision}; escalated (a critical is never kept as stands; answer with answers.decisions to settle it)`)
      r = Object.assign({}, r, { decision: 'escalate', reason: `ruled ${r.decision} on a critical finding: ${r.reason}` })
    }
    setRuling({ item: f.id, what: f.summary.slice(0, 160), decision: r.decision, reason: r.reason, costIfWrong: r.costIfWrong, fixInstruction: r.fixInstruction || '', command: r.command || '', source: 'ruler' })
    if (r.decision === 'escalate') escalated.push(Object.assign({ finding: f }, r))
    else if (r.decision === 'stands' || r.decision === 'verified') toFix = toFix.filter((x) => x.id !== f.id)
    else if (r.decision === 'fix' && r.fixInstruction) toFix = toFix.map((x) => (x.id === f.id ? Object.assign({}, x, { fix: r.fixInstruction }) : x))
  }
  if (!res) log('rule: ruler returned null; every contested finding stays in the fix list')
  if (escalated.length) {
    log(`rule: ${escalated.length} escalation(s); stopping before any fix`)
    return done({ verdict: 'fixes', reviewedSha: review.reviewedSha, artifactWritten: false, stopped: 'ruler', escalated, findings: review.findings, residual: toFix, strayArtifact: stray ? ARTIFACT : undefined })
  }
}

// ================= 3. One fix pass =================
const mustFix = toFix.filter(blocking)
const minors = toFix.filter((f) => !blocking(f))
let fixHead = review.reviewedSha
const progressFindings = []
if (mustFix.length || minors.length) {
  phase('Fix')
  log(`fix: one pass, ${mustFix.length} critical/important and ${minors.length} minor finding(s)`)
  const fixPrompt = [
    `You are fixing the whole-branch review findings of ${prLabel()} at ${review.reviewedSha}. Read the review ${REVIEW_FILE_REF} and ${planRef()} and spec ${SPEC} sections the findings cite.`,
    `Precondition: git rev-parse HEAD is ${review.reviewedSha} and git status --porcelain prints nothing (an untracked ${ARTIFACT} is allowed). If not, change nothing, set preconditionFailed to what you found (for a dirty tree, name each untracked or modified file from git status --porcelain), and report BLOCKED.`,
    rulingsText(),
    'Never reverse a ruling in force. If a finding cannot be fixed without reversing one, leave it and say so in concerns (kind planVsSpec).',
    answersFor(3),
    '',
    'Must fix (all of them; a given Fix is the ruled change):',
    mustFix.length ? findingsText(mustFix) : '(none)',
    '',
    'Minor (fix when small and safe; otherwise leave it and list it in concerns as observation):',
    minors.length ? findingsText(minors) : '(none)',
    '',
    'TDD: for each behavioural finding write or tighten a failing test first, see it fail, fix, see it pass. Then run pnpm lint, pnpm typecheck and pnpm coverage once each.',
    `Write ${FIX_REPORT}: per finding id, the change (file:line), the covering tests, commands and RED/GREEN output, and the lint, typecheck and test results.`,
    `Commit only the files you changed (git add <paths>, never git add -A), message "fix: wave review findings for ${prLabel()}", body listing the finding ids. End the message with the attribution trailer your session's system reminder gives; if none, use:\n${A.trailer}`,
    GIT,
    'Never run git push, gh pr (any subcommand), gh api writes, or git merge into another branch; the controller and the developer own the remote.',
    HOUSE,
    'Use BLOCKED or NEEDS_CONTEXT with questions only when you cannot proceed at all.',
  ].filter(Boolean).join('\n')
  let fx = await agent(fixPrompt, { label: 'fixer', phase: 'Fix', schema: WORK, ...role('fixer') })
  const fixPre = fx && fx.preconditionFailed ? preconditionAnswers('fixer') : ''
  if (fixPre) {
    log(`fix: cached precondition failure (${fx.preconditionFailed}); retrying the fixer with the controller answer`)
    fx = await agent(`${fixPrompt}\n\n${fixPre}`, { label: 'fixer-retry', phase: 'Fix', schema: WORK, ...role('fixer') })
  }
  if (fx && fx.preconditionFailed) {
    log(`fix: precondition failed: ${fx.preconditionFailed}; stopping, never a finding`)
    return done({ verdict: 'fixes', reviewedSha: review.reviewedSha, artifactWritten: false, stopped: 'precondition', stopPoint: 'precondition:fixer', problem: `fixer: ${fx.preconditionFailed}`, findings: review.findings, residual: toFix, strayArtifact: stray ? ARTIFACT : undefined })
  }
  if (!fx || fx.status === 'BLOCKED' || fx.status === 'NEEDS_CONTEXT') {
    log(`fix: fixer ${fx ? fx.status : 'returned null'}; stopping`)
    return done({ verdict: 'fixes', reviewedSha: review.reviewedSha, artifactWritten: false, stopped: 'fixer', questions: fx ? fx.questions : ['fixer returned no result'], findings: review.findings, residual: toFix, strayArtifact: stray ? ARTIFACT : undefined })
  }
  const pc = await agent(
    [
      `Check the fix pass on ${prLabel()} in ${REPO}. Fix base: ${review.reviewedSha}. ${GIT}`,
      'Checks (one line per failure in problems; ok only with none):',
      `1. New commits: git log --oneline ${review.reviewedSha}..HEAD is not empty; list them in newCommits (full sha, subject).`,
      '2. Working tree clean: git status --porcelain prints nothing (the artifact, if present and untracked, is allowed; name it).',
      `3. No .skip( / .only( / it.skip / describe.only / test.todo added in git diff ${review.reviewedSha}..HEAD.`,
      `4. No *.test.* or *.spec.* file deleted or emptied (git diff --diff-filter=D --name-only and --numstat ${review.reviewedSha}..HEAD).`,
      `5. Test count not lower: run pnpm test once; testCount = passing count (-1 on failure). Fixer evidence: ${fx.testSummary}.`,
      'head: git rev-parse HEAD (full sha). Read-only: change and commit nothing. Scratch: ' + scratch('progress'),
      HOUSE,
    ].join('\n'),
    { label: 'progress', phase: 'Fix', schema: PROGRESS, ...role('progressChecker') },
  )
  let problems = []
  if (pc) {
    state.fixCommits = pc.newCommits
    if (!pc.ok) problems = pc.problems.length ? pc.problems : ['progress checker reported not ok but listed no problem']
  } else {
    state.fixCommits = fx.commits
    problems = ['progress checker returned no result; fix pass unchecked']
  }
  // The fix head is read from git (#222), never taken from the progress checker or the fixer.
  const vf = await verifyHead(pc ? pc.head : fx.head, 'verify-head-fix', 'HEAD')
  if (vf.problem) {
    log(`fix: ${vf.problem}; stopping`)
    return done({ verdict: 'fixes', reviewedSha: review.reviewedSha, artifactWritten: false, stopped: 'precondition', stopPoint: 'precondition:verifyHead', problem: vf.problem, findings: review.findings, residual: toFix, fixCommits: state.fixCommits, strayArtifact: stray ? ARTIFACT : undefined })
  }
  fixHead = vf.head
  problems.forEach((p, k) => progressFindings.push({ id: `progress-${k + 1}`, severity: 'important', file: '', line: '', summary: `progress check: ${p}`, fix: 'restore the invariant the progress check names', planMandated: false, contests: '' }))
  log(`fix: head ${String(fixHead).slice(0, 7)}, ${state.fixCommits.length} commit(s)${problems.length ? `; ${problems.length} progress problem(s) sent to the re-reviewer as findings` : ''}`)
} else {
  log('fix: every finding was ruled stands or verified; no fix pass, the re-review confirms and writes the artifact')
}

// ================= 4. One re-review =================
phase('Re-review')
const controllerFinal = new Set(inForce().filter((r) => r.source === 'controller' && r.decision !== 'fix').map((r) => r.item))
const underVerification = review.findings.map((f) => {
  const r = state.rulings.get(f.id)
  return Object.assign({}, f, { ruled: r ? `${r.decision}${r.source === 'controller' ? ' by the controller, final' : ''}` : '' })
}).concat(progressFindings)
const rr = await agent(
  [
    `You are the fresh re-reviewer for ${prLabel()}. The first review is ${REVIEW_FILE_REF}; its findings are below with any ruling, followed by progress-check findings. ${fixHead === review.reviewedSha ? 'There was no fix diff: confirm each ruled item and the head.' : `A single fix pass produced ${review.reviewedSha}..${fixHead}; the fix report is ${FIX_REPORT}.`}`,
    CONTEXT_PATH ? `Context excerpt: ${CONTEXT_PATH} (ledger rulings and the plan and spec lines that touch the changed files); read only what it cites unless a named risk needs more.` : '',
    '',
    'Findings (verdict every one, including progress-*):',
    underVerification.map((f) => `- [${f.id}] ${f.severity.toUpperCase()} ${f.file}${f.line ? ':' + f.line : ''}: ${f.summary}${f.ruled ? ` (ruled ${f.ruled})` : ''}`).join('\n'),
    rulingsText(),
    answersFor(5),
    '',
    fixHead === review.reviewedSha
      ? ''
      : `Build the fix diff: mkdir -p "${scratch('re-reviewer')}" && cd "${REPO}" && { git log --oneline ${review.reviewedSha}..${fixHead}; echo; git diff --stat ${review.reviewedSha}..${fixHead}; echo; git diff -U10 ${review.reviewedSha}..${fixHead}; } > "${scratch('re-reviewer')}/fix.diff"; read it once.`,
    READONLY,
    'Verdicts: ADDRESSED (the defect no longer exists; "attempted" is NOT ADDRESSED), NOT ADDRESSED, or STANDS (ruled stands or verified, and you accept the ruling). You may reject a ruler ruling: give NOT ADDRESSED with your reason. A controller ruling is final: verdict it STANDS. Otherwise a Critical finding is never STANDS, and you may not approve while any Critical is open. List every Important you accept as STANDS on a ruler ruling in acceptedStands with the id of the ruling that keeps it (the finding id the ruling names). file:line evidence each. List anything the fix broke as newFindings (contests "" unless it disputes a Ruling). Do not re-review code the fix did not touch.',
    'Tests: confirm the fix report shows RED/GREEN and lint, typecheck and test output; do not re-run the suite without a named doubt.',
    CROSS_CUTTING,
    `Write ${REREVIEW_FILE}: Finding Verdicts, Accepted stands, New Breakage, Cross-cutting checks, Verdict.`,
    `reviewedSha: git rev-parse ${fixHead} (full).`,
    artifactRule(role('reReviewer'), 'reviewed head (the fix head)'),
    HOUSE,
    'verdict: approve only when every critical finding is ADDRESSED (or final by controller ruling), every important one is ADDRESSED, final by controller ruling or listed in acceptedStands, every progress-* finding is ADDRESSED, and newFindings has no critical or important item.',
  ].filter(Boolean).join('\n'),
  { label: 're-reviewer', phase: 'Re-review', schema: REREVIEW, ...role('reReviewer') },
)

if (!rr) {
  log('re-review: re-reviewer returned null; returning the fixed-but-unreviewed state')
  return done({ verdict: 'fixes', reviewedSha: fixHead, artifactWritten: false, stopped: 're-review', findings: review.findings, residual: toFix.concat(progressFindings), fixCommits: state.fixCommits, strayArtifact: stray ? ARTIFACT : undefined })
}
const vmap = new Map(rr.verdicts.map((v) => [v.id.replace(/^\[|\]$/g, '').trim(), v]))
const accepted = new Map(rr.acceptedStands.map((a) => [a.id.replace(/^\[|\]$/g, '').trim(), a.rulingId]))
const standsRuled = new Set(inForce().filter((r) => r.decision === 'stands' || r.decision === 'verified').map((r) => r.item))
const residual = []
for (const f of underVerification) {
  if (controllerFinal.has(f.id)) continue
  const v = vmap.get(f.id)
  if (v && v.verdict === 'ADDRESSED') continue
  if (v && v.verdict === 'STANDS') {
    if (f.severity === 'minor') continue
    const rid = accepted.get(f.id)
    if (f.severity === 'important' && rid && standsRuled.has(rid.replace(/^ruling\s+/i, '').trim())) continue
    residual.push(Object.assign({}, f, { reReview: f.severity === 'critical' ? 'STANDS on a critical is not accepted' : 'STANDS without an acceptedStands entry naming a stands ruling' }))
    continue
  }
  residual.push(Object.assign({}, f, { reReview: v ? `${v.verdict}: ${v.evidence}` : 'no verdict' }))
}
for (const f of rr.newFindings) residual.push(Object.assign({}, f, { id: `rr:${f.id}`, reReview: 'new in fix diff' }))
const residualBlocking = residual.filter(blocking)
let verdict = rr.verdict
if (verdict === 'approve' && residualBlocking.length) {
  log(`re-review: verdict approve but ${residualBlocking.length} critical/important residual; reporting fixes`)
  verdict = 'fixes'
}
if (rr.artifactWritten) stray = verdict !== 'approve'
if (stray) log('re-review: an artifact was written without a final approve; returned as strayArtifact for the controller to delete')
log(`re-review: ${verdict}, ${residual.length} residual (${residualBlocking.length} critical/important), artifact ${rr.artifactWritten && verdict === 'approve' ? 'written' : 'not written'}; no second fix pass`)

// reviewedSha is the verified fix head, not the re-reviewer's claim (a different claim is logged).
let rrArtifact = rr.artifactWritten && verdict === 'approve'
{
  const c = String(rr.reviewedSha || '').trim().toLowerCase()
  if (c && !(c.length >= 7 && fixHead.startsWith(c))) {
    log(`agent-reported head ${c.slice(0, 16)}... differs from git; using git`)
    // K2: the artifact the re-reviewer wrote records its claimed sha, not git's
    if (rrArtifact) {
      log('re-review: the re-reviewer reported a reviewedSha that differs from git, so the artifact it wrote records the wrong sha; returned as strayArtifact')
      rrArtifact = false
      stray = true
    }
  }
}
return done({
  verdict,
  reviewedSha: fixHead,
  artifactWritten: rrArtifact,
  findings: review.findings,
  residual,
  fixCommits: state.fixCommits,
  strayArtifact: stray ? ARTIFACT : undefined,
})
