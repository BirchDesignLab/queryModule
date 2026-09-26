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
 *   ledgerPath,                              // optional; ledger lines are appended at the end
 *   sensitive: false, ui: false,
 *   ids: "BR-001, FR-032", specRefs: "spec 4.1 lines 140-260; ...",
 *   requirementsDoc,                         // optional; default the repo-root Requirements Definition
 *   globalConstraints: "<product and code constraints>",   // required, non-empty; see below
 *   carries: "<rulings, interfaces>",        // never edit between re-runs of one task
 *   trailer: "Co-Authored-By: ...",          // fallback commit trailer
 *   roles: { implementer: { model: "opus", effort: "medium" }, ... },   // optional overrides
 *   maxRounds: 5,                            // fix-round cap; numeric strings and floats are
 *                                            // coerced (logged), then clamped to 1..8
 *   answers: [{ at, text?, decisions? }]     // only on a re-run after a stop (below)
 * } })
 * Required: task, title, repoDir, branch, base, briefPath, reportPath, workDir, scratchRoot,
 * runLabel, specRefs, globalConstraints, trailer. A missing one throws before any agent runs.
 * globalConstraints carries product and code constraints only (runtime, TDD, purity, fixtures,
 * logging, docs style). Never process bullets (model and effort plan, PR and push steps, commit
 * trailers, branch naming): every agent treats globalConstraints as binding.
 * Roles: implementer, specReviewer, qualityReviewer, critic, ruler, fixer, escalatedFixer,
 * progressChecker, reReviewer, gate, ledger (Haiku, model only).
 *
 * Returns { task, status, base, head, commits, rounds, rulings (in force, one per item, each
 * with source "ruler" | "controller"), supersededRulings, carryForward, deferredMinors, parked,
 * questions, concerns, answersUnconsumed?, ledgerLines? } and, when status is "stopped", also
 * stopped (a stop point, with the agent that consumes answers there):
 *   "implementer"     -> implementer-continue finishes on top of the existing commits
 *   "precondition"    -> (problem says what: branch, HEAD, dirty tree with the files named; stopPoint
 *                        is precondition:<label>) fix the repo; the failing agent re-runs once as
 *                        implementer-retry or gate-...-retry
 *   "ruler-concerns"  -> ruler-concerns        "fixer-pre" -> fixer-pre
 *   "review"          -> ruler-review, then the fixers (a reviewer returned nothing)
 *   "ruler-review"    -> ruler-review          "fixer-r<r>" -> fixer-r<r>
 *   "gate-0" | "gate-r<r>" -> fixer-r1 | fixer-r<r+1> (the gate returned nothing)
 * plus escalated: [ruling] when a ruler escalated, and problem on a precondition stop.
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
 * A single object is a one-entry list. Every entry's at is validated; an unknown one throws.
 * Each entry's text goes to exactly one agent (the first consumer at or after its stop point that
 * runs), so earlier calls, including an earlier stop's continue or retry agent, replay from cache.
 * decisions from all entries become controller rulings (a later entry wins for the same item):
 * final for the run, never re-escalated (a controller stands on a Critical stands); fix goes to
 * the fixer with its fixInstruction. Null or failed replays: .claude/workflows/README.md fallbacks.
 *   Workflow({ scriptPath: ".claude/workflows/sdd-task.js", args: <same args + answers>,
 *              resumeFromRunId: "<runId>" })
 * Resume after a pause, kill or script edit: the same call without new answers.
 * This script never pushes or merges.
 */
export const meta = {
  name: 'sdd-task',
  description: 'Implement one plan task with TDD, review it (spec, quality, critic), rule, fix and gate it to a clean head',
  whenToUse: 'Running one task of an implementation plan on a wave branch in place of hand-dispatched subagent-driven development',
  phases: [
    { title: 'Implement', detail: 'implementer builds the task from its brief with TDD and commits' },
    { title: 'Rule', detail: 'ruler decides implementer concerns, plan-mandated or contested findings and cannot-verify items' },
    { title: 'Review', detail: 'spec reviewer, quality reviewer and (sensitive or UI) critic in parallel' },
    { title: 'Fix', detail: 'fixer, progress checker and re-reviewer per round, up to maxRounds' },
    { title: 'Gate', detail: 'independent lint, typecheck, test, head and clean-tree check' },
    { title: 'Ledger', detail: 'append the task lines to the SDD ledger' },
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
const SENSITIVE = !!A.sensitive
const UI = !!A.ui
const REQ_DOC = A.requirementsDoc || 'Requirements Definition - Query Module Usability Enhancements.md'

let MAX_ROUNDS = 5
if (A.maxRounds !== undefined && A.maxRounds !== null) {
  const raw = A.maxRounds
  const n = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : Number.NaN
  if (!Number.isFinite(n)) {
    log(`cap: maxRounds ${JSON.stringify(raw)} is not a number; using 5`)
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

// Answers to stopped runs: a history, one entry per answered stop, appended across re-runs and
// never replaced. Every stopped value is a stop point with a named consumer:
//   implementer   -> implementer-continue          precondition[:<label>] -> <label>-retry, once
//   ruler-concerns -> ruler-concerns               fixer-pre    -> fixer-pre
//   review        -> ruler-review (else a fixer)   ruler-review -> ruler-review
//   fixer-r<r>    -> fixer-r<r>                    gate-0 / gate-r<r> -> fixer-r1 / fixer-r<r+1>
// Each entry's text is delivered to exactly one agent: the first consumer at or after its stop
// point that runs. So an agent's prompt holds only the entries for its own stop point, and a
// later entry never changes an earlier agent's prompt (earlier calls replay from cache).
// Decisions from all entries become controller rulings; a later entry wins for the same item.
const STOP_POINTS = 'implementer, precondition (or precondition:<label> from stopPoint), ruler-concerns, fixer-pre, review, ruler-review, fixer-r<r>, gate-0, gate-r<r>'
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
const PRECONDITION_AT = /^precondition(?::(implementer|gate-0|gate-r[1-9]\d*))?$/
let ANSWERS = null
const CONTROLLER = new Map()
if (A.answers !== undefined && A.answers !== null) {
  const list = Array.isArray(A.answers) ? A.answers : [A.answers] // a single object is a one-entry list
  if (!list.length) throw new Error('sdd-task: answers is an empty list')
  const entries = list.map((e, i) => {
    const at = String((e && e.at) || '')
    const pre = PRECONDITION_AT.exec(at)
    if (!pre && stopPos(at) < 0) {
      throw new Error(`sdd-task: answers[${i}].at "${at}" is not a stop point; use the returned stopped value: ${STOP_POINTS}`)
    }
    const text = typeof e.text === 'string' ? e.text.trim() : ''
    const decisions = Array.isArray(e.decisions) ? e.decisions : []
    if (!text && !decisions.length) throw new Error(`sdd-task: answers[${i}] needs text or decisions (or both)`)
    for (const d of decisions) {
      if (!d || typeof d.item !== 'string' || !['fix', 'stands', 'verified'].includes(d.decision) || typeof d.reason !== 'string') {
        throw new Error(`sdd-task: answers[${i}].decisions entry ${JSON.stringify(d)} needs item, decision (fix | stands | verified) and reason`)
      }
      CONTROLLER.set(d.item, { decision: d.decision, reason: d.reason, fixInstruction: d.fixInstruction || '' }) // later entry wins
    }
    return { index: i, at, pos: pre ? -1 : stopPos(at), preLabel: pre ? pre[1] || '' : null, text, delivered: !text }
  })
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

// ---------- roles ----------
const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULTS = SENSITIVE
  ? {
      implementer: { model: 'opus', effort: 'medium' },
      specReviewer: { model: 'sonnet', effort: 'medium' },
      qualityReviewer: { model: 'sonnet', effort: 'high' },
      critic: { model: 'opus', effort: 'medium' },
      ruler: { model: 'opus', effort: 'medium' },
      progressChecker: { model: 'sonnet', effort: 'low' },
      reReviewer: { model: 'opus', effort: 'medium' },
      gate: { model: 'sonnet', effort: 'low' },
      ledger: { model: 'haiku' },
    }
  : {
      implementer: { model: 'sonnet', effort: 'medium' },
      specReviewer: { model: 'sonnet', effort: 'medium' },
      qualityReviewer: { model: 'sonnet', effort: 'high' },
      critic: { model: 'opus', effort: 'medium' },
      ruler: { model: 'opus', effort: 'low' },
      progressChecker: { model: 'sonnet', effort: 'low' },
      reReviewer: { model: 'sonnet', effort: 'medium' },
      gate: { model: 'sonnet', effort: 'low' },
      ledger: { model: 'haiku' },
    }
const OVR = A.roles || {}

function stepUp(r) {
  const key = `${r.model}/${r.effort || ''}`
  const LADDER = {
    'haiku/': { model: 'sonnet', effort: 'medium' },
    'sonnet/low': { model: 'sonnet', effort: 'medium' },
    'sonnet/medium': { model: 'sonnet', effort: 'high' },
    'sonnet/high': { model: 'opus', effort: 'medium' },
    'sonnet/xhigh': { model: 'opus', effort: 'medium' },
    'opus/low': { model: 'opus', effort: 'medium' },
    'opus/medium': { model: 'opus', effort: 'high' },
    'opus/high': { model: 'opus', effort: 'xhigh' },
  }
  return LADDER[key] || { model: r.model, effort: r.effort }
}

function resolve(name) {
  if (name === 'fixer') return Object.assign({}, resolve('implementer'), OVR.fixer || {})
  if (name === 'escalatedFixer') {
    const base = SENSITIVE ? { model: 'opus', effort: 'high' } : stepUp(resolve('fixer'))
    return Object.assign({}, base, OVR.escalatedFixer || {})
  }
  if (!DEFAULTS[name]) throw new Error(`sdd-task: unknown role "${name}"`)
  return Object.assign({}, DEFAULTS[name], OVR[name] || {})
}

// Returns { model, effort } for agent(); effort omitted for Haiku; throws on a missing model.
function role(name) {
  const r = resolve(name)
  if (!r.model) throw new Error(`sdd-task: role "${name}" has no model`)
  if (!MODELS.includes(r.model)) throw new Error(`sdd-task: role "${name}" model "${r.model}" is not one of ${MODELS.join(', ')}`)
  if (r.model === 'haiku') return { model: 'haiku' }
  if (!r.effort) throw new Error(`sdd-task: role "${name}" (${r.model}) has no effort`)
  if (!EFFORTS.includes(r.effort)) throw new Error(`sdd-task: role "${name}" effort "${r.effort}" is invalid`)
  return { model: r.model, effort: r.effort }
}
const tier = (name) => { const r = role(name); return r.effort ? `${r.model}/${r.effort}` : r.model }

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
const PROGRESS = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    head: { type: 'string', description: 'full sha from git rev-parse HEAD' },
    newCommits: COMMITS,
    testCount: { type: 'integer', description: 'passing tests in the full run; -1 if the run failed' },
  },
  required: ['ok', 'problems', 'head', 'newCommits', 'testCount'],
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
const LEDGER = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, linesAppended: { type: 'integer' } },
  required: ['ok', 'linesAppended'],
}

// ---------- shared prompt pieces ----------
const GIT = `Shell: Git Bash. Run every git and shell command in ${REPO} (cd there, or use git -C "${REPO}"). Branch: ${A.branch}.`
const HOUSE = [
  'Rules:',
  '- Never dispatch subagents. Do all of this work yourself.',
  '- Finish every command before you reply; leave nothing running in the background.',
  '- No filesystem-wide searches: read the files named here and the files they lead you to.',
  '- Do not push, open a PR or merge.',
].join('\n')
const READONLY = 'Your review is read-only on this checkout: do not change the working tree, the index, HEAD or any branch. Write only your review file and your scratch directory.'
const TRAILER = `End every commit message with the attribution trailer your session's system reminder gives; if it gives none, use:\n${A.trailer}`
const SENSITIVE_RULE = 'This task is sensitive. On sensitive tasks the ruler must escalate any ruling that would: (a) weaken a security, audit, credential, delegation or dispatch invariant; (b) change a shape frozen at a phase gate or listed as a contract file (master plan 8.2); (c) keep a Critical finding with stands. Everything else it rules.'

function diffStep(base, head, out) {
  return [
    `First build your diff file (Git Bash), then read it once. It is your view of the change:`,
    '```bash',
    `mkdir -p "${out.replace(/\/[^/]+$/, '')}"`,
    `cd "${REPO}" && { echo "## Commits"; git log --oneline ${base}..${head}; echo; echo "## Files changed"; git diff --stat ${base}..${head}; echo; echo "## Diff"; git diff -U10 ${base}..${head}; } > "${out}"`,
    '```',
    'Read a changed file separately only when a hunk you must judge is cut off; say so. Inspect code outside the diff only for a concrete risk you can name, one focused check per risk, and name both in your review.',
  ].join('\n')
}

const TESTS_RULE = 'The implementer already ran the tests and put the evidence in the report. Do not re-run the suite (an independent gate runs lint, typecheck and tests after review). Run a focused test only for a specific doubt no existing run answers. Warnings or noise in reported test output are findings. Missing or garbled evidence is a gap to report, not a reason to re-run.'
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
    ...list.map((r) => `* [${r.item}] ${r.decision}${r.source === 'controller' ? ' (controller)' : ''}: ${r.reason}`),
  ].join('\n')
}

// ---------- ledger + return ----------
// Ledger Ruling line format: "- Task N: Ruling: <what> {U+2014} <decision>: <why> {U+2014} <cost if wrong>".
function ledgerLines(result) {
  const out = []
  const b7 = String(A.base).slice(0, 7)
  const h7 = String(result.head || A.base).slice(0, 7)
  for (const r of inForce()) out.push(`- Task ${N}: Ruling${r.source === 'controller' ? ' (controller)' : ''}: ${r.what} \u2014 ${r.decision}: ${r.reason} \u2014 ${r.costIfWrong}`)
  for (const s of state.superseded) out.push(`- Task ${N}: Ruling superseded: ${s.item} (${s.old.decision}) by ${s.new.item} (${s.new.decision}${s.new.source === 'controller' ? ', controller' : ''}): ${s.new.reason}`)
  for (const c of state.carryForward) out.push(`- Task ${N}: carry forward: ${c}`)
  for (const l of state.roundLog) out.push(`- Task ${N}: ${l}`)
  for (const m of state.deferredMinors) out.push(`- Task ${N}: minor (deferred): ${m}`)
  if (result.status === 'complete') out.push(`- Task ${N}: complete (commits ${b7}..${h7}, review clean, gate green)`)
  else if (result.status === 'parked') out.push(`- Task ${N}: complete (commits ${b7}..${h7}, ${result.parked.length} parked)`)
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
  if (A.ledgerPath) {
    phase('Ledger')
    const lines = ledgerLines(result)
    const res = await agent(
      [
        `Append these ${lines.length} lines, exactly as written, after the last line of ${A.ledgerPath}.`,
        'Use the Edit tool to append only. Never use Write on this file, never rewrite or reorder existing lines, and keep the final newline. Do not run git.',
        '',
        '<lines>',
        ...lines,
        '</lines>',
        '',
        'Return ok: true and the number of lines appended.',
      ].join('\n'),
      { label: 'ledger', phase: 'Ledger', schema: LEDGER, ...role('ledger') },
    )
    if (!res || !res.ok) log(`ledger: append to ${A.ledgerPath} failed; the lines are in the return value (ledgerLines)`)
    result.ledgerLines = lines
  } else {
    log('ledger: no ledgerPath, skipped')
  }
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
    },
    extra || {},
  )
}

// ---------- ruler ----------
// items: [{ id, kind, text, severity?, finding?, contests? }]. Controller decisions settle their items
// first; the rest go to the ruler. Returns { fixes:[finding], escalated:[ruling], unruled:[item] }.
async function runRuler(allItems, label, headNow, pos) {
  const pre = applyController(allItems)
  const items = pre.rest
  if (!items.length) {
    log(`rule: every item settled by controller decisions; no ${label} call`)
    return { fixes: pre.fixes, escalated: [], unruled: [] }
  }
  log(`rule: ${items.length} item(s) to the ruler (${tier('ruler')})`)
  const res = await agent(
    [
      `You are the ruler for Task ${N}: ${A.title}. Rule on each item below. The spec is binding; the plan is not when it conflicts with the spec.`,
      `Read only what you need: the brief ${A.briefPath}, the implementer report ${A.reportPath}, the spec sections ${A.specRefs}, the requirements doc "${REQ_DOC}" for IDs ${A.ids || '(none given)'}, and the specific files an item names. Review files for this task are in ${A.workDir} (task-${N}-review-*.md).`,
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
      SENSITIVE ? SENSITIVE_RULE : '',
      'costIfWrong: one line, what it costs if your ruling is wrong. carryForward: obligations a later task must meet because of your ruling (e.g. "Task 8 must show tsc -b exit 0"); omit when none.',
      'You are read-only: do not edit, commit or change any git state. Scratch, if needed: ' + scratch(label),
      HOUSE,
      'Return one ruling per item, with item set to the id exactly as given.',
    ].filter(Boolean).join('\n'),
    { label, phase: 'Rule', schema: RULINGS, ...role('ruler') },
  )
  const byId = new Map()
  for (const r of (res && res.rulings) || []) byId.set(r.item.replace(/^\[|\]$/g, '').trim(), r)
  const fixes = pre.fixes.slice(), escalated = [], unruled = []
  for (const it of items) {
    let r = byId.get(it.id)
    if (!r) { unruled.push(it); continue }
    // Rule (c) never touches a controller decision: those items were settled above and never reach here.
    if (SENSITIVE && it.severity === 'critical' && (r.decision === 'stands' || r.decision === 'verified')) {
      log(`rule: ${it.id} is critical on a sensitive task and was ruled ${r.decision}; escalated by rule (c); answer with answers.decisions to settle it`)
      r = Object.assign({}, r, { decision: 'escalate', reason: `ruled ${r.decision} on a critical finding (sensitive rule c): ${r.reason}` })
    }
    setRuling({ item: it.id, what: it.text.slice(0, 160), decision: r.decision, reason: r.reason, costIfWrong: r.costIfWrong, fixInstruction: r.fixInstruction || '', command: r.command || '', source: 'ruler' }, it.contests)
    for (const c of r.carryForward || []) state.carryForward.push(c)
    if (r.decision === 'escalate') escalated.push(Object.assign({ text: it.text }, r))
    if (r.decision === 'fix') fixes.push(fixFrom(Object.assign({}, it, { finding: it.finding || { severity: it.severity } }), r.fixInstruction || r.reason))
  }
  if (!res) log('rule: ruler returned null (skipped or died); every item is unruled')
  if (unruled.length) log(`rule: ${unruled.length} item(s) got no ruling and are parked: ${unruled.map((u) => u.id).join(', ')}`)
  return { fixes, escalated, unruled }
}

// ---------- fixer, progress checker, re-reviewer, gate ----------
async function runFixer(findings, label, roleName, roundTag, round) {
  return agent(
    [
      `You are fixing review findings on Task ${N}: ${A.title} (${roundTag}). You are a fresh agent: read the brief ${A.briefPath} (your requirements, exact values), the implementer report ${A.reportPath}, and the review files in ${A.workDir} (task-${N}-review-*.md, task-${N}-re-review-*.md) as you need them.`,
      A.carries ? `Controller rulings and interfaces in force:\n${A.carries}` : '',
      `Global constraints (binding):\n${A.globalConstraints}`,
      rulingsText(),
      'Never reverse a ruling. If a finding cannot be fixed without reversing one, leave it and say so in concerns (kind planVsSpec).',
      answersFor(label.startsWith('fixer-r') ? 10 + 2 * round : 2),
      '',
      'Findings to fix (all of them; a ruler fixInstruction is the change to make):',
      findingsText(findings),
      '',
      'TDD: for each behavioural finding, first write or tighten a test that fails for the defect, run it and see it fail, then fix, then see it pass. Run the tests that cover the amended code, then the full suite once before committing. A gate finding (lint, typecheck, test, head, tree) is fixed at its cause.',
      `Append a "## Fix ${roundTag}" section to ${A.reportPath}: per finding id, what you changed (file:line), the covering tests, the commands and their output (RED and GREEN).`,
      `Commit only the files these fixes touch (git add <paths>, never git add -A) with a message "fix(task-${N}): ${roundTag} review findings" and a body listing the finding ids. ${TRAILER}`,
      GIT,
      HOUSE,
      'If you cannot fix a finding, say which and why in concerns (kind correctness) and use DONE_WITH_CONCERNS; use BLOCKED or NEEDS_CONTEXT with questions only when you cannot proceed at all.',
    ].filter(Boolean).join('\n'),
    { label, phase: 'Fix', schema: WORK, ...role(roleName) },
  )
}

async function runProgress(label, roundBase, priorTests) {
  return agent(
    [
      `Check a fix round on Task ${N} in ${REPO}. Round base: ${roundBase}. ${GIT}`,
      'Checks (report each failure as one line in problems; ok is true only with no problems):',
      `1. New commits exist: git log --oneline ${roundBase}..HEAD is not empty. List them in newCommits (full sha, subject).`,
      '2. Working tree clean: git status --porcelain prints nothing.',
      `3. No test was skipped or focused: git diff ${roundBase}..HEAD adds no .skip( / .only( / it.skip / describe.only / test.todo (grep the + lines).`,
      `4. No test file deleted or emptied: git diff --diff-filter=D --name-only ${roundBase}..HEAD and git diff --numstat ${roundBase}..HEAD show no *.test.* or *.spec.* file deleted or left with no content.`,
      `5. Test count not lower: run pnpm test once (full suite). Report the passing count as testCount (-1 if the run failed). Prior evidence: ${priorTests}. Lower than that, or any failure, is a problem.`,
      'head: git rev-parse HEAD (full sha).',
      'You are read-only: change nothing, commit nothing. Scratch, if needed: ' + scratch(label),
      HOUSE,
    ].join('\n'),
    { label, phase: 'Fix', schema: PROGRESS, ...role('progressChecker') },
  )
}

async function runReReview(findings, label, roundBase, headNow, r) {
  const out = wjoin(`task-${N}-re-review-${r}.md`)
  return agent(
    [
      `You are re-reviewing fix round ${r} of Task ${N}: ${A.title}. A review produced the findings below; a fixer attempted them. Verdict each finding and inspect the fix diff, nothing else.`,
      `Brief: ${A.briefPath}. Fix report: the "Fix" sections at the end of ${A.reportPath}.`,
      rulingsText(),
      '',
      'Findings under verification:',
      findingsText(findings),
      '',
      diffStep(roundBase, headNow, join(scratch(label), 'fix.diff')),
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
  return agent(
    [
      `You are the independent gate for Task ${N}: ${A.title}. Trust no earlier report; check the repository yourself. ${GIT}`,
      answerText,
      `Precondition: git branch --show-current is ${A.branch}, and git rev-parse HEAD equals ${expectedHead} (compare full shas; a short sha is a prefix match). If not, set preconditionFailed to what you found, ok false, and run nothing else.`,
      'Checks (one line per failure in problems; ok is true only with no problems):',
      '1. (precondition above)',
      '2. git status --porcelain prints nothing.',
      '3. pnpm lint exits 0.',
      '4. pnpm typecheck exits 0.',
      '5. pnpm test exits 0.',
      `Run each command once, in that order, saving its full output under ${scratch(label)}. For a failure, put the command and its first error lines in problems (file paths, rule names and messages only; never field values or payloads).`,
      'head: git rev-parse HEAD (full sha).',
      'You are read-only: change nothing, commit nothing.',
      HOUSE,
    ].filter(Boolean).join('\n'),
    { label, phase: 'Gate', schema: GATE, ...role('gate') },
  )
}

// ================= 1. Implement =================
phase('Implement')
log(`task ${N} "${A.title}" on ${A.branch} from ${String(A.base).slice(0, 7)}; ${SENSITIVE ? 'sensitive' : 'ordinary'}${UI ? ', UI' : ''}; maxRounds ${MAX_ROUNDS}`)
log(`roles: implementer ${tier('implementer')}, spec ${tier('specReviewer')}, quality ${tier('qualityReviewer')}, critic ${SENSITIVE || UI ? tier('critic') : 'off'}, ruler ${tier('ruler')}, fixer ${tier('fixer')}, escalated fixer ${tier('escalatedFixer')}, progress ${tier('progressChecker')}, re-review ${tier('reReviewer')}, gate ${tier('gate')}, ledger ${tier('ledger')}`)

// The implementer prompt never carries answers, so a re-run with answers replays it from cache.
const implPrompt = [
    `You are implementing Task ${N}: ${A.title}${A.issue ? ` (issue #${A.issue})` : ''}.`,
    `Read your brief first: ${A.briefPath}. It is your requirements, with exact values; follow its steps, file list and commit message.`,
    A.ids ? `Requirement IDs this task serves: ${A.ids}.` : '',
    A.carries ? `Controller rulings and interfaces the brief cannot know (binding):\n${A.carries}` : '',
    `Global constraints from the plan (binding):\n${A.globalConstraints}`,
    '',
    `Precondition: git branch --show-current is ${A.branch}, git rev-parse HEAD is ${A.base}, and git status --porcelain prints nothing. If any is not so, change nothing, set preconditionFailed to what you found (for a dirty tree, name each untracked or modified file from git status --porcelain), and report BLOCKED.`,
    'Your job: implement exactly what the brief specifies, nothing more. TDD: write the failing test, run it and see it fail for the expected reason, implement, see it pass. While iterating run the focused test; run the full suite once before committing.',
    `Commit only this task's files (git add <paths>, never git add -A) with the brief's commit message. ${TRAILER}`,
    GIT,
    HOUSE,
    '',
    'Stop and report BLOCKED or NEEDS_CONTEXT (with specific questions) when the task needs an architectural decision the brief does not make, when you are unsure your approach is right, or when you keep reading files without progress. Bad work is worse than no work.',
    'Concerns: kind planVsSpec when the brief conflicts with the spec or requirements; kind correctness when you doubt your result is right; kind observation for anything else worth noting. A planVsSpec or correctness concern goes to a ruler before review.',
    '',
    'Before reporting, self-review your diff: completeness against the brief, names, YAGNI, existing patterns, tests that verify behaviour, pristine test output. Fix what you find.',
    `Write your full report to ${A.reportPath}: what you implemented, files changed, TDD evidence (RED: command, failing output, why expected; GREEN: command, passing output), the full-suite result, self-review findings, concerns.`,
    'Return: status, commits (full sha + subject), head (git rev-parse HEAD), a one-line test summary, concerns, questions.',
  ].filter(Boolean).join('\n')
let impl = await agent(implPrompt, { label: 'implementer', phase: 'Implement', schema: WORK, ...role('implementer') })

if (!impl) {
  log('implement: implementer returned null (skipped or died); stopping')
  return await finish(build('stopped', { stopped: 'implementer', questions: ['implementer returned no result'] }))
}

const implPre = impl.preconditionFailed ? preconditionAnswers('implementer') : ''
if (implPre) {
  log(`implement: cached precondition failure (${impl.preconditionFailed}); retrying the implementer with the controller answer`)
  impl = await agent(`${implPrompt}\n\n${implPre}`, { label: 'implementer-retry', phase: 'Implement', schema: WORK, ...role('implementer') })
  if (!impl) return await finish(build('stopped', { stopped: 'implementer', questions: ['implementer retry returned no result'] }))
}
if (impl.preconditionFailed) {
  log(`implement: precondition failed: ${impl.preconditionFailed}; stopping before any change`)
  return await finish(build('stopped', { stopped: 'precondition', stopPoint: 'precondition:implementer', problem: `implementer: ${impl.preconditionFailed}` }))
}

const contAnswers = impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT' ? answersFor(0) : ''
if (contAnswers) {
  log(`implement: cached implementer stopped (${impl.status}); running the continue implementer with the controller answers`)
  const cont = await agent(
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
      'Finish the task exactly as the brief specifies, with TDD (failing test first, seen failing, then green). Run the full suite once before committing.',
      `Commit only this task's files (git add <paths>, never git add -A) with the brief's commit message. ${TRAILER}`,
      `Append a "## Continuation" section to ${A.reportPath} with what you did, TDD evidence and the full-suite result.`,
      GIT,
      HOUSE,
      'Return: status, commits you created (full sha + subject), head, a one-line test summary, concerns, questions. BLOCKED or NEEDS_CONTEXT only when the answers still leave you unable to proceed.',
    ].filter(Boolean).join('\n'),
    { label: 'implementer-continue', phase: 'Implement', schema: WORK, ...role('implementer') },
  )
  if (!cont) {
    log('implement: continue implementer returned null; stopping')
    return await finish(build('stopped', { stopped: 'implementer', questions: ['continue implementer returned no result'] }))
  }
  impl = Object.assign({}, cont, { commits: impl.commits.concat(cont.commits) })
}

state.commits.push(...impl.commits)
state.head = impl.head || A.base
state.questions.push(...impl.questions)
log(`implement: ${impl.status}, ${impl.commits.length} commit(s), head ${String(state.head).slice(0, 7)}, tests: ${impl.testSummary}`)

if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
  state.concerns.push(...impl.concerns)
  return await finish(build('stopped', { stopped: 'implementer' }))
}
if (!impl.commits.length) {
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
      state.head = pc.head
      state.commits.push(...pc.newCommits)
      if (pc.testCount >= 0) lastTests = `${pc.testCount} passing`
      if (!pc.ok) {
        state.preReviewProblems.push(...pc.problems)
        log(`fix: pre-review progress problems (passed to the reviewers): ${pc.problems.join('; ')}`)
      }
    } else {
      state.head = fx.head
      state.commits.push(...fx.commits)
      log('fix: pre-review progress checker returned null; using the fixer-reported head')
    }
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
  'cannotVerify: requirements you cannot verify from the diff alone, each with the check the ruler should run. Do not broaden your search to settle them.',
  HOUSE,
].filter(Boolean).join('\n')

const reviewers = [
  {
    key: 'spec',
    roleName: 'specReviewer',
    prompt: [
      `You are the spec reviewer for Task ${N}: ${A.title}. Task-scoped gate, not a merge review.`,
      common('spec-review'),
      '',
      `Spec compliance only. Compare the diff with the brief and with the spec sections ${A.specRefs}. Requirement IDs: ${A.ids || '(none given)'}; cite each ID verbatim as it appears in "${REQ_DOC}" (read the IDs there), never a paraphrase.`,
      'Report Missing (skipped or claimed without implementing), Extra (unrequested features, over-engineering) and Misunderstood (right feature built wrong). If the brief lists several files each with its own change, check every listed file has its hunk; an untouched listed file is a Missing finding.',
      'Check every fixture and test value in the diff against the fixture policy in the global constraints; a real-looking person, vehicle or property record is a critical finding.',
      'TDD evidence: missing or implausible RED evidence for a behavioural change is an important finding.',
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
      'Code quality only (spec compliance is another reviewer\'s job): separation of concerns, error handling, DRY without premature abstraction, edge cases; tests verify real behaviour and cover the task\'s edge cases; each file has one responsibility and follows the plan\'s file structure; flag new files that are already large or files this change grew a lot.',
      `Write your full review to ${wjoin(`task-${N}-review-quality.md`)}: Strengths, Issues (Critical, Important, Minor) with file:line, why it matters, how to fix; Assessment. No preamble.`,
      'verdict: pass only with no critical or important finding.',
    ].join('\n'),
  },
]
if (SENSITIVE || UI) {
  reviewers.push({
    key: 'critic',
    roleName: 'critic',
    prompt: [
      `You are the critic for Task ${N}: ${A.title}. Read the whole diff adversarially: assume something is wrong and try to find it. Focus: ${SENSITIVE ? 'sensitive-code risk (credential handling, audit logging that can be skipped, rewritten or deleted, query dispatch and correlation, terminal parser, write-back, soft delete, the verify gate; CJIS and GDPR exposure; fail-open paths; secrets or real-looking records in fixtures)' : ''}${SENSITIVE && UI ? '; ' : ''}${UI ? 'UI risk (accessibility, keyboard paths, focus, states the brief names, regressions to existing components, tokens instead of literals)' : ''}.`,
      common('critic'),
      '',
      'Report only real defects with a concrete failure path; say how it fails. Spec gaps you notice go in too, with the spec citation.',
      `Write your full critique to ${wjoin(`task-${N}-review-critic.md`)}: Issues by severity with file:line and failure path, Assessment. No preamble.`,
      'verdict: pass only with no critical or important finding.',
    ].join('\n'),
  })
} else {
  log('review: critic off (task is neither sensitive nor UI)')
}

const reviews = await parallel(reviewers.map((r) => () => agent(r.prompt, { label: `${r.key}-review`, phase: 'Review', schema: REVIEW, ...role(r.roleName) })))
const dead = reviewers.filter((r, i) => !reviews[i]).map((r) => r.key)
if (dead.length) {
  log(`review: ${dead.join(', ')} returned null (skipped or died); stopping, no clean verdict without every reviewer`)
  return await finish(build('stopped', { stopped: 'review', questions: state.questions.concat([`reviewer(s) returned no result: ${dead.join(', ')}; re-run to resume`]) }))
}

let open = []
const toRule = []
const where = (f) => `${f.file}${f.line ? ':' + f.line : ''}`
reviewers.forEach((r, i) => {
  const rv = reviews[i]
  log(`review: ${r.key} ${rv.verdict}, ${rv.findings.length} finding(s), ${rv.cannotVerify.length} cannot-verify`)
  for (const f of rv.findings) {
    const g = Object.assign({}, f, { id: `${r.key}:${f.id}` })
    const contests = (g.contestsRuling || '').trim()
    const text = `${where(g)} ${g.summary} (reviewer fix: ${g.fix})`
    if (contests) toRule.push({ id: g.id, kind: `finding contesting ruling ${contests}`, severity: g.severity, text, finding: g, contests })
    else if (CONTROLLER.has(g.id)) toRule.push({ id: g.id, kind: 'finding with a controller decision', severity: g.severity, text, finding: g })
    else if (g.severity === 'minor') state.deferredMinors.push(`${g.id} ${where(g)} ${g.summary}`)
    else if (g.planMandated) toRule.push({ id: g.id, kind: 'plan-mandated finding', severity: g.severity, text, finding: g })
    else open.push(g)
  }
  rv.cannotVerify.forEach((c, k) => toRule.push({ id: `${r.key}:CV${k + 1}`, kind: 'cannot verify', text: `${c.item} (suggested check: ${c.check})` }))
})

// ================= 3. Ruler =================
if (toRule.length) {
  phase('Rule')
  const ruled = await runRuler(toRule, 'ruler-review', reviewHead, 4)
  state.parked.push(...ruled.unruled)
  if (ruled.escalated.length) {
    log(`rule: ${ruled.escalated.length} escalation(s); stopping`)
    return await finish(build('stopped', { stopped: 'ruler-review', escalated: ruled.escalated, open }))
  }
  for (const f of ruled.fixes) open.push(f)
} else {
  log('rule: nothing for the ruler after review')
}

// ================= 4. Fix loop and gate =================
const naCount = {}
let roundBase = state.head
let gatePassed = false
for (;;) {
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

    const pc = await runProgress(`progress-r${r}`, roundBase, lastTests)
    const progressProblems = []
    if (pc) {
      state.head = pc.head
      state.commits.push(...pc.newCommits)
      if (pc.testCount >= 0) lastTests = `${pc.testCount} passing`
      if (!pc.ok) progressProblems.push(...pc.problems)
    } else {
      state.head = fx.head
      state.commits.push(...fx.commits)
      progressProblems.push('progress checker returned no result; round unchecked')
    }

    const rr = await runReReview(open, `re-review-r${r}`, roundBase, state.head, r)
    const next = []
    if (!rr) {
      log(`fix: round ${r} re-reviewer returned null; every finding stays open`)
      for (const f of open) { naCount[f.id] = (naCount[f.id] || 0) + 1; next.push(f) }
    } else {
      const v = new Map(rr.verdicts.map((x) => [x.id.replace(/^\[|\]$/g, '').trim(), x]))
      for (const f of open) {
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
    progressProblems.forEach((p, k) => next.push({ id: `progress-r${r}-${k + 1}`, severity: 'important', file: '', line: '', summary: `progress check: ${p}`, fix: 'restore the invariant the progress check names', planMandated: false, contestsRuling: '' }))

    const closed = open.length - open.filter((f) => next.some((n) => n.id === f.id)).length
    state.roundLog.push(`fix round ${r}/${MAX_ROUNDS} (${closed} addressed, ${next.length} open; head ${String(state.head).slice(0, 7)})`)
    log(`fix: round ${r} done: ${closed} addressed, ${next.length} open${progressProblems.length ? `, progress problems: ${progressProblems.join('; ')}` : ''}`)
    open = next
    roundBase = state.head
  }
  if (open.length) break

  // Independent gate: after a clean review and after every fix loop that ends clean.
  phase('Gate')
  const gl = state.rounds === 0 ? 'gate-0' : `gate-r${state.rounds}`
  let g = await runGate(gl, state.head, '')
  const gatePre = g && g.preconditionFailed ? preconditionAnswers(gl) : ''
  if (gatePre) {
    log(`gate: cached precondition failure (${g.preconditionFailed}); retrying ${gl} with the controller answer`)
    g = await runGate(`${gl}-retry`, state.head, gatePre)
  }
  if (!g) {
    log(`gate: ${gl} returned null (skipped or died); stopping`)
    return await finish(build('stopped', { stopped: gl, questions: state.questions.concat([`${gl} returned no result; re-run (answers at "${gl}" go to the next fixer round)`]) }))
  }
  if (g.preconditionFailed) {
    log(`gate: ${gl} precondition failed: ${g.preconditionFailed}; stopping, not a finding`)
    return await finish(build('stopped', { stopped: 'precondition', stopPoint: `precondition:${gl}`, problem: `${gl}: ${g.preconditionFailed}` }))
  }
  if (g.head) state.head = g.head
  if (g.ok) {
    gatePassed = true
    log(`gate: ${gl} green at ${String(state.head).slice(0, 7)}`)
    break
  }
  const problems = g.problems.length ? g.problems : ['gate reported not ok but listed no problem; re-check lint, typecheck and test']
  log(`gate: ${gl} red: ${problems.join('; ')}`)
  state.roundLog.push(`${gl} red (${problems.length} problem(s))`)
  open = problems.map((p, k) => ({ id: `${gl}:${k + 1}`, severity: 'important', file: '', line: '', summary: `gate: ${p}`, fix: 'fix the cause so the gate check passes', planMandated: false, contestsRuling: '' }))
  roundBase = state.head
  if (state.rounds >= MAX_ROUNDS) break
}

// ================= 5/6. Ledger and return =================
if (open.length) {
  log(`cap: maxRounds ${MAX_ROUNDS} reached with ${open.length} open finding(s); parked for the controller: ${open.map((f) => f.id).join(', ')}`)
  state.parked.push(...open)
}
if (state.deferredMinors.length) log(`deferred: ${state.deferredMinors.length} minor(s) not fixed in this run, returned as deferredMinors and ledgered`)
if (state.carryForward.length) log(`carry forward: ${state.carryForward.length} obligation(s) for later tasks, returned as carryForward`)
if (state.parked.length || !gatePassed) return await finish(build('parked'))
return await finish(build('complete'))
