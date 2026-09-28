/*
 * sdd-task: run one implementation-plan task through implement, review, rule, fix and an
 * independent gate (ADR-0006). Full reference: .claude/workflows/README.md.
 * Test the control flow after any edit: node scripts/sdd/workflow-harness.mjs
 *
 * Invoke: Workflow({ name: "sdd-task", args: {
 *   task: 7, title: "SiteConfig schema v1: fields, conditions, query types", issue: 8,
 *   repoDir: "C:\\git\\queryModule", branch: "feat/p0-wave-2", base: "<full sha, HEAD before the task>",
 *   briefPath, reportPath, workDir,          // workDir: SDD workspace for review files
 *   scratchRoot, runLabel: "w2-t7",          // agent scratch: <scratchRoot>/<runLabel>/<agent>/
 *   ledgerPath,                              // optional; only named in the log: the controller
 *                                            // appends ledgerLines (scripts/sdd/append-ledger.mjs)
 *   tier: "ordinary",                        // optional: "ordinary" (default) | "gate" | "critical" (ADR-0007)
 *   sensitive: false, ui: false,             // sensitive: true is an alias for tier "critical"; the two must agree
 *   critic: false, criticFocus: "...",       // optional: critic on for an ordinary task; focus text
 *   ids: "BR-001, FR-032", specRefs: "spec 4.1 lines 140-260; ...",
 *   requirementsDoc,                         // optional; default the repo-root Requirements Definition
 *   globalConstraints: "<product and code constraints>",   // required, non-empty; see below
 *   carries: "<rulings, interfaces>",        // never edit between re-runs of one task
 *   trailer: "Co-Authored-By: ...",          // fallback commit trailer
 *   roles: { implementer: { model: "opus", effort: "medium" }, ... },   // optional overrides
 *   maxAgents: 18,                           // agent budget (every agent() call); default by tier: ordinary 18,
 *                                            // gate 20, critical 24; coerced like maxRounds;
 *                                            // past it the run stops at "budget"
 *   maxRounds: 2,                            // fix-round cap, default 2 (developer rule 09-27-26: a task
 *                                            // open after round 2 parks for a controller ruling);
 *                                            // numeric strings and floats are coerced (logged), then
 *                                            // clamped to 1..8
 *   answers: [{ at, text?, decisions?, noCode? }],    // only on a re-run after a stop (below)
 *   implemented: { head: "<full sha>" }      // optional: review stages only; skips the implementer
 *                                            // and reviews base..head (README "Fallbacks")
 * } })
 * Required: task, title, repoDir, branch, base, briefPath, reportPath, workDir, scratchRoot,
 * runLabel, specRefs, globalConstraints, trailer. A missing one throws before any agent runs.
 * globalConstraints carries product and code constraints only (runtime, TDD, purity, fixtures,
 * logging, docs style). Never process bullets (model and effort plan, PR and push steps, commit
 * trailers, branch naming): every agent treats globalConstraints as binding.
 * Tiers: ordinary and gate run one combined reviewer (role reviewer: spec and quality, findings keep
 * kind spec | quality); critical keeps specReviewer and qualityReviewer. The critic runs on gate,
 * critical, ui or critic: true; the sensitive ruler rule on gate and critical. Reviewers, critic and
 * re-reviewers are diff-scoped.
 * Roles: implementer, reviewer, specReviewer, qualityReviewer, critic, checker, ruler, fixer, escalatedFixer,
 * progressChecker, reReviewer, gate. There is no ledger role (roles.ledger is logged and ignored).
 * gate-0 runs in parallel with the reviewers; cannot-verify items go to the checker; a fix round
 * with only gate or progress findings skips the re-reviewer.
 * Effort caps (developer decision 09-26-26, #92): no role default is xhigh or max anywhere, and
 * the step-up ladder's opus/high stays opus/high (no step to xhigh). A roles override may still
 * set xhigh or max; the script logs one warning line per role overridden that way.
 *
 * Returns { task, status, base, head, commits, rounds, rulings (in force, one per item, each
 * with source "ruler" | "checker" | "controller"), supersededRulings, carryForward, deferredMinors, parked,
 * questions, concerns, agents (agent calls in this run), answersUnconsumed?, ledgerLines } and, when status is "stopped", also
 * stopped (a stop point, with the agent that consumes answers there):
 *   "implementer"     -> implementer-continue finishes on top of the existing commits
 *   "precondition"    -> (problem says what: branch, HEAD, dirty tree with the files named; stopPoint
 *                        is precondition:<label>: implementer, gate-0, checker, ruler-review,
 *                        gate-r<r> or verifyHead) fix the repo; the failing agent re-runs once as <label>-retry
 *   "ruler-concerns"  -> ruler-concerns        "fixer-pre" -> fixer-pre
 *   "review"          -> ruler-review, then the fixers (a reviewer returned nothing)
 *   "ruler-review"    -> ruler-review          "fixer-r<r>" -> fixer-r<r>
 *   "gate-0" | "gate-r<r>" -> fixer-r1 | fixer-r<r+1> (the gate returned nothing)
 *   "budget"          -> no agent: each answer raises maxAgents by the tier default; the run resumes from cache where it stopped
 * plus escalated: [ruling] when a ruler escalated, and problem on a precondition or budget stop.
 *   status "complete": review clean and the gate passed. Tick the plan checkboxes, move
 *     carryForward into the next task's carries, read rulings.
 *   status "parked": the fix cap was reached or an item got no ruling. Adjudicate parked.
 *   status "stopped": a controller decision is needed (questions, escalated, problem).
 *
 * Controller before: wave branch checked out in repoDir, clean tree, base = git rev-parse HEAD,
 * brief written with `bash scripts/sdd/task-brief.sh PLAN N <briefPath>`.
 * Answering a stop (never re-implements): re-run with resumeFromRunId, the SAME args (carries
 * unchanged) plus answers: a list with one entry per answered stop, appended across re-runs and
 * never replaced: [{ at: <the returned stopped value, or stopPoint for a precondition>, text: "...",
 * decisions: [{ item, decision: "fix" | "stands" | "verified", reason, fixInstruction? }] }].
 * noCode: true (only on a fixer-r<r> entry with text) says the text closes every finding open in
 * round r with no code change: progress-r<r> then waives its new-commits check, and only that one.
 * A single object is a one-entry list. Every entry's at is validated; an unknown one throws.
 * Each entry's text goes to exactly one agent (the first consumer at or after its stop point that
 * runs), so earlier calls, including an earlier stop's continue or retry agent, replay from cache.
 * decisions from all entries become controller rulings (a later entry wins for the same item):
 * final for the run, never re-escalated (a controller stands on a Critical stands); fix goes to
 * the fixer with its fixInstruction. Null or failed replays: .claude/workflows/README.md fallbacks.
 *   Workflow({ scriptPath: ".claude/workflows/sdd-task.js", resumeFromRunId: "<runId>",
 *              args: <same args + answers> })
 * Resume after a pause, kill or script edit: the same call without new answers. Always pass
 * args: a resume without them throws at the first required-arg check.
 * Head shas (#222): every head the script uses (expectedHead, reviewHead, gate heads, the carried
 * base, the returned head) comes from verifyHead, a Haiku role that runs git rev-parse HEAD and
 * git cat-file -e <sha>^{commit} in repoDir. An implementer, fixer, progress checker or gate never
 * supplies one; a head they report is only compared, and a difference is logged.
 * This script never pushes or merges; every shell-running agent is told the same.
 */
export const meta = {
  name: 'sdd-task',
  description: 'Implement one plan task with TDD, review it (spec and quality, critic by tier), rule, fix and gate it to a clean head',
  whenToUse: 'Running one task of an implementation plan on a wave branch in place of hand-dispatched subagent-driven development',
  phases: [
    { title: 'Implement', detail: 'implementer builds the task from its brief with TDD and commits' },
    { title: 'Rule', detail: 'ruler decides implementer concerns, plan-mandated or contested findings and cannot-verify items the checker could not settle' },
    { title: 'Review', detail: 'combined reviewer (ordinary, gate) or spec and quality reviewers (critical), critic (gate, critical, UI or critic: true) and gate-0 in parallel' },
    { title: 'Check', detail: 'checker runs the suggested check for each cannot-verify item' },
    { title: 'Fix', detail: 'fixer, progress checker and re-reviewer per round, up to maxRounds' },
    { title: 'Gate', detail: 'independent lint, typecheck, coverage, head and clean-tree check' },
    { title: 'Verify', detail: 'verifyHead reads the head sha from git after each stage that commits (#222)' },
  ],
}

// ---------- arguments ----------
const A = args || {}
for (const k of ['task', 'title', 'repoDir', 'branch', 'base', 'briefPath', 'reportPath', 'workDir', 'scratchRoot', 'runLabel', 'specRefs', 'globalConstraints', 'trailer']) {
  const v = A[k]
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    throw new Error(`sdd-task: required arg "${k}" is missing or empty (see .claude/workflows/README.md)`)
  }
}
const N = A.task
// Review tier (ADR-0007, issue #78): ordinary | gate | critical. sensitive: true is an alias for
// critical; sensitive and tier together must agree.
const TIERS = ['ordinary', 'gate', 'critical']
const hasTier = A.tier !== undefined && A.tier !== null
if (hasTier && !TIERS.includes(A.tier)) throw new Error(`sdd-task: tier must be one of ${TIERS.join(', ')}, got ${JSON.stringify(A.tier)}`)
const hasSensitive = A.sensitive !== undefined && A.sensitive !== null
if (hasTier && hasSensitive && !!A.sensitive !== (A.tier === 'critical')) {
  throw new Error(`sdd-task: sensitive ${JSON.stringify(A.sensitive)} and tier "${A.tier}" disagree (sensitive: true means tier "critical"); set one of them`)
}
const TIER = hasTier ? A.tier : A.sensitive ? 'critical' : 'ordinary'
if (!hasTier && A.sensitive) log('tier: sensitive: true is an alias for tier "critical"')
// SENSITIVE: the critical tier (split reviewers, Opus implementer). GUARDED: gate or critical
// (critic on, the sensitive ruler rule and the script's rule (c)).
const SENSITIVE = TIER === 'critical'
const GUARDED = TIER !== 'ordinary'
const UI = !!A.ui
// critic: true turns the critic on without a gate or critical tier or ui; no tier or ruler rule changes with it.
if (A.critic !== undefined && A.critic !== null && typeof A.critic !== 'boolean') {
  throw new Error(`sdd-task: critic must be a boolean (true or false), got ${JSON.stringify(A.critic)}`)
}
if (A.criticFocus !== undefined && A.criticFocus !== null && (typeof A.criticFocus !== 'string' || A.criticFocus.trim() === '')) {
  throw new Error('sdd-task: criticFocus must be a non-empty string when given')
}
const CRITIC_FOCUS = A.criticFocus ? A.criticFocus.trim() : ''
const CRITIC = GUARDED || UI || A.critic === true
if (CRITIC_FOCUS && !CRITIC) log('review: criticFocus ignored (critic off: set critic: true, a gate or critical tier, or ui to run it)')
const DEFAULT_CRITIC_FOCUS = 'correctness and security risk: fail-open paths, data that crosses a trust boundary (server to client, config to audit), contract drift from the spec, tests that cannot fail'
const REQ_DOC = A.requirementsDoc || 'Requirements Definition - Query Module Usability Enhancements.md'

// Developer rule 09-27-26: a task still open after fix round 2 parks for a controller ruling.
const DEFAULT_MAX_ROUNDS = 2
let MAX_ROUNDS = DEFAULT_MAX_ROUNDS
if (A.maxRounds !== undefined && A.maxRounds !== null) {
  const raw = A.maxRounds
  const n = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : Number.NaN
  if (!Number.isFinite(n)) {
    log(`cap: maxRounds ${JSON.stringify(raw)} is not a number; using ${DEFAULT_MAX_ROUNDS}`)
  } else if (typeof raw !== 'number' || !Number.isInteger(n)) {
    MAX_ROUNDS = Math.trunc(n)
    log(`cap: maxRounds ${JSON.stringify(raw)} coerced to ${MAX_ROUNDS}`)
  } else {
    MAX_ROUNDS = n
  }
}
if (MAX_ROUNDS < 1 || MAX_ROUNDS > 8) {
  const clamped = Math.min(8, Math.max(1, MAX_ROUNDS))
  log(`cap: maxRounds ${MAX_ROUNDS} clamped to ${clamped}`)
  MAX_ROUNDS = clamped
}

// Agent budget: every agent() call in the run counts, cached replays included. The call that would
// exceed MAX_AGENTS is not made; the run stops at "budget". Each answer at "budget" raises the cap
// by DEFAULT_MAX_AGENTS once (below, with the answers). The default follows the tier. verifyHead
// (#222) adds up to 4 calls to the worst case at maxRounds 2 (after the implementer, the pre-review
// fixer and each of two fix rounds), so the defaults are the pre-#222 14, 16, 20 plus 4.
const DEFAULT_MAX_AGENTS = { ordinary: 18, gate: 20, critical: 24 }[TIER]
let MAX_AGENTS = DEFAULT_MAX_AGENTS
if (A.maxAgents !== undefined && A.maxAgents !== null) {
  const raw = A.maxAgents
  const n = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : Number.NaN
  if (!Number.isFinite(n)) {
    log(`budget: maxAgents ${JSON.stringify(raw)} is not a number; using ${DEFAULT_MAX_AGENTS}`)
  } else if (typeof raw !== 'number' || !Number.isInteger(n)) {
    MAX_AGENTS = Math.trunc(n)
    log(`budget: maxAgents ${JSON.stringify(raw)} coerced to ${MAX_AGENTS}`)
  } else {
    MAX_AGENTS = n
  }
}
if (MAX_AGENTS < 1) {
  log(`budget: maxAgents ${MAX_AGENTS} clamped to 1`)
  MAX_AGENTS = 1
}

// Answers to stopped runs: a history, one entry per answered stop, appended across re-runs and
// never replaced. Every stopped value is a stop point with a named consumer:
//   implementer   -> implementer-continue          precondition[:<label>] -> <label>-retry, once
//   ruler-concerns -> ruler-concerns               fixer-pre    -> fixer-pre
//   review        -> ruler-review (else a fixer)   ruler-review -> ruler-review
//   fixer-r<r>    -> fixer-r<r>                    gate-0 / gate-r<r> -> fixer-r1 / fixer-r<r+1>
//   budget        -> no agent: the cap rises by DEFAULT_MAX_AGENTS and the run goes on where it stopped
// Each entry's text is delivered to exactly one agent: the first consumer at or after its stop
// point that runs. So an agent's prompt holds only the entries for its own stop point, and a
// later entry never changes an earlier agent's prompt (earlier calls replay from cache).
// Decisions from all entries become controller rulings; a later entry wins for the same item.
const STOP_POINTS = 'implementer, precondition (or precondition:<label> from stopPoint: implementer, gate-0, checker, ruler-review, gate-r<r>, verifyHead), ruler-concerns, fixer-pre, review, ruler-review, fixer-r<r>, gate-0, gate-r<r>, budget'
function stopPos(at) {
  const fixed = { implementer: 0, 'ruler-concerns': 1, 'fixer-pre': 2, review: 3, 'ruler-review': 4 }
  if (at in fixed) return fixed[at]
  let m = /^fixer-r([1-9]\d*)$/.exec(at)
  if (m) return 10 + 2 * Number(m[1])
  if (at === 'gate-0') return 11
  m = /^gate-r([1-9]\d*)$/.exec(at)
  if (m) return 11 + 2 * Number(m[1])
  return -1
}
const PRECONDITION_AT = /^precondition(?::(implementer|gate-0|checker|ruler-review|verifyHead|gate-r[1-9]\d*))?$/
let ANSWERS = null
const CONTROLLER = new Map()
// Items decided in entries at or before the review stop (implementer .. review, and the
// implementer and gate-0 precondition stops). Only these keep an item away from the checker;
// later decisions apply after the checker and override its result, so the checker prompt stays
// cache-stable when a ruler-review stop is answered.
const EARLY_DECIDED = new Set()
if (A.answers !== undefined && A.answers !== null) {
  const list = Array.isArray(A.answers) ? A.answers : [A.answers] // a single object is a one-entry list
  if (!list.length) throw new Error('sdd-task: answers is an empty list')
  const entries = list.map((e, i) => {
    const at = String((e && e.at) || '')
    const pre = PRECONDITION_AT.exec(at)
    const isBudget = at === 'budget'
    if (!isBudget && !pre && stopPos(at) < 0) {
      throw new Error(`sdd-task: answers[${i}].at "${at}" is not a stop point; use the returned stopped value: ${STOP_POINTS}`)
    }
    const text = typeof e.text === 'string' ? e.text.trim() : ''
    const decisions = Array.isArray(e.decisions) ? e.decisions : []
    if (!text && !decisions.length) throw new Error(`sdd-task: answers[${i}] needs text or decisions (or both)`)
    const noCode = e.noCode === true
    if (e.noCode !== undefined && e.noCode !== false && (!noCode || !/^fixer-r[1-9]\d*$/.test(at) || !text)) {
      throw new Error(`sdd-task: answers[${i}].noCode must be true on a fixer-r<r> entry with text (the controller's no-code ruling)`)
    }
    if (at === 'precondition' && decisions.length) throw new Error(`sdd-task: answers[${i}] carries decisions at a plain precondition stop; use the returned stopPoint (for example precondition:checker) as at`)
    for (const d of decisions) {
      if (!d || typeof d.item !== 'string' || !['fix', 'stands', 'verified'].includes(d.decision) || typeof d.reason !== 'string') {
        throw new Error(`sdd-task: answers[${i}].decisions entry ${JSON.stringify(d)} needs item, decision (fix | stands | verified) and reason`)
      }
      CONTROLLER.set(d.item, { decision: d.decision, reason: d.reason, fixInstruction: d.fixInstruction || '' }) // later entry wins
      // budget decisions apply like later-stop decisions (after the checker)
      if (!isBudget && (pre ? ['', 'implementer', 'gate-0'].includes(pre[1] || '') : stopPos(at) <= 3)) EARLY_DECIDED.add(d.item)
    }
    if (isBudget) {
      // No consumer: the text is logged, never put in a prompt, so every call replays from cache.
      MAX_AGENTS += DEFAULT_MAX_AGENTS
      if (text) log(`budget: answers[${i}]: ${text}`)
      return { index: i, at, pos: -1, preLabel: null, text, delivered: true }
    }
    return { index: i, at, pos: pre ? -1 : stopPos(at), preLabel: pre ? pre[1] || '' : null, text, delivered: !text, noCode }
  })
  const raised = entries.filter((e) => e.at === 'budget').length
  if (raised) log(`budget: maxAgents ${MAX_AGENTS - raised * DEFAULT_MAX_AGENTS} raised to ${MAX_AGENTS} (${raised} answer(s) at budget, +${DEFAULT_MAX_AGENTS} each)`)
  ANSWERS = { entries, decisionsUsed: new Set() }
  log(`answers: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (${entries.map((e) => e.at).join(', ')}), ${CONTROLLER.size} controller decision(s); earlier agent calls replay from cache`)
}
const answerBlock = (es, what) => `Controller answers to ${what} (binding):\n${es.map((e) => `* (stop point ${e.at}) ${e.text}`).join('\n')}`
// consumerPos: the position of the agent asking (see stopPos). Delivers every undelivered text
// entry whose stop point is at or before it, and returns the text block or ''.
function answersFor(consumerPos) {
  if (!ANSWERS) return ''
  const es = ANSWERS.entries.filter((e) => !e.delivered && e.pos >= 0 && e.pos <= consumerPos)
  if (!es.length) return ''
  for (const e of es) e.delivered = true
  return answerBlock(es, 'the questions of the stopped run')
}
// For an agent that failed its precondition: the entries for precondition:<label>, else the first
// undelivered plain "precondition" entry. Returns the text block, or '' when there is none.
function preconditionAnswers(label) {
  if (!ANSWERS) return ''
  let es = ANSWERS.entries.filter((e) => e.preLabel === label && !e.usedPre)
  if (!es.length) es = ANSWERS.entries.filter((e) => e.preLabel === '' && !e.usedPre).slice(0, 1)
  if (!es.length) return ''
  for (const e of es) { e.usedPre = true; e.delivered = true }
  const withText = es.filter((e) => e.text)
  return withText.length ? answerBlock(withText, 'the precondition failure') : 'The controller reports the precondition failure resolved; check again.'
}

// Review stages only: the task's commits are already on the branch (base..implemented.head), for
// example a fresh run after the implementer committed. The implementer is skipped.
let IMPLEMENTED = null
if (A.implemented !== undefined && A.implemented !== null) {
  const head = A.implemented && typeof A.implemented.head === 'string' ? A.implemented.head.trim() : ''
  if (!head) throw new Error('sdd-task: implemented.head is missing or empty (the full sha of the task head, git rev-parse HEAD)')
  if (ANSWERS && ANSWERS.entries.some((e) => e.at === 'implementer' || e.preLabel === 'implementer')) {
    throw new Error('sdd-task: implemented skips the implementer, so answers for "implementer" or "precondition:implementer" cannot apply; drop them or drop implemented')
  }
  IMPLEMENTED = { head }
}

// ---------- roles ----------
const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
// Per tier (README "Roles and defaults"). ordinary and gate run one combined reviewer (reviewer);
// critical keeps the split specReviewer and qualityReviewer. A roles override still wins per role.
const COMMON_ROLES = {
  implementer: { model: 'sonnet', effort: 'medium' },
  reviewer: { model: 'sonnet', effort: 'high' },
  specReviewer: { model: 'sonnet', effort: 'medium' },
  qualityReviewer: { model: 'sonnet', effort: 'high' },
  critic: { model: 'opus', effort: 'medium' },
  ruler: { model: 'opus', effort: 'low' },
  checker: { model: 'sonnet', effort: 'low' },
  progressChecker: { model: 'sonnet', effort: 'low' },
  reReviewer: { model: 'sonnet', effort: 'medium' },
  gate: { model: 'sonnet', effort: 'low' },
  // Reads shas from git for the script (model only: the API rejects effort on Haiku).
  verifyHead: { model: 'haiku' },
}
const TIER_ROLES = {
  ordinary: {},
  gate: { reReviewer: { model: 'sonnet', effort: 'high' } },
  critical: {
    implementer: { model: 'opus', effort: 'medium' },
    ruler: { model: 'opus', effort: 'medium' },
    reReviewer: { model: 'opus', effort: 'medium' },
  },
}
const DEFAULTS = Object.assign({}, COMMON_ROLES, TIER_ROLES[TIER])
// escalatedFixer base: ordinary steps up from the fixer; gate and critical are fixed.
const ESCALATED_FIXER = { gate: { model: 'opus', effort: 'medium' }, critical: { model: 'opus', effort: 'high' } }
const OVR = Object.assign({}, A.roles || {})
// The ledger agent was removed (post-pilot): the controller appends ledgerLines with
// scripts/sdd/append-ledger.mjs. An old roles.ledger override is ignored, not an error.
if (OVR.ledger !== undefined) {
  log('roles: roles.ledger ignored (no ledger agent; the controller appends ledgerLines)')
  delete OVR.ledger
}

function stepUp(r) {
  const key = `${r.model}/${r.effort || ''}`
  // No role default steps to xhigh or max anywhere (developer decision 09-26-26, #92):
  // opus/high stays opus/high; every other rung is unchanged.
  const LADDER = {
    'haiku/': { model: 'sonnet', effort: 'medium' },
    'sonnet/low': { model: 'sonnet', effort: 'medium' },
    'sonnet/medium': { model: 'sonnet', effort: 'high' },
    'sonnet/high': { model: 'opus', effort: 'medium' },
    'sonnet/xhigh': { model: 'opus', effort: 'medium' },
    'opus/low': { model: 'opus', effort: 'medium' },
    'opus/medium': { model: 'opus', effort: 'high' },
    'opus/high': { model: 'opus', effort: 'high' },
  }
  return LADDER[key] || { model: r.model, effort: r.effort }
}

function resolve(name) {
  if (name === 'fixer') return Object.assign({}, resolve('implementer'), OVR.fixer || {})
  if (name === 'escalatedFixer') {
    const base = ESCALATED_FIXER[TIER] || stepUp(resolve('fixer'))
    return Object.assign({}, base, OVR.escalatedFixer || {})
  }
  if (!DEFAULTS[name]) throw new Error(`sdd-task: unknown role "${name}"`)
  return Object.assign({}, DEFAULTS[name], OVR[name] || {})
}

// No sdd-task default role uses xhigh or max effort (developer decision 09-26-26, #92); a roles
// override may still ask for one, but it is logged once per role so the choice reads as deliberate.
const HOT_EFFORTS = ['xhigh', 'max']
const warnedHotRoles = new Set()
function warnHotOverride(name, effort) {
  if (HOT_EFFORTS.includes(effort) && !warnedHotRoles.has(name)) {
    warnedHotRoles.add(name)
    log(`roles: "${name}" overridden to effort "${effort}" (xhigh or max; no default role uses it)`)
  }
}

// Returns { model, effort } for agent(); effort omitted for Haiku; throws on a missing model.
function role(name) {
  const r = resolve(name)
  if (!r.model) throw new Error(`sdd-task: role "${name}" has no model`)
  if (!MODELS.includes(r.model)) throw new Error(`sdd-task: role "${name}" model "${r.model}" is not one of ${MODELS.join(', ')}`)
  if (r.model === 'haiku') return { model: 'haiku' }
  if (!r.effort) throw new Error(`sdd-task: role "${name}" (${r.model}) has no effort`)
  if (!EFFORTS.includes(r.effort)) throw new Error(`sdd-task: role "${name}" effort "${r.effort}" is invalid`)
  warnHotOverride(name, r.effort)
  return { model: r.model, effort: r.effort }
}
const tier = (name) => { const r = role(name); return r.effort ? `${r.model}/${r.effort}` : r.model }

// ---------- agent budget ----------
// Every agent call goes through call(); a parallel block reserves its calls first, so the budget
// never stops half a block. Past the cap, BudgetStop is thrown and the run returns stopped "budget".
let agentsUsed = 0
function budgetStop(n, label, stage) {
  const e = new Error(`budget: agent ${agentsUsed + n} would exceed maxAgents ${MAX_AGENTS} at ${label} (${stage})`)
  e.budgetStop = { label, stage, count: agentsUsed }
  return e
}
function reserve(n, label, stage) {
  if (agentsUsed + n > MAX_AGENTS) throw budgetStop(n, label, stage)
}
async function call(prompt, opts) {
  reserve(1, opts.label, opts.phase)
  agentsUsed++
  return agent(prompt, opts)
}

// ---------- paths ----------
// Forward slashes throughout: Git Bash and the Windows file tools both accept C:/x/y.
const fwd = (p) => String(p).replace(/\\/g, '/')
const join = (...p) => p.map((s, i) => (i === 0 ? fwd(s).replace(/\/+$/, '') : fwd(s).replace(/^\/+|\/+$/g, ''))).join('/')
const REPO = fwd(A.repoDir)
const scratch = (label) => join(A.scratchRoot, A.runLabel, label)
const wjoin = (f) => join(A.workDir, f)

// ---------- schemas ----------
const STATUS = { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] }
const COMMITS = { type: 'array', items: { type: 'object', properties: { sha: { type: 'string' }, subject: { type: 'string' } }, required: ['sha', 'subject'] } }
const WORK = {
  type: 'object',
  properties: {
    status: STATUS,
    commits: COMMITS,
    head: { type: 'string', description: 'full sha of HEAD after your commits (git rev-parse HEAD)' },
    testSummary: { type: 'string', description: 'one line, e.g. "142/142 passing, output pristine"' },
    concerns: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['planVsSpec', 'correctness', 'observation'] }, text: { type: 'string' } },
        required: ['kind', 'text'],
      },
    },
    questions: { type: 'array', items: { type: 'string' } },
    preconditionFailed: { type: 'string', description: 'set (with what you found) only when the stated precondition does not hold; then change nothing' },
  },
  required: ['status', 'commits', 'head', 'testSummary', 'concerns', 'questions'],
}
const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'important', 'minor'] },
    file: { type: 'string' },
    line: { type: 'string', description: 'line or range, e.g. "42" or "40-58"; "" if not line-bound' },
    summary: { type: 'string' },
    fix: { type: 'string' },
    planMandated: { type: 'boolean' },
    contestsRuling: { type: 'string', description: 'id of the ruling in force this finding contradicts; "" if none' },
  },
  required: ['id', 'severity', 'file', 'line', 'summary', 'fix', 'planMandated', 'contestsRuling'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    findings: { type: 'array', items: FINDING },
    cannotVerify: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, check: { type: 'string' } }, required: ['item', 'check'] } },
  },
  required: ['verdict', 'findings', 'cannotVerify'],
}
// The combined reviewer (ordinary and gate tiers) tags each finding and cannot-verify item with its
// kind; ids become spec:<id> or quality:<id>, as with the split reviewers.
const KIND = { type: 'string', enum: ['spec', 'quality'], description: 'spec: spec compliance; quality: code quality' }
const REVIEW_COMBINED = {
  type: 'object',
  properties: {
    verdict: REVIEW.properties.verdict,
    findings: { type: 'array', items: { type: 'object', properties: Object.assign({}, FINDING.properties, { kind: KIND }), required: FINDING.required.concat(['kind']) } },
    cannotVerify: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, check: { type: 'string' }, kind: KIND }, required: ['item', 'check', 'kind'] } },
  },
  required: REVIEW.required,
}
// Agents that run after gate-0 (checker, ruler-review) report the repository state they leave.
const POST_GATE_PROPS = {
  head: { type: 'string', description: 'full sha from git rev-parse HEAD, run just before you reply' },
  treeClean: { type: 'boolean', description: 'true only when git status --porcelain prints nothing' },
  dirtyFiles: { type: 'array', items: { type: 'string' }, description: 'each path git status --porcelain prints; [] when clean' },
}
const CHECK = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the item id exactly as given' },
          result: { type: 'string', enum: ['verified', 'failed', 'needsJudgment'] },
          evidence: { type: 'string', description: 'the command you ran and the lines of its output that decide the result' },
        },
        required: ['id', 'result', 'evidence'],
      },
    },
    ...POST_GATE_PROPS,
  },
  required: ['results', 'head', 'treeClean', 'dirtyFiles'],
}
const RULINGS = {
  type: 'object',
  properties: {
    rulings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'the item id exactly as given' },
          decision: { type: 'string', enum: ['fix', 'stands', 'verified', 'escalate'] },
          reason: { type: 'string' },
          costIfWrong: { type: 'string' },
          fixInstruction: { type: 'string', description: 'required when decision is fix: the smallest change' },
          command: { type: 'string', description: 'required when decision is verified: the command you ran and its result' },
          carryForward: { type: 'array', items: { type: 'string' }, description: 'obligations a later task must meet because of this ruling' },
        },
        required: ['item', 'decision', 'reason', 'costIfWrong'],
      },
    },
  },
  required: ['rulings'],
}
const RULINGS_POST = {
  type: 'object',
  properties: Object.assign({}, RULINGS.properties, POST_GATE_PROPS),
  required: RULINGS.required.concat(['head', 'treeClean', 'dirtyFiles']),
}
const PROGRESS = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    head: { type: 'string', description: 'full sha from git rev-parse HEAD' },
    newCommits: COMMITS,
    testCount: { type: 'integer', description: 'passing tests in the full run; -1 if the run failed' },
    guardHits: { type: 'array', items: { type: 'string' }, description: 'check 6: each gate-weakening change, "file:line: what"; [] when none' },
  },
  required: ['ok', 'problems', 'head', 'newCommits', 'testCount', 'guardHits'],
}
const REREVIEW = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['ADDRESSED', 'NOT ADDRESSED'] }, evidence: { type: 'string', description: 'file:line' } },
        required: ['id', 'verdict', 'evidence'],
      },
    },
    newFindings: { type: 'array', items: FINDING },
    outOfScope: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdicts', 'newFindings', 'outOfScope'],
}
const GATE = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    head: { type: 'string', description: 'full sha from git rev-parse HEAD' },
    problems: { type: 'array', items: { type: 'string' } },
    preconditionFailed: { type: 'string', description: 'set only when the branch or HEAD check fails' },
  },
  required: ['ok', 'head', 'problems'],
}

const VERIFY_HEAD = {
  type: 'object',
  properties: {
    revParse: { type: 'string', description: 'the raw stdout of git rev-parse HEAD, copied exactly' },
    catFile: { type: 'string', description: 'the raw stdout of the cat-file check: EXISTS <sha> or MISSING' },
  },
  required: ['revParse', 'catFile'],
}

// ---------- shared prompt pieces ----------
const GIT = `Shell: Git Bash. Run every git and shell command in ${REPO} (cd there, or use git -C "${REPO}"). Branch: ${A.branch}.`
// Every agent in this script can run shell commands, so every prompt carries NO_REMOTE through
// HOUSE (W2 incident: an implementer pushed and opened a PR after reading project memory).
const NO_REMOTE = 'Never run git push, gh pr (any subcommand), gh api writes, or git merge into another branch; the controller and the developer own the remote.'
const HOUSE = [
  'Rules:',
  '- Never dispatch subagents. Do all of this work yourself.',
  '- Finish every command before you reply; leave nothing running in the background.',
  '- No filesystem-wide searches: read the files named here and the files they lead you to.',
  `- ${NO_REMOTE}`,
].join('\n')
const READONLY = 'Your review is read-only on this checkout: do not change the working tree, the index, HEAD or any branch. Write only your review file and your scratch directory.'
const TRAILER = `End every commit message with the attribution trailer your session's system reminder gives; if it gives none, use:\n${A.trailer}`
// Implementer and fixers carry SELF_CHECK.
const SELF_CHECK = 'Before each commit run pnpm lint (fix formatting with pnpm exec biome format --write <files> or pnpm exec biome check --write <files> on the changed files only), then pnpm typecheck (tsc -b; vitest does not typecheck test files), then pnpm coverage (the full suite with coverage thresholds). Do not commit on red. Report the commands and their results.'
// The repository-state check for agents that run after gate-0 (checker, ruler-review).
const postGateCheck = (expected) => `Before you reply, run git rev-parse HEAD and git status --porcelain in ${REPO}. git rev-parse HEAD must equal ${expected}. Report head (full sha), treeClean (true only when git status --porcelain prints nothing) and dirtyFiles (each path it prints). You must leave both exactly as you found them.`
// Returns '' when res left the repository as gate-0 saw it, else what changed.
function postGateProblem(res, expected) {
  if (!res) return ''
  const h = String(res.head || ''), e = String(expected)
  const moved = h.length < Math.min(7, e.length) || !(h.startsWith(e) || e.startsWith(h))
  const dirty = res.treeClean !== true
  if (!moved && !dirty) return ''
  const parts = []
  if (moved) parts.push(`HEAD is ${h || '(not reported)'}, expected ${e} (the head gate-0 checked)`)
  if (dirty) parts.push(`tree dirty: ${(res.dirtyFiles || []).join(', ') || '(files not reported)'}`)
  return parts.join('; ')
}
// Moves that make a gate green without fixing the cause (critic I2). Fixers are told not to make
// them; the progress checker flags them, and a flag brings the re-reviewer into the next round.
const GATE_GUARD = 'Never change vitest config files (vitest*.config.*), biome.json, tsconfig*.json, package.json scripts or coverage thresholds or excludes, and never add suppression comments (biome-ignore, @ts-ignore, @ts-expect-error, istanbul ignore, v8 ignore, c8 ignore, eslint-disable) or delete the code a gate complains about, unless the brief or a ruling in force asks for it.'
const SENSITIVE_RULE = `This task is ${SENSITIVE ? 'sensitive' : 'gate-tier, so the sensitive rule applies'}. On sensitive tasks the ruler must escalate any ruling that would: (a) weaken a security, audit, credential, delegation or dispatch invariant; (b) change a shape frozen at a phase gate or listed as a contract file (master plan 8.2); (c) keep a Critical finding with stands. Everything else it rules.`

// scope: the text that bounds reading outside the diff (DIFF_SCOPE for reviewers and the critic,
// REREVIEW_SCOPE for re-reviewers).
function diffStep(base, head, out, scope = DIFF_SCOPE) {
  return [
    `First build your diff file (Git Bash), then read it once. It is your view of the change:`,
    '```bash',
    `mkdir -p "${out.replace(/\/[^/]+$/, '')}"`,
    `cd "${REPO}" && { echo "## Commits"; git log --oneline ${base}..${head}; echo; echo "## Files changed"; git diff --stat ${base}..${head}; echo; echo "## Diff"; git diff -U10 ${base}..${head}; } > "${out}"`,
    '```',
    scope,
  ].join('\n')
}
// Reviewers, the critic and re-reviewers are diff-scoped (issue #78).
const COST_LIMIT = 'only for a concrete risk you can name, one focused check per risk'
const DIFF_SCOPE = `Diff scope: after the diff, read outside the diff only files that call or are called by the changed code, and ${COST_LIMIT}; the spec lines in ${A.specRefs} and the rulings in force still apply; do not read unrelated files. Read a changed file separately only when a hunk you must judge is cut off; say so. Name each file you read outside the diff and the risk that sent you there.`
const REREVIEW_SCOPE = `Re-review scope: the fix diff. Read a caller or callee of the changed code ${COST_LIMIT}; the spec lines in ${A.specRefs} and the rulings in force still apply; do not read unrelated files. Name each file you read outside the fix diff and the risk that sent you there.`

const TESTS_RULE = 'The implementer already ran the tests and put the evidence in the report. Do not re-run the suite (an independent gate runs pnpm lint, pnpm typecheck and pnpm coverage on this same head). Run a focused test only for a specific doubt no existing run answers. Warnings or noise in reported test output are findings. Missing or garbled evidence is a gap to report, not a reason to re-run.'
const CALIBRATION = [
  'Severity: critical = broken behaviour, security or data risk; important = the task cannot be trusted until fixed (incorrect or fragile behaviour, a missed requirement, swallowed errors, tests that assert nothing, verbatim duplication of a logic block); minor = polish, broader coverage, style.',
  'If the brief or plan explicitly mandates something this rubric calls a defect, it is still a finding: report it as important with planMandated: true. The plan does not grade its own work.',
  'Treat the implementer report as unverified claims. A stated rationale ("YAGNI", "kept simple") never lowers a severity.',
  'Every finding cites file:line. id: short and unique within your review (e.g. S1, Q1, C1). contestsRuling: the id of a ruling in force that your finding contradicts, else "". A contested finding goes to the ruler, not the fixer.',
].join('\n')

const findingsText = (fs) => fs.map((f) => `- [${f.id}] ${f.severity.toUpperCase()} ${f.file}${f.line ? ':' + f.line : ''}: ${f.summary}${f.fix ? ' Fix: ' + f.fix : ''}${f.lastVerdict ? ` (last re-review: ${f.lastVerdict})` : ''}`).join('\n')

// ---------- state ----------
const state = {
  head: null,
  commits: [],
  rounds: 0,
  rulings: new Map(), // item id -> ruling in force (one per item)
  superseded: [], // { item, old, new }
  carryForward: [],
  deferredMinors: [],
  parked: [],
  questions: [],
  concerns: [],
  roundLog: [],
  preReviewProblems: [],
}

// ---------- rulings: one in force per item; controller > ruler, later > earlier ----------
const inForce = () => [...state.rulings.values()]
function retire(item, by) {
  const old = state.rulings.get(item)
  if (!old) return
  if (old.source === 'controller' && by.source !== 'controller') {
    log(`rule: ${by.source} ruling on ${by.item} cannot supersede the controller ruling on ${item}; the controller ruling stays`)
    return
  }
  state.rulings.delete(item)
  state.superseded.push({ item, old, new: by })
  log(`rule: ruling on ${item} (${old.decision}) superseded by ${by.item} (${by.decision})`)
}
// Records a ruling. supersedes: the id of a ruling in force that this one replaces (a contested ruling).
function setRuling(rec, supersedes) {
  const old = state.rulings.get(rec.item)
  if (old && old.source === 'controller' && rec.source !== 'controller') {
    log(`rule: ${rec.source} ruling on ${rec.item} ignored; the controller ruling stays`)
    return false
  }
  if (old) {
    state.rulings.delete(rec.item)
    state.superseded.push({ item: rec.item, old, new: rec })
  }
  state.rulings.set(rec.item, rec)
  if (supersedes && supersedes !== rec.item && rec.decision !== 'stands' && rec.decision !== 'escalate') retire(supersedes, rec)
  return true
}
// Applies answers.decisions to items. Returns { fixes, rest } where rest still needs the ruler.
function applyController(items) {
  const fixes = [], rest = []
  for (const it of items) {
    const d = CONTROLLER.get(it.id)
    if (!d) { rest.push(it); continue }
    ANSWERS.decisionsUsed.add(it.id)
    const rec = { item: it.id, what: it.text.slice(0, 160), decision: d.decision, reason: d.reason, costIfWrong: 'controller decision', fixInstruction: d.fixInstruction, command: '', source: 'controller' }
    setRuling(rec, it.contests)
    log(`rule: ${it.id} settled by controller decision: ${d.decision}`)
    if (d.decision === 'fix') fixes.push(fixFrom(it, d.fixInstruction || d.reason))
  }
  return { fixes, rest }
}
function fixFrom(it, instruction) {
  const f = it.finding || {}
  return { id: it.id, severity: f.severity === 'critical' ? 'critical' : 'important', file: f.file || '', line: f.line || '', summary: it.text, fix: instruction, planMandated: false, contestsRuling: '' }
}

// Rulings in force, for reviewers, re-reviewers, fixers and later rulers. "* [id]" bullets on purpose.
function rulingsText() {
  const list = inForce()
  if (!list.length) return ''
  return [
    'Rulings in force (binding; never reverse one; a finding that contradicts one sets contestsRuling to its id):',
    ...list.map((r) => `* [${r.item}] ${r.decision}${r.source === 'ruler' ? '' : ` (${r.source})`}: ${r.reason}`),
  ].join('\n')
}

// ---------- ledger + return ----------
// Ledger Ruling line format: "- Task N: Ruling: <what> {U+2014} <decision>: <why> {U+2014} <cost if wrong>".
function ledgerLines(result) {
  const out = []
  const b7 = String(A.base).slice(0, 7)
  const h7 = String(result.head || A.base).slice(0, 7)
  for (const r of inForce()) out.push(`- Task ${N}: Ruling${r.source === 'ruler' ? '' : ` (${r.source})`}: ${r.what} \u2014 ${r.decision}: ${r.reason} \u2014 ${r.costIfWrong}`)
  for (const s of state.superseded) out.push(`- Task ${N}: Ruling superseded: ${s.item} (${s.old.decision}) by ${s.new.item} (${s.new.decision}${s.new.source === 'controller' ? ', controller' : ''}): ${s.new.reason}`)
  for (const c of state.carryForward) out.push(`- Task ${N}: carry forward: ${c}`)
  for (const l of state.roundLog) out.push(`- Task ${N}: ${l}`)
  for (const m of state.deferredMinors) out.push(`- Task ${N}: minor (deferred): ${m}`)
  const ag = `; ${agentsUsed} agent${agentsUsed === 1 ? '' : 's'}`
  if (result.status === 'complete') out.push(`- Task ${N}: complete (commits ${b7}..${h7}, review clean, gate green${ag})`)
  else if (result.status === 'parked') out.push(`- Task ${N}: complete (commits ${b7}..${h7}, ${result.parked.length} parked${ag})`)
  else out.push(`- Task ${N}: stopped at ${result.stopped} (head ${h7}); controller action needed`)
  return out.map((l) => l.replace(/[\r\n]+/g, ' '))
}

async function finish(result) {
  if (ANSWERS) {
    const unused = [...CONTROLLER.keys()].filter((k) => !ANSWERS.decisionsUsed.has(k))
    if (unused.length) log(`answers: decision(s) matched no item and were not applied: ${unused.join(', ')}`)
    const pending = ANSWERS.entries.filter((e) => !e.delivered)
    if (pending.length) {
      log(`answers not consumed: ${pending.map((e) => `answers[${e.index}] (${e.at})`).join(', ')} (no consumer ran in this run)`)
      result.answersUnconsumed = true
    }
  }
  // No ledger agent: the lines come back as ledgerLines and the controller appends them with
  // node scripts/sdd/append-ledger.mjs <workflow-output-file> <ledgerPath>.
  const lines = ledgerLines(result)
  result.ledgerLines = lines
  log(A.ledgerPath ? `ledger: controller appends ${lines.length} lines to ${A.ledgerPath}` : `ledger: ${lines.length} lines returned as ledgerLines (no ledgerPath)`)
  return result
}

function build(status, extra) {
  return Object.assign(
    {
      task: N,
      status,
      base: A.base,
      head: state.head || A.base,
      commits: state.commits,
      rounds: state.rounds,
      rulings: inForce(),
      supersededRulings: state.superseded,
      carryForward: state.carryForward,
      deferredMinors: state.deferredMinors,
      parked: state.parked,
      questions: state.questions,
      concerns: state.concerns,
      agents: agentsUsed,
    },
    extra || {},
  )
}

// ---------- verifyHead (#222) ----------
// The only source of a head sha in this script. One Haiku agent reads git; the script accepts only
// a 40-hex value the agent confirmed exists. agentHead is what an earlier agent reported: compared
// and logged on a difference, never used. An invalid answer stops the run (precondition:verifyHead).
const SHA40 = /^[0-9a-f]{40}$/
const gitSha = (v) => {
  const head = String((v && v.revParse) || '').trim()
  return SHA40.test(head) && String((v && v.catFile) || '').trim() === `EXISTS ${head}` ? head : null
}
async function verifyHead(agentHead, label) {
  const prompt = [
    `Read-only git check in ${REPO}. Run these two commands in Git Bash and return the raw stdout of each, copied exactly, with no interpretation. Change nothing.`,
    `1. git -C "${REPO}" rev-parse HEAD`,
    `2. sha=$(git -C "${REPO}" rev-parse HEAD) && git -C "${REPO}" cat-file -e "$sha^{commit}" && echo "EXISTS $sha" || echo MISSING`,
    'Return revParse (the stdout of command 1) and catFile (the stdout of command 2).',
    HOUSE,
  ].join('\n')
  const run = (p, l) => call(p, { label: l, phase: 'Verify', schema: VERIFY_HEAD, ...role('verifyHead') })
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
    throw Object.assign(new Error(`verifyHead: ${label} did not return a 40-hex sha that exists (${shown})`), {
      verifyStop: `verifyHead: ${label} did not return a 40-hex sha that exists in git (${shown}); check the repository in ${REPO}, then answer at precondition:verifyHead to re-run it once`,
    })
  }
  const a = String(agentHead || '').trim().toLowerCase()
  if (a && !(a.length >= 7 && head.startsWith(a))) log(`agent-reported head ${a.slice(0, 16)}... differs from git; using git`)
  return head
}

// ---------- ruler ----------
// items: [{ id, kind, text, severity?, finding?, contests? }]. Controller decisions settle their items
// first; the rest go to the ruler. Returns { fixes:[finding], escalated:[ruling], unruled:[item] }.
// postGateHead: set for ruler-review (it runs after gate-0); the ruler then reports head and tree,
// and a moved head or dirty tree returns { precondition } without applying any ruling.
async function runRuler(allItems, label, headNow, pos, postGateHead) {
  const pre = applyController(allItems)
  const items = pre.rest
  if (!items.length) {
    log(`rule: every item settled by controller decisions; no ${label} call`)
    return { fixes: pre.fixes, escalated: [], unruled: [] }
  }
  log(`rule: ${items.length} item(s) to the ruler (${tier('ruler')})`)
  const rulerPrompt = [
    `You are the ruler for Task ${N}: ${A.title}. Rule on each item below. The spec is binding; the plan is not when it conflicts with the spec.`,
    `Read only what you need: the brief ${A.briefPath}, the implementer report ${A.reportPath}, the spec sections ${A.specRefs}, the requirements doc "${REQ_DOC}" for IDs ${A.ids || '(none given)'}, and the specific files an item names. Review files for this task are in ${A.workDir} (task-${N}-review*.md).`,
    A.carries ? `Controller rulings and interfaces already in force:\n${A.carries}` : '',
    rulingsText(),
    answersFor(pos),
    `Code under judgment: ${A.base}..${headNow}. ${GIT}`,
    '',
    'Items:',
    ...items.map((it) => `- [${it.id}] (${it.kind}${it.severity ? `, ${it.severity}` : ''}) ${it.text}`),
    '',
    'Decide each item:',
    '- fix: the code must change. Give fixInstruction: the smallest change that satisfies the spec.',
    '- stands: the code stays. Give the reason (spec or plan citation).',
    '- verified: a cannot-verify item you checked yourself and that passed. Put the command you ran and its result in command. A check that fails is fix, not verified.',
    '- escalate: only when every path is a guess, or the action is irreversible or security-sensitive.',
    GUARDED ? SENSITIVE_RULE : '',
    'costIfWrong: one line, what it costs if your ruling is wrong. carryForward: obligations a later task must meet because of your ruling (e.g. "Task 8 must show tsc -b exit 0"); omit when none.',
    'You are read-only: do not edit, commit or change any git state. Scratch, if needed: ' + scratch(label),
    postGateHead ? postGateCheck(postGateHead) : '',
    HOUSE,
    'Return one ruling per item, with item set to the id exactly as given.',
  ].filter(Boolean).join('\n')
  const schema = postGateHead ? RULINGS_POST : RULINGS
  let res = await call(rulerPrompt, { label, phase: 'Rule', schema, ...role('ruler') })
  if (postGateHead) {
    let bad = postGateProblem(res, postGateHead)
    const ans = bad ? preconditionAnswers(label) : ''
    if (ans) {
      log(`rule: cached ${label} left the repository changed (${bad}); retrying with the controller answer`)
      res = await call(`${rulerPrompt}\n\n${ans}`, { label: `${label}-retry`, phase: 'Rule', schema, ...role('ruler') })
      bad = postGateProblem(res, postGateHead)
    }
    if (bad) {
      log(`rule: ${label} precondition failed after gate-0: ${bad}; stopping, no ruling applied`)
      return { fixes: [], escalated: [], unruled: [], precondition: `${label}: ${bad}` }
    }
  }
  const byId = new Map()
  for (const r of (res && res.rulings) || []) byId.set(r.item.replace(/^\[|\]$/g, '').trim(), r)
  const fixes = pre.fixes.slice(), escalated = [], unruled = []
  for (const it of items) {
    let r = byId.get(it.id)
    if (!r) { unruled.push(it); continue }
    // Rule (c) never touches a controller decision: those items were settled above and never reach here.
    if (GUARDED && it.severity === 'critical' && (r.decision === 'stands' || r.decision === 'verified')) {
      log(`rule: ${it.id} is critical on a ${TIER}-tier task and was ruled ${r.decision}; escalated by rule (c); answer with answers.decisions to settle it`)
      r = Object.assign({}, r, { decision: 'escalate', reason: `ruled ${r.decision} on a critical finding (sensitive rule c): ${r.reason}` })
    }
    setRuling({ item: it.id, what: it.text.slice(0, 160), decision: r.decision, reason: r.reason, costIfWrong: r.costIfWrong, fixInstruction: r.fixInstruction || '', command: r.command || '', source: 'ruler' }, it.contests)
    for (const c of r.carryForward || []) state.carryForward.push(c)
    if (r.decision === 'escalate') escalated.push(Object.assign({ text: it.text }, r))
    if (r.decision === 'fix') fixes.push(fixFrom(Object.assign({}, it, { finding: it.finding || { severity: it.severity } }), r.fixInstruction || r.reason))
  }
  if (!res) log('rule: ruler returned null (skipped or died); every item is unruled')
  if (unruled.length) log(`rule: ${unruled.length} item(s) got no ruling and are parked: ${unruled.map((u) => u.id).join(', ')}`)
  return { fixes, escalated, unruled, probed: Boolean(postGateHead && res) }
}

// ---------- fixer, progress checker, re-reviewer, gate ----------
async function runFixer(findings, label, roleName, roundTag, round) {
  return call(
    [
      `You are fixing review findings on Task ${N}: ${A.title} (${roundTag}). You are a fresh agent: read the brief ${A.briefPath} (your requirements, exact values), the implementer report ${A.reportPath}, and the review files in ${A.workDir} (task-${N}-review*.md, task-${N}-re-review-*.md) as you need them.`,
      A.carries ? `Controller rulings and interfaces in force:\n${A.carries}` : '',
      `Global constraints (binding):\n${A.globalConstraints}`,
      rulingsText(),
      'Never reverse a ruling. If a finding cannot be fixed without reversing one, leave it and say so in concerns (kind planVsSpec).',
      answersFor(label.startsWith('fixer-r') ? 10 + 2 * round : 2),
      '',
      'Findings to fix (all of them; a ruler fixInstruction is the change to make):',
      findingsText(findings),
      '',
      'TDD: for each behavioural finding, first write or tighten a test that fails for the defect, run it and see it fail, then fix, then see it pass. Run the tests that cover the amended code while iterating. A gate finding (lint, typecheck, coverage, head, tree) is fixed at its cause.',
      SELF_CHECK,
      GATE_GUARD,
      `Append a "## Fix ${roundTag}" section to ${A.reportPath}: per finding id, what you changed (file:line), the covering tests, the commands and their output (RED and GREEN).`,
      `Commit only the files these fixes touch (git add <paths>, never git add -A) with a message "fix(task-${N}): ${roundTag} review findings" and a body listing the finding ids. ${TRAILER}`,
      GIT,
      HOUSE,
      'If you cannot fix a finding, say which and why in concerns (kind correctness) and use DONE_WITH_CONCERNS; use BLOCKED or NEEDS_CONTEXT with questions only when you cannot proceed at all.',
    ].filter(Boolean).join('\n'),
    { label, phase: 'Fix', schema: WORK, ...role(roleName) },
  )
}

// Cannot-verify items: one read-only checker runs each item's suggested check.
async function runChecker(items, headNow, expectedHead, answerText, label) {
  return call(
    [
      `You are the checker for Task ${N}: ${A.title}. Reviewers could not verify the items below from the diff alone. Run each item's suggested check (or the closest equivalent) and report what you found.`,
      `Context as you need it: the brief ${A.briefPath}, the implementer report ${A.reportPath}, the requirements doc "${REQ_DOC}". Code under check: ${A.base}..${headNow}. ${GIT}`,
      '',
      'Items:',
      ...items.map((it) => `- [${it.id}] ${it.text}`),
      '',
      'Per item, result:',
      '- verified: the check ran and passed. evidence: the command and the output lines that show it.',
      '- failed: the check ran and failed. evidence: the command and the failing lines.',
      '- needsJudgment: the check cannot settle the item (it needs a reading of the spec or a design decision). evidence: why.',
      `You are read-only: you may run commands (tests, grep, git log, git diff, git show), but never edit a file, stage, commit or change any git state. Scratch, if needed: ${scratch('checker')}`,
      postGateCheck(expectedHead),
      HOUSE,
      'Return one result per item, with id set to the id exactly as given.',
      ...(answerText ? ['', answerText] : []),
    ].join('\n'),
    { label, phase: 'Check', schema: CHECK, ...role('checker') },
  )
}

// noCode: the controller closed every open finding of this round with no code change (an answer
// { at: "fixer-r<r>", text, noCode: true }), so an empty round is expected. Only check 1 is waived.
async function runProgress(label, roundBase, priorTests, noCode = false) {
  return call(
    [
      `Check a fix round on Task ${N} in ${REPO}. Round base: ${roundBase}. ${GIT}`,
      'Checks (report each failure as one line in problems; ok is true only with no problems):',
      noCode
        ? `1. Check 1 does not apply this round: the controller closed every open finding with no code change, so no new commit is expected. Still list any commits from git log --oneline ${roundBase}..HEAD in newCommits (full sha, subject); an empty list is not a problem.`
        : `1. New commits exist: git log --oneline ${roundBase}..HEAD is not empty. List them in newCommits (full sha, subject).`,
      '2. Working tree clean: git status --porcelain prints nothing.',
      `3. No test was skipped or focused: git diff ${roundBase}..HEAD adds no .skip( / .only( / it.skip / describe.only / test.todo (grep the + lines).`,
      `4. No test file deleted or emptied: git diff --diff-filter=D --name-only ${roundBase}..HEAD and git diff --numstat ${roundBase}..HEAD show no *.test.* or *.spec.* file deleted or left with no content.`,
      `5. Test count not lower: run pnpm test once (full suite). Report the passing count as testCount (-1 if the run failed). Prior evidence: ${priorTests}. Lower than that, or any failure, is a problem.`,
      `6. No gate weakening (report each hit in guardHits as "file:line: what", not in problems): git diff ${roundBase}..HEAD must not touch vitest config files (vitest*.config.*), biome.json, tsconfig*.json, package.json scripts, or coverage thresholds or excludes, and its + lines must not add biome-ignore, @ts-ignore, @ts-expect-error, istanbul ignore, v8 ignore, c8 ignore or eslint-disable. Flag a hit even when the brief may allow it; a reviewer decides.`,
      'head: git rev-parse HEAD (full sha).',
      'You are read-only: change nothing, commit nothing. Scratch, if needed: ' + scratch(label),
      HOUSE,
    ].join('\n'),
    { label, phase: 'Fix', schema: PROGRESS, ...role('progressChecker') },
  )
}

// gateFindings: gate-* findings still open in a mixed round. The re-reviewer sees them but does not
// verdict them (it does not re-run the suite); gate-r<r> decides them.
async function runReReview(findings, gateFindings, label, roundBase, headNow, r) {
  const out = wjoin(`task-${N}-re-review-${r}.md`)
  return call(
    [
      `You are re-reviewing fix round ${r} of Task ${N}: ${A.title}. A review produced the findings below; a fixer attempted them. Verdict each finding against the fix diff (scope below).`,
      `Brief: ${A.briefPath}. Fix report: the "Fix" sections at the end of ${A.reportPath}.`,
      rulingsText(),
      '',
      'Findings under verification:',
      findingsText(findings),
      gateFindings.length ? `\nGate findings, not yours to verdict (each is verified by gate-r${r}, which re-runs lint, typecheck and coverage); leave them out of verdicts:\n${findingsText(gateFindings).replace(/^- /gm, '* ')}` : '',
      '',
      diffStep(roundBase, headNow, join(scratch(label), 'fix.diff'), REREVIEW_SCOPE),
      READONLY,
      'Tests: the fixer appended RED/GREEN evidence. Confirm it names the covering tests and shows output; do not re-run the suite; a focused test only for a named doubt.',
      'Scope: verdict every finding (ADDRESSED only when the specific defect no longer exists; "attempted" is NOT ADDRESSED), with file:line evidence. List anything the fix itself broke as newFindings (severity by the usual rubric; planMandated false; contestsRuling set when it contradicts a ruling in force). Issues entirely outside the fix diff go in outOfScope; they do not block.',
      `Write your full re-review to ${out}: Finding Verdicts, New Breakage in the Fix Diff, Out-of-Scope Observations, Verdict. No preamble.`,
      HOUSE,
      'Return one verdict per finding id, exactly as given.',
    ].filter(Boolean).join('\n'),
    { label, phase: 'Fix', schema: REREVIEW, ...role('reReviewer') },
  )
}

async function runGate(label, expectedHead, answerText) {
  return call(
    [
      `You are the independent gate for Task ${N}: ${A.title}. Trust no earlier report; check the repository yourself. ${GIT}`,
      answerText,
      `Precondition: git branch --show-current is ${A.branch}, and git rev-parse HEAD equals ${expectedHead} (compare full shas; a short sha is a prefix match). If not, set preconditionFailed to what you found, ok false, and run nothing else.`,
      'Checks (one line per failure in problems; ok is true only with no problems):',
      '1. (precondition above)',
      '2. git status --porcelain prints nothing.',
      '3. pnpm lint exits 0.',
      '4. pnpm typecheck exits 0.',
      '5. pnpm coverage exits 0 (it runs the full suite and enforces the coverage thresholds).',
      `Run each command once, in that order, saving its full output under ${scratch(label)}. For a failure, put the command and its first error lines in problems (file paths, rule names and messages only; never field values or payloads).`,
      'head: git rev-parse HEAD (full sha).',
      'You are read-only: change nothing, commit nothing.',
      HOUSE,
    ].filter(Boolean).join('\n'),
    { label, phase: 'Gate', schema: GATE, ...role('gate') },
  )
}

// Settles one gate result: a precondition retry when answered, then stop (null or precondition), green,
// or red with problems as open findings. Returns { stop } | { ok: true } | { ok: false, findings }.
async function gateOutcome(gl, g, expectedHead) {
  const pre = g && g.preconditionFailed ? preconditionAnswers(gl) : ''
  if (pre) {
    log(`gate: cached precondition failure (${g.preconditionFailed}); retrying ${gl} with the controller answer`)
    g = await runGate(`${gl}-retry`, expectedHead, pre)
  }
  if (!g) {
    log(`gate: ${gl} returned null (skipped or died); stopping`)
    return { stop: await finish(build('stopped', { stopped: gl, questions: state.questions.concat([`${gl} returned no result; re-run (answers at "${gl}" go to the next fixer round)`]) })) }
  }
  if (g.preconditionFailed) {
    log(`gate: ${gl} precondition failed: ${g.preconditionFailed}; stopping, not a finding`)
    return { stop: await finish(build('stopped', { stopped: 'precondition', stopPoint: `precondition:${gl}`, problem: `${gl}: ${g.preconditionFailed}` })) }
  }
  // g.head is never taken: the gate's precondition already required HEAD to equal the verified expectedHead.
  if (g.ok) {
    log(`gate: ${gl} green at ${String(state.head).slice(0, 7)}`)
    return { ok: true }
  }
  const problems = g.problems.length ? g.problems : ['gate reported not ok but listed no problem; re-check lint, typecheck and coverage']
  log(`gate: ${gl} red: ${problems.join('; ')}`)
  state.roundLog.push(`${gl} red (${problems.length} problem(s))`)
  return { ok: false, findings: problems.map((p, k) => ({ id: `${gl}:${k + 1}`, severity: 'important', file: '', line: '', summary: `gate: ${p}`, fix: 'fix the cause so the gate check passes', planMandated: false, contestsRuling: '' })) }
}

// The flow runs inside one try so a budget stop anywhere returns a stopped result (the flow below
// is deliberately not re-indented).
// open: findings still to fix; declared here so a budget stop can return them as parked.
let open = []
try {
// ================= 1. Implement =================
phase('Implement')
log(`task ${N} "${A.title}" on ${A.branch} from ${String(A.base).slice(0, 7)}; tier ${TIER}${UI ? ', UI' : ''}; maxRounds ${MAX_ROUNDS}; maxAgents ${MAX_AGENTS}`)
log(`roles: implementer ${tier('implementer')}, ${SENSITIVE ? `spec ${tier('specReviewer')}, quality ${tier('qualityReviewer')}` : `reviewer (spec and quality) ${tier('reviewer')}`}, critic ${CRITIC ? tier('critic') : 'off'}, ruler ${tier('ruler')}, fixer ${tier('fixer')}, escalated fixer ${tier('escalatedFixer')}, checker ${tier('checker')}, progress ${tier('progressChecker')}, re-review ${tier('reReviewer')}, gate ${tier('gate')}`)

// The implementer prompt never carries answers, so a re-run with answers replays it from cache.
const implPrompt = [
    `You are implementing Task ${N}: ${A.title}${A.issue ? ` (issue #${A.issue})` : ''}.`,
    `Read your brief first: ${A.briefPath}. It is your requirements, with exact values; follow its steps, file list and commit message.`,
    A.ids ? `Requirement IDs this task serves: ${A.ids}.` : '',
    A.carries ? `Controller rulings and interfaces the brief cannot know (binding):\n${A.carries}` : '',
    `Global constraints from the plan (binding):\n${A.globalConstraints}`,
    '',
    `Precondition: git branch --show-current is ${A.branch}, git rev-parse HEAD is ${A.base}, and git status --porcelain prints nothing. If any is not so, change nothing, set preconditionFailed to what you found (for a dirty tree, name each untracked or modified file from git status --porcelain), and report BLOCKED.`,
    'Your job: implement exactly what the brief specifies, nothing more. TDD: write the failing test, run it and see it fail for the expected reason, implement, see it pass. While iterating run the focused test.',
    SELF_CHECK,
    `Commit only this task's files (git add <paths>, never git add -A) with the brief's commit message. ${TRAILER}`,
    GIT,
    HOUSE,
    '',
    'Stop and report BLOCKED or NEEDS_CONTEXT (with specific questions) when the task needs an architectural decision the brief does not make, when you are unsure your approach is right, or when you keep reading files without progress. Bad work is worse than no work.',
    'Concerns: kind planVsSpec when the brief conflicts with the spec or requirements; kind correctness when you doubt your result is right; kind observation for anything else worth noting. A planVsSpec or correctness concern goes to a ruler before review.',
    '',
    'Before reporting, self-review your diff: completeness against the brief, names, YAGNI, existing patterns, tests that verify behaviour, pristine test output. Fix what you find.',
    `Write your full report to ${A.reportPath}: what you implemented, files changed, TDD evidence (RED: command, failing output, why expected; GREEN: command, passing output), the pnpm lint, pnpm typecheck and pnpm coverage results, self-review findings, concerns.`,
    'Return: status, commits (full sha + subject), head (git rev-parse HEAD), a one-line test summary, concerns, questions.',
  ].filter(Boolean).join('\n')
// The implement stage: the implementer, its precondition retry and its continuation. Returns
// { impl } or { stop: <finished result> }.
async function implementStage() {
  let impl
  impl = await call(implPrompt, { label: 'implementer', phase: 'Implement', schema: WORK, ...role('implementer') })

  if (!impl) {
    log('implement: implementer returned null (skipped or died); stopping')
    return { stop: await finish(build('stopped', { stopped: 'implementer', questions: ['implementer returned no result'] })) }
  }

  const implPre = impl.preconditionFailed ? preconditionAnswers('implementer') : ''
  if (implPre) {
    log(`implement: cached precondition failure (${impl.preconditionFailed}); retrying the implementer with the controller answer`)
    impl = await call(`${implPrompt}\n\n${implPre}`, { label: 'implementer-retry', phase: 'Implement', schema: WORK, ...role('implementer') })
    if (!impl) return { stop: await finish(build('stopped', { stopped: 'implementer', questions: ['implementer retry returned no result'] })) }
  }
  if (impl.preconditionFailed) {
    log(`implement: precondition failed: ${impl.preconditionFailed}; stopping before any change`)
    return { stop: await finish(build('stopped', { stopped: 'precondition', stopPoint: 'precondition:implementer', problem: `implementer: ${impl.preconditionFailed}` })) }
  }

  const contAnswers = impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT' ? answersFor(0) : ''
  if (contAnswers) {
    log(`implement: cached implementer stopped (${impl.status}); running the continue implementer with the controller answers`)
    const cont = await call(
      [
        `You are continuing Task ${N}: ${A.title}${A.issue ? ` (issue #${A.issue})` : ''}. An earlier implementer stopped with ${impl.status}; the controller has answered.`,
        `Read the brief ${A.briefPath} (requirements, exact values) and the earlier report ${A.reportPath}. Check what is already committed: git log --oneline ${A.base}..HEAD. Build on those commits; do not redo committed work and do not reset or rewrite history.`,
        A.carries ? `Controller rulings and interfaces the brief cannot know (binding):\n${A.carries}` : '',
        `Global constraints from the plan (binding):\n${A.globalConstraints}`,
        '',
        'The questions the earlier implementer asked:',
        ...(impl.questions.length ? impl.questions.map((q) => `- ${q}`) : ['- (none recorded; see the report)']),
        impl.concerns.length ? `Its concerns:\n${impl.concerns.map((c) => `- ${c.kind}: ${c.text}`).join('\n')}` : '',
        contAnswers,
        '',
        'Finish the task exactly as the brief specifies, with TDD (failing test first, seen failing, then green).',
        SELF_CHECK,
        `Commit only this task's files (git add <paths>, never git add -A) with the brief's commit message. ${TRAILER}`,
        `Append a "## Continuation" section to ${A.reportPath} with what you did, TDD evidence and the pnpm lint, pnpm typecheck and pnpm coverage results.`,
        GIT,
        HOUSE,
        'Return: status, commits you created (full sha + subject), head, a one-line test summary, concerns, questions. BLOCKED or NEEDS_CONTEXT only when the answers still leave you unable to proceed.',
      ].filter(Boolean).join('\n'),
      { label: 'implementer-continue', phase: 'Implement', schema: WORK, ...role('implementer') },
    )
    if (!cont) {
      log('implement: continue implementer returned null; stopping')
      return { stop: await finish(build('stopped', { stopped: 'implementer', questions: ['continue implementer returned no result'] })) }
    }
    impl = Object.assign({}, cont, { commits: impl.commits.concat(cont.commits) })
  }
  return { impl }
}
let impl
if (IMPLEMENTED) {
  log(`implement: skipped (implemented.head ${IMPLEMENTED.head}); reviewing ${A.base}..${IMPLEMENTED.head}, review stages only`)
  impl = { status: 'DONE', commits: [], head: IMPLEMENTED.head, testSummary: 'review-only re-run: no implementer evidence in this run; the gate re-runs lint, typecheck and coverage', concerns: [], questions: [] }
} else {
  const stage = await implementStage()
  if (stage.stop) return stage.stop
  impl = stage.impl
}

state.commits.push(...impl.commits)
state.head = await verifyHead(impl.head, 'verify-head-impl')
state.questions.push(...impl.questions)
log(`implement: ${impl.status}, ${impl.commits.length} commit(s), head ${String(state.head).slice(0, 7)}, tests: ${impl.testSummary}`)

if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
  state.concerns.push(...impl.concerns)
  return await finish(build('stopped', { stopped: 'implementer' }))
}
if (!impl.commits.length && !IMPLEMENTED) {
  log('implement: no commits reported; stopping')
  state.concerns.push(...impl.concerns)
  return await finish(build('stopped', { stopped: 'implementer', questions: state.questions.concat(['implementer reported DONE with no commits']) }))
}

for (const c of impl.concerns.filter((c) => c.kind === 'observation')) state.deferredMinors.push(`implementer observation: ${c.text}`)
const implConcerns = impl.concerns.filter((c) => c.kind !== 'observation').map((c, i) => ({ id: `IC${i + 1}`, kind: `implementer ${c.kind} concern`, text: c.text }))

let lastTests = impl.testSummary

if (implConcerns.length) {
  phase('Rule')
  const ruled = await runRuler(implConcerns, 'ruler-concerns', state.head, 1)
  state.parked.push(...ruled.unruled)
  if (ruled.escalated.length) {
    log(`rule: ${ruled.escalated.length} escalation(s); stopping`)
    return await finish(build('stopped', { stopped: 'ruler-concerns', escalated: ruled.escalated }))
  }
  if (ruled.fixes.length) {
    phase('Fix')
    const preBase = state.head
    const fx = await runFixer(ruled.fixes, 'fixer-pre', 'fixer', 'pre-review round', 0)
    if (!fx || fx.status === 'BLOCKED' || fx.status === 'NEEDS_CONTEXT') {
      if (fx) { state.questions.push(...fx.questions); state.concerns.push(...fx.concerns) }
      return await finish(build('stopped', { stopped: 'fixer-pre' }))
    }
    state.concerns.push(...fx.concerns.filter((c) => c.kind !== 'observation'))
    const pc = await runProgress('progress-pre', preBase, lastTests)
    if (pc) {
      state.commits.push(...pc.newCommits)
      if (pc.testCount >= 0) lastTests = `${pc.testCount} passing`
      if (pc.guardHits.length) state.preReviewProblems.push(...pc.guardHits.map((g) => `gate weakening: ${g}`))
      if (!pc.ok) {
        state.preReviewProblems.push(...pc.problems)
        log(`fix: pre-review progress problems (passed to the reviewers): ${pc.problems.join('; ')}`)
      }
    } else {
      state.commits.push(...fx.commits)
      log('fix: pre-review progress checker returned null; the head still comes from git')
    }
    state.head = await verifyHead(pc ? pc.head : fx.head, 'verify-head-pre')
    state.roundLog.push(`fix round pre-review (ruled concerns ${ruled.fixes.map((f) => f.id).join(', ')}; head ${String(state.head).slice(0, 7)})`)
  }
}

// ================= 2. Review =================
phase('Review')
const reviewHead = state.head
const common = (roleLabel) => [
  `Brief (what was requested): ${A.briefPath}.`,
  `Global constraints that bind this task:\n${A.globalConstraints}`,
  A.carries ? `Controller rulings and interfaces in force:\n${A.carries}` : '',
  rulingsText(),
  state.preReviewProblems.length ? `Progress-check problems after the pre-review fix (judge whether each still holds):\n${state.preReviewProblems.map((p) => `* ${p}`).join('\n')}` : '',
  `Implementer report (unverified claims, fix sections at the end): ${A.reportPath}.`,
  `Base ${A.base}, head ${reviewHead}.`,
  diffStep(A.base, reviewHead, join(scratch(roleLabel), 'review.diff')),
  READONLY,
  TESTS_RULE,
  CALIBRATION,
  `cannotVerify: requirements you cannot verify from the diff alone, each with the check to run. Do not broaden your search to settle them. The gate independently runs pnpm lint, pnpm typecheck and pnpm coverage on this same head: never list lint, typecheck, tests, coverage or the report's test counts as cannotVerify.`,
  HOUSE,
].filter(Boolean).join('\n')

// Spec and quality instructions, shared by the split reviewers (critical) and the combined reviewer
// (ordinary and gate).
const SPEC_CHECKS = [
  `Spec compliance: compare the diff with the brief and with the spec sections ${A.specRefs}. Requirement IDs: ${A.ids || '(none given)'}; cite each ID verbatim as it appears in "${REQ_DOC}" (read the IDs there; FR-, UX-, SEC-, BR-, NFR- and the rest), never a paraphrase.`,
  'Report Missing (skipped or claimed without implementing), Extra (unrequested features, over-engineering) and Misunderstood (right feature built wrong). If the brief lists several files each with its own change, check every listed file has its hunk; an untouched listed file is a Missing finding.',
  'Check every fixture and test value in the diff against the fixture policy in the global constraints; a real-looking person, vehicle or property record is a critical finding.',
  'TDD evidence: missing or implausible RED evidence for a behavioural change is an important finding.',
]
const QUALITY_CHECKS = "Code quality: separation of concerns, error handling, DRY without premature abstraction, edge cases; tests verify real behaviour and cover the task's edge cases; each file has one responsibility and follows the plan's file structure; flag new files that are already large or files this change grew a lot."
const reviewers = SENSITIVE
  ? [
      {
        key: 'spec',
        roleName: 'specReviewer',
        prompt: [
          `You are the spec reviewer for Task ${N}: ${A.title}. Task-scoped gate, not a merge review.`,
          common('spec-review'),
          '',
          "Spec compliance only (code quality is another reviewer's job).",
          ...SPEC_CHECKS,
          `Write your full review to ${wjoin(`task-${N}-review-spec.md`)}: Spec Compliance verdict with file:line per finding, per-ID verdicts, Cannot verify, Strengths, Issues by severity. No preamble.`,
          'verdict: pass only with no critical or important finding.',
        ].join('\n'),
      },
      {
        key: 'quality',
        roleName: 'qualityReviewer',
        prompt: [
          `You are the quality reviewer for Task ${N}: ${A.title}. Task-scoped gate, not a merge review.`,
          common('quality-review'),
          '',
          `${QUALITY_CHECKS} Code quality only (spec compliance is another reviewer's job).`,
          `Write your full review to ${wjoin(`task-${N}-review-quality.md`)}: Strengths, Issues (Critical, Important, Minor) with file:line, why it matters, how to fix; Assessment. No preamble.`,
          'verdict: pass only with no critical or important finding.',
        ].join('\n'),
      },
    ]
  : [
      {
        key: 'combined',
        roleName: 'reviewer',
        combined: true,
        prompt: [
          `You are the reviewer for Task ${N}: ${A.title}. You do both the spec-compliance review and the code-quality review. Task-scoped gate, not a merge review.`,
          common('combined-review'),
          '',
          ...SPEC_CHECKS,
          QUALITY_CHECKS,
          'Tag every finding and every cannotVerify item with kind: spec (spec compliance: requirements, IDs, fixtures, RED evidence) or kind: quality (code quality). Use S1, S2 ids for spec findings and Q1, Q2 for quality findings.',
          `Write your full review to ${wjoin(`task-${N}-review.md`)}: Spec Compliance (verdict, file:line per finding, per-ID verdicts), Code Quality (Strengths; Issues by severity with file:line, why it matters, how to fix), Cannot verify, Assessment. No preamble.`,
          'verdict: pass only with no critical or important finding of either kind.',
        ].join('\n'),
      },
    ]
if (CRITIC) {
  const focusParts = []
  if (SENSITIVE) focusParts.push('sensitive-code risk (credential handling, audit logging that can be skipped, rewritten or deleted, query dispatch and correlation, terminal parser, write-back, soft delete, the verify gate; CJIS and GDPR exposure; fail-open paths; secrets or real-looking records in fixtures)')
  if (TIER === 'gate') focusParts.push('gate-tier risk (CI workflows, check scripts, config and tooling that guard the verify gate: fail-open checks, git or tool failures read as pass, shallow clones, empty inputs, rename or path bypasses, a weakened threshold)')
  if (UI) focusParts.push('UI risk (accessibility, keyboard paths, focus, states the brief names, regressions to existing components, tokens instead of literals)')
  if (CRITIC_FOCUS) focusParts.push(CRITIC_FOCUS)
  if (!focusParts.length) focusParts.push(DEFAULT_CRITIC_FOCUS)
  reviewers.push({
    key: 'critic',
    roleName: 'critic',
    prompt: [
      `You are the critic for Task ${N}: ${A.title}. Read the whole diff adversarially: assume something is wrong and try to find it. Focus: ${focusParts.join('; ')}.`,
      common('critic'),
      '',
      'Report only real defects with a concrete failure path; say how it fails. Spec gaps you notice go in too, with the spec citation.',
      `Write your full critique to ${wjoin(`task-${N}-review-critic.md`)}: Issues by severity with file:line and failure path, Assessment. No preamble.`,
      'verdict: pass only with no critical or important finding.',
    ].join('\n'),
  })
} else {
  log('review: critic off (ordinary tier, not UI, and critic is not set)')
}

// gate-0 runs in parallel with the reviewers on the same head (reviewHead).
log(`review: ${reviewers.map((r) => r.key).join(', ')} and gate-0 in parallel on ${String(reviewHead).slice(0, 7)}`)
reserve(reviewers.length + 1, `${reviewers.map((r) => `${r.key}-review`).join(', ')} and gate-0`, 'Review')
const reviewAndGate = await parallel([
  ...reviewers.map((r) => () => call(r.prompt, { label: `${r.key}-review`, phase: 'Review', schema: r.combined ? REVIEW_COMBINED : REVIEW, ...role(r.roleName) })),
  () => runGate('gate-0', reviewHead, ''),
])
const reviews = reviewAndGate.slice(0, reviewers.length)
const dead = reviewers.filter((r, i) => !reviews[i]).map((r) => r.key)
if (dead.length) {
  log(`review: ${dead.join(', ')} returned null (skipped or died); stopping, no clean verdict without every reviewer`)
  return await finish(build('stopped', { stopped: 'review', questions: state.questions.concat([`reviewer(s) returned no result: ${dead.join(', ')}; re-run to resume`]) }))
}
const gate0 = await gateOutcome('gate-0', reviewAndGate[reviewers.length], reviewHead)
if (gate0.stop) return gate0.stop

open = []
const toRule = []
const cannotVerify = []
const where = (f) => `${f.file}${f.line ? ':' + f.line : ''}`
reviewers.forEach((r, i) => {
  const rv = reviews[i]
  log(`review: ${r.key} ${rv.verdict}, ${rv.findings.length} finding(s), ${rv.cannotVerify.length} cannot-verify`)
  for (const f of rv.findings) {
    // the combined reviewer's findings keep their kind: spec:<id> or quality:<id>
    const g = Object.assign({}, f, { id: `${r.combined ? f.kind : r.key}:${f.id}` })
    const contests = (g.contestsRuling || '').trim()
    const text = `${where(g)} ${g.summary} (reviewer fix: ${g.fix})`
    if (contests) toRule.push({ id: g.id, kind: `finding contesting ruling ${contests}`, severity: g.severity, text, finding: g, contests })
    else if (CONTROLLER.has(g.id)) toRule.push({ id: g.id, kind: 'finding with a controller decision', severity: g.severity, text, finding: g })
    else if (g.severity === 'minor') state.deferredMinors.push(`${g.id} ${where(g)} ${g.summary}`)
    else if (g.planMandated) toRule.push({ id: g.id, kind: 'plan-mandated finding', severity: g.severity, text, finding: g })
    else open.push(g)
  }
  const cvCount = {}
  rv.cannotVerify.forEach((c) => {
    const key = r.combined ? c.kind : r.key
    cvCount[key] = (cvCount[key] || 0) + 1
    cannotVerify.push({ id: `${key}:CV${cvCount[key]}`, kind: 'cannot verify', text: `${c.item} (suggested check: ${c.check})` })
  })
})
for (const f of gate0.findings || []) open.push(f)

// Cannot-verify items: controller decisions settle theirs first; the checker runs the rest.
// verified -> a checker ruling; failed -> an open important finding; needsJudgment or no result -> the ruler.
const gateHead = state.head
// A null checker never reported HEAD and tree after gate-0; a ruler-review call that runs checks them.
let checkerUnprobed = false
if (cannotVerify.length) {
  const pre = applyController(cannotVerify.filter((it) => EARLY_DECIDED.has(it.id)))
  for (const f of pre.fixes) open.push(f)
  const toCheck = cannotVerify.filter((it) => !EARLY_DECIDED.has(it.id))
  if (toCheck.length) {
    phase('Check')
    log(`check: ${toCheck.length} cannot-verify item(s) to the checker (${tier('checker')})`)
    let ck = await runChecker(toCheck, reviewHead, gateHead, '', 'checker')
    let bad = postGateProblem(ck, gateHead)
    // A null checker takes only answers addressed to it (precondition:checker); a plain
    // precondition answer is left for the stop it was meant for.
    const forChecker = ANSWERS ? ANSWERS.entries.some((e) => e.preLabel === 'checker' && !e.usedPre) : false
    const ans = bad || (!ck && forChecker) ? preconditionAnswers('checker') : ''
    if (ans) {
      log(`check: cached checker ${bad ? `left the repository changed (${bad})` : 'returned null'}; retrying with the controller answer`)
      ck = await runChecker(toCheck, reviewHead, gateHead, ans, 'checker-retry')
      bad = postGateProblem(ck, gateHead)
    }
    if (bad) {
      log(`check: precondition failed after gate-0: ${bad}; stopping, no check result applied`)
      return await finish(build('stopped', { stopped: 'precondition', stopPoint: 'precondition:checker', problem: `checker: ${bad}` }))
    }
    if (ck && forChecker && ANSWERS) {
      // the checker ran fresh and clean: a pending precondition:checker answer is no longer needed
      for (const e of ANSWERS.entries) if (e.preLabel === 'checker' && !e.usedPre) { e.usedPre = true; e.delivered = true }
      log('check: checker returned a clean result; the pending precondition:checker answer is consumed')
    }
    if (!ck) {
      checkerUnprobed = true
      log('check: checker returned null (skipped or died); every item goes to the ruler')
    }
    const byId = new Map(((ck && ck.results) || []).map((x) => [x.id.replace(/^\[|\]$/g, '').trim(), x]))
    for (const it of toCheck) {
      const x = byId.get(it.id)
      if (CONTROLLER.has(it.id)) {
        // a decision given after the check (e.g. at ruler-review) overrides the checker's result
        toRule.push(Object.assign({}, it, { text: `${it.text} (checker: ${x ? x.result : 'no result'})` }))
      } else if (x && x.result === 'verified') {
        setRuling({ item: it.id, what: it.text.slice(0, 160), decision: 'verified', reason: x.evidence, costIfWrong: 'checker verified; a wrong check hides an unmet requirement', fixInstruction: '', command: x.evidence, source: 'checker' })
      } else if (x && x.result === 'failed') {
        open.push({ id: it.id, severity: 'important', file: '', line: '', summary: `check failed: ${it.text}: ${x.evidence}`, fix: 'make the failed check pass', planMandated: false, contestsRuling: '' })
      } else {
        toRule.push(Object.assign({}, it, { text: `${it.text} (checker: ${x ? `needs judgment: ${x.evidence}` : 'no result'})` }))
      }
    }
    log(`check: ${toCheck.map((it) => `${it.id} ${byId.has(it.id) ? byId.get(it.id).result : 'no result'}`).join(', ')}`)
  }
}

// ================= 3. Ruler =================
if (toRule.length) {
  phase('Rule')
  const ruled = await runRuler(toRule, 'ruler-review', reviewHead, 4, gateHead)
  if (ruled.precondition) {
    return await finish(build('stopped', { stopped: 'precondition', stopPoint: 'precondition:ruler-review', problem: ruled.precondition }))
  }
  state.parked.push(...ruled.unruled)
  if (ruled.escalated.length) {
    log(`rule: ${ruled.escalated.length} escalation(s); stopping`)
    return await finish(build('stopped', { stopped: 'ruler-review', escalated: ruled.escalated, open }))
  }
  for (const f of ruled.fixes) open.push(f)
  if (ruled.probed) checkerUnprobed = false
} else {
  log('rule: nothing for the ruler after review')
}

// ================= 4. Fix loop and gate =================
const naCount = {}
let roundBase = state.head
let gatePassed = false
// A clean review plus a green gate-0 completes with no further gate (gate-0 red opens findings),
// unless a null checker left the tree unchecked and no ruler checked it since (fixers and gates
// check it, so this only matters when nothing is open).
if (!open.length && checkerUnprobed) {
  log('check: checker returned null and no later agent checked HEAD and tree after gate-0; stopping')
  return await finish(build('stopped', { stopped: 'precondition', stopPoint: 'precondition:checker', problem: 'checker: returned no result, and no later agent checked HEAD and tree after gate-0; confirm HEAD is the gate-0 head and the tree is clean, then answer at precondition:checker to re-run the checker once' }))
}
if (!open.length) {
  gatePassed = true
  log('gate: review clean and gate-0 green; no further gate')
}
while (!gatePassed) {
  while (open.length && state.rounds < MAX_ROUNDS) {
    phase('Fix')
    state.rounds++
    const r = state.rounds
    const repeated = open.filter((f) => (naCount[f.id] || 0) >= 2).map((f) => f.id)
    const escalate = r >= 4 || repeated.length > 0
    const roleName = escalate ? 'escalatedFixer' : 'fixer'
    log(`fix: round ${r}/${MAX_ROUNDS}, ${open.length} open (${open.map((f) => f.id).join(', ')}); fixer ${tier(roleName)}${repeated.length ? `; escalated for repeated ${repeated.join(', ')}` : r >= 4 ? '; escalated for round >= 4' : ''}`)

    const fx = await runFixer(open, `fixer-r${r}`, roleName, `round ${r}`, r)
    if (!fx || fx.status === 'BLOCKED' || fx.status === 'NEEDS_CONTEXT') {
      if (fx) { state.questions.push(...fx.questions); state.concerns.push(...fx.concerns) }
      state.roundLog.push(`fix round ${r}/${MAX_ROUNDS} (fixer ${fx ? fx.status : 'returned null'})`)
      log(`fix: round ${r} fixer ${fx ? fx.status : 'returned null'}; stopping`)
      state.parked.push(...open)
      return await finish(build('stopped', { stopped: `fixer-r${r}` }))
    }
    state.concerns.push(...fx.concerns.filter((c) => c.kind !== 'observation'))
    for (const c of fx.concerns.filter((c) => c.kind === 'observation')) state.deferredMinors.push(`fixer r${r} observation: ${c.text}`)

    // Only an explicit controller ruling waives the new-commits check; a re-reviewer ADDRESSED on an
    // empty diff never does, so a fixer that fails to commit is still caught.
    const noCode = !!ANSWERS && ANSWERS.entries.some((e) => e.noCode && e.at === `fixer-r${r}`)
    if (noCode) log(`fix: round ${r}: controller answered noCode; progress-r${r} waives the new-commits check`)
    const pc = await runProgress(`progress-r${r}`, roundBase, lastTests, noCode)
    const progressProblems = []
    const guardHits = []
    if (pc) {
      state.commits.push(...pc.newCommits)
      if (pc.testCount >= 0) lastTests = `${pc.testCount} passing`
      if (!pc.ok) progressProblems.push(...pc.problems)
      guardHits.push(...pc.guardHits)
    } else {
      state.commits.push(...fx.commits)
      progressProblems.push('progress checker returned no result; round unchecked')
    }
    state.head = await verifyHead(pc ? pc.head : fx.head, `verify-head-r${r}`)

    // Mechanical round: every open finding came from a gate or the progress checker. The progress
    // checker and gate-r<r> decide; the re-reviewer is skipped.
    const mechanical = open.every((f) => /^(gate-|progress-)/.test(f.id) && !f.guard)
    const next = []
    log(mechanical
      ? `fix: round ${r} is mechanical (gate and progress findings only); re-reviewer skipped, progress checker and gate-r${r} decide`
      : `fix: round ${r} has review findings; re-reviewer runs`)
    // Gate findings are never verdicted by a re-reviewer; they stay open until a gate runs.
    const gateOpen = open.filter((f) => /^gate-/.test(f.id))
    const reviewed = open.filter((f) => !/^gate-/.test(f.id))
    const rr = mechanical ? null : await runReReview(reviewed, gateOpen, `re-review-r${r}`, roundBase, state.head, r)
    if (mechanical) {
      // closed unless the progress checker reports a problem (below); gate-r<r> checks the rest
    } else if (!rr) {
      log(`fix: round ${r} re-reviewer returned null; every finding stays open`)
      for (const f of reviewed) { naCount[f.id] = (naCount[f.id] || 0) + 1; next.push(f) }
    } else {
      const v = new Map(rr.verdicts.map((x) => [x.id.replace(/^\[|\]$/g, '').trim(), x]))
      for (const f of reviewed) {
        const x = v.get(f.id)
        if (x && x.verdict === 'ADDRESSED') continue
        naCount[f.id] = (naCount[f.id] || 0) + 1
        next.push(Object.assign({}, f, { lastVerdict: x ? `r${r} NOT ADDRESSED (${naCount[f.id]}x): ${x.evidence}` : `r${r}: no verdict (${naCount[f.id]}x)` }))
      }
      rr.newFindings.forEach((f, k) => {
        const g = Object.assign({}, f, { id: `r${r}:${f.id || 'N' + (k + 1)}` })
        if ((g.contestsRuling || '').trim()) {
          log(`fix: ${g.id} contests ruling ${g.contestsRuling}; parked for the controller, not sent to the fixer`)
          state.parked.push(g)
        } else if (g.severity === 'minor') state.deferredMinors.push(`${g.id} ${where(g)} ${g.summary}`)
        else next.push(g)
      })
      for (const o of rr.outOfScope) state.deferredMinors.push(`r${r} out of scope: ${o}`)
    }
    // A gate-weakening hit is a review matter: it makes the next round non-mechanical.
    guardHits.forEach((g, k) => next.push({ id: `progress-r${r}-guard-${k + 1}`, severity: 'important', file: '', line: '', summary: `gate weakening: ${g}`, fix: 'revert the change, or show that the brief or a ruling in force asks for it', planMandated: false, contestsRuling: '', guard: true }))
    if (guardHits.length) log(`fix: round ${r} progress check flagged ${guardHits.length} gate-weakening change(s); the next round gets the re-reviewer`)
    progressProblems.forEach((p, k) => next.push({ id: `progress-r${r}-${k + 1}`, severity: 'important', file: '', line: '', summary: `progress check: ${p}`, fix: 'restore the invariant the progress check names', planMandated: false, contestsRuling: '' }))
    // While anything else is open, the gate findings stay open too (no gate runs yet; never dropped
    // at the cap). When only they would remain, the round closes them and gate-r<r> decides.
    if (next.length && gateOpen.length) next.push(...gateOpen)

    const closed = open.length - open.filter((f) => next.some((n) => n.id === f.id)).length
    state.roundLog.push(`fix round ${r}/${MAX_ROUNDS} (${closed} addressed, ${next.length} open; head ${String(state.head).slice(0, 7)})`)
    log(`fix: round ${r} done: ${closed} addressed, ${next.length} open${progressProblems.length ? `, progress problems: ${progressProblems.join('; ')}` : ''}`)
    open = next
    roundBase = state.head
  }
  if (open.length) break

  // Independent gate after every fix loop that ends clean.
  phase('Gate')
  const gl = `gate-r${state.rounds}`
  const out = await gateOutcome(gl, await runGate(gl, state.head, ''), state.head)
  if (out.stop) return out.stop
  if (out.ok) {
    gatePassed = true
    break
  }
  open = out.findings
  roundBase = state.head
  if (state.rounds >= MAX_ROUNDS) break
}

// ================= 5. Return (ledgerLines for the controller) =================
if (open.length) {
  log(`cap: maxRounds ${MAX_ROUNDS} reached with ${open.length} open finding(s); parked for the controller: ${open.map((f) => f.id).join(', ')}`)
  state.parked.push(...open)
}
if (state.deferredMinors.length) log(`deferred: ${state.deferredMinors.length} minor(s) not fixed in this run, returned as deferredMinors and ledgered`)
if (state.carryForward.length) log(`carry forward: ${state.carryForward.length} obligation(s) for later tasks, returned as carryForward`)
if (state.parked.length || !gatePassed) return await finish(build('parked'))
return await finish(build('complete'))
} catch (e) {
  if (e && e.verifyStop) {
    log(`${e.message}; stopping`)
    return await finish(build('stopped', { stopped: 'precondition', stopPoint: 'precondition:verifyHead', problem: e.verifyStop }))
  }
  if (!e || !e.budgetStop) throw e
  // open findings come back as parked for visibility; a resume recomputes them from cache
  if (open.length) state.parked.push(...open)
  log(`${e.message}; stopping. Answer at "budget" to raise the cap by ${DEFAULT_MAX_AGENTS} and resume from cache`)
  return await finish(build('stopped', { stopped: 'budget', stopPoint: 'budget', problem: `${e.message}; ${agentsUsed} agent(s) ran. Answer { at: "budget", text } to raise the cap by ${DEFAULT_MAX_AGENTS} and resume where it stopped` }))
}
