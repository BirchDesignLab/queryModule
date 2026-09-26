/*
 * wave-review: whole-branch review of one wave PR that touches sensitive paths, one ruled fix
 * pass, one re-review, and the docs/reviews/pr-<n>.md artifact (ADR-0006).
 * Full reference: .claude/workflows/README.md. Test the control flow after any edit:
 * node scripts/sdd/workflow-harness.mjs
 *
 * Invoke: Workflow({ name: "wave-review", args: {
 *   pr: 32, base: "<merge-base sha with main>", head: "<wave branch head sha>",
 *   repoDir: "C:\\git\\queryModule", planPath: "docs/superpowers/plans/2026-09-25-p0-contracts.md",
 *   ledgerPath, workDir,                      // SDD workspace: review, fix report, re-review files
 *   scratchRoot, runLabel: "w4-xhigh",        // agent scratch: <scratchRoot>/<runLabel>/<agent>/
 *   sensitiveFiles: ["packages/core/src/audit/..."], questions: ["..."],
 *   artifactPath: "docs/reviews/pr-32.md",    // optional; must be docs/reviews/pr-<pr>.md
 *   specPath, requirementsDoc,                // optional; defaults below
 *   date: "09-27-26",                         // optional MM-DD-YY for the artifact body
 *   trailer: "Co-Authored-By: ...",           // fallback commit trailer for the fixer
 *   roles: { reviewer: { model: "opus", effort: "xhigh" }, ... },  // optional overrides
 *   answers: [{ at, text?, decisions? }]      // only on a re-run after a stop (below)
 * } })
 * Required: pr, base, head, repoDir, planPath, workDir, scratchRoot, runLabel, trailer.
 * Roles and defaults: reviewer opus/xhigh, ruler opus/high, fixer opus/medium,
 * progressChecker sonnet/low, reReviewer opus/xhigh.
 *
 * Returns { verdict: "approve" | "fixes", reviewedSha, artifactWritten, findings, residual,
 * answers, declined, rulings, supersededRulings, fixCommits?, strayArtifact?, answersUnconsumed?,
 * stopped?, problem?, escalated?, questions? }.
 *   verdict "approve" with artifactWritten: commit the artifact (it records reviewedSha, the
 *     reviewed head, so the artifact commit sits on top) and push.
 *   verdict "approve" without artifactWritten: re-run the review; never hand-write the artifact.
 *   verdict "fixes" without stopped: the single fix pass left residual findings. Adjudicate
 *     them; there is no second fix pass.
 *   stopped set: a controller decision is needed. Each value is a stop point for answers, with
 *   the agent that consumes them:
 *     "reviewer"     the reviewer returned nothing; text goes to the ruler, fixer, re-reviewer.
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
    { title: 'Review', detail: 'whole-branch review against the plan, the spec and the ledger' },
    { title: 'Rule', detail: 'ruler on plan-mandated or contested findings' },
    { title: 'Fix', detail: 'one fixer pass with the complete findings list, then the progress checker' },
    { title: 'Re-review', detail: 'one fresh re-review of the fix diff; writes the artifact on approve' },
  ],
}

// ---------- arguments ----------
const A = args || {}
for (const k of ['pr', 'base', 'head', 'repoDir', 'planPath', 'workDir', 'scratchRoot', 'runLabel', 'trailer']) {
  const v = A[k]
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    throw new Error(`wave-review: required arg "${k}" is missing or empty (see .claude/workflows/README.md)`)
  }
}
const SENSITIVE_FILES = Array.isArray(A.sensitiveFiles) ? A.sensitiveFiles : []
const QUESTIONS = Array.isArray(A.questions) ? A.questions : []
const ARTIFACT = A.artifactPath || `docs/reviews/pr-${A.pr}.md`
if (String(ARTIFACT).replace(/\\/g, '/') !== `docs/reviews/pr-${A.pr}.md`) {
  throw new Error(`wave-review: artifactPath "${ARTIFACT}" must be docs/reviews/pr-${A.pr}.md (the sensitive-review check reads that path)`)
}
const SPEC = A.specPath || 'docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md'
const REQ_DOC = A.requirementsDoc || 'Requirements Definition - Query Module Usability Enhancements.md'
const MAX_LISTED_FILES = 200
let listedFiles = SENSITIVE_FILES
if (SENSITIVE_FILES.length > MAX_LISTED_FILES) {
  listedFiles = SENSITIVE_FILES.slice(0, MAX_LISTED_FILES)
  log(`cap: sensitiveFiles has ${SENSITIVE_FILES.length} entries; the prompt lists the first ${MAX_LISTED_FILES} and tells the reviewer to derive the rest from the sensitive-path globs`)
}

// ---------- answers to stopped runs: a history, one entry per answered stop ----------
// answers: [{ at, text?, decisions? }], appended across re-runs, never replaced; a single object
// is a one-entry list. Positions: reviewer 0 (never gets answers), ruler 2, fixer 3, re-reviewer 5.
// Each entry's text is delivered to exactly one agent: the first consumer at or after its stop
// point that runs, so a later entry never changes an earlier agent's prompt. precondition[:<label>]
// re-runs the failing agent (reviewer or fixer) once. Decisions from all entries apply; a later
// entry wins for the same item.
const STOP_POS = { reviewer: 1, ruler: 2, fixer: 3, 're-review': 5 }
const STOP_POINTS = 'reviewer, precondition (or precondition:<label> from stopPoint), ruler, fixer, re-review'
const PRECONDITION_AT = /^precondition(?::(reviewer|fixer))?$/
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

// ---------- roles ----------
const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULTS = {
  reviewer: { model: 'opus', effort: 'xhigh' },
  ruler: { model: 'opus', effort: 'high' },
  fixer: { model: 'opus', effort: 'medium' },
  progressChecker: { model: 'sonnet', effort: 'low' },
  reReviewer: { model: 'opus', effort: 'xhigh' },
}
const OVR = A.roles || {}

// Returns { model, effort } for agent(); effort omitted for Haiku; throws on a missing model.
function role(name) {
  if (!DEFAULTS[name]) throw new Error(`wave-review: unknown role "${name}"`)
  const r = Object.assign({}, DEFAULTS[name], OVR[name] || {})
  if (!r.model) throw new Error(`wave-review: role "${name}" has no model`)
  if (!MODELS.includes(r.model)) throw new Error(`wave-review: role "${name}" model "${r.model}" is not one of ${MODELS.join(', ')}`)
  if (r.model === 'haiku') return { model: 'haiku' }
  if (!r.effort) throw new Error(`wave-review: role "${name}" (${r.model}) has no effort`)
  if (!EFFORTS.includes(r.effort)) throw new Error(`wave-review: role "${name}" effort "${r.effort}" is invalid`)
  return { model: r.model, effort: r.effort }
}
const tier = (name) => { const r = role(name); return r.effort ? `${r.model}/${r.effort}` : r.model }
// Front-matter reviewer and effort follow the role that writes the artifact (defaults give "opus-5.5" / "xhigh").
const REVIEWER_NAME = { opus: 'opus-5.5', sonnet: 'sonnet-5', haiku: 'haiku-4.5' }
function frontMatter(roleName, sha) {
  const r = role(roleName)
  return ['---', `reviewer: "${REVIEWER_NAME[r.model]}"`, `effort: "${r.effort || 'n/a'}"`, `reviewedSha: "${sha}"`, 'verdict: "approve"', '---'].join('\n')
}

// ---------- paths ----------
const fwd = (p) => String(p).replace(/\\/g, '/')
const join = (...p) => p.map((s, i) => (i === 0 ? fwd(s).replace(/\/+$/, '') : fwd(s).replace(/^\/+|\/+$/g, ''))).join('/')
const REPO = fwd(A.repoDir)
const scratch = (label) => join(A.scratchRoot, A.runLabel, label)
const REVIEW_FILE = join(A.workDir, `${A.runLabel}-review.md`)
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
function artifactRule(roleName, shaWord) {
  return [
    `Write the artifact ${ARTIFACT_ABS} ONLY when your verdict is approve with no open critical or important finding. Do not commit it. It starts with exactly this front matter, with <sha> replaced by the full ${shaWord} sha:`,
    '```',
    frontMatter(roleName, '<sha>'),
    '```',
    `Then a short body: Scope (PR #${A.pr}, range, what the wave delivers), Findings summary (counts by severity, how each critical or important was resolved, each ruling id kept as stands, each controller ruling), Answers to the controller's questions, Remaining Minors. No em dashes. ${DATE_RULE}`,
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

// ================= 1. Whole-branch review =================
phase('Review')
log(`wave-review PR #${A.pr} ${String(A.base).slice(0, 7)}..${String(A.head).slice(0, 7)}; roles: reviewer ${tier('reviewer')}, ruler ${tier('ruler')}, fixer ${tier('fixer')}, progress ${tier('progressChecker')}, re-review ${tier('reReviewer')}`)
// The reviewer prompt never carries answers, so a re-run with answers replays it from cache.
const reviewPrompt = [
  `You are the whole-branch reviewer for wave PR #${A.pr}: every commit in ${A.base}..${A.head}. Review completed work against its plan and requirements and find issues before they merge.`,
  `Plan: ${A.planPath} (the tasks this range delivers). Spec: ${SPEC}. Requirements: "${REQ_DOC}".`,
  'The spec is binding authority: where the plan and the spec disagree, the spec wins unless a ledger Ruling or an ADR in docs/decisions/ says otherwise; say which governs each such finding. For behaviour the spec is silent on, a reasonable user\'s expectation is a requirement, and a spec\'s silence is not permission.',
  A.ledgerPath ? `Ledger: ${A.ledgerPath}. Read every "Ruling:" and "minor (deferred):" line for these tasks. A deferred minor is known, not new; re-raise it only if it is worse than recorded. A finding that disputes a Ruling sets contests to that Ruling line.` : 'No ledger given.',
  SENSITIVE_FILES.length ? `Sensitive files in this range (read each in full, not only its hunks):\n${listedFiles.map((f) => `* ${f}`).join('\n')}` : 'No sensitive-file list given; derive it from the sensitive-path globs in the repo if present.',
  QUESTIONS.length ? `Controller questions (answer each in answers, with file:line evidence):\n${QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : 'No controller questions.',
  '',
  `Precondition, checked first: git rev-parse ${A.head} resolves, ${A.base} is its ancestor (git merge-base --is-ancestor ${A.base} ${A.head}), and git status --porcelain prints nothing. If any fails, set preconditionFailed to what you found, write nothing, report no findings, and stop. It is never a finding. For a dirty tree, name each untracked or modified file from git status --porcelain; an untracked ${ARTIFACT} is a stray artifact from an earlier run, so say "stray artifact ${ARTIFACT}: delete it before re-running".`,
  `Build your view first: mkdir -p "${scratch('reviewer')}" && cd "${REPO}" && { git log --oneline ${A.base}..${A.head}; echo; git diff --stat ${A.base}..${A.head}; echo; git diff -U10 ${A.base}..${A.head}; } > "${scratch('reviewer')}/branch.diff"; then read it. Resolve reviewedSha with git rev-parse ${A.head}.`,
  READONLY,
  'Tests: each task already ran its suite and an independent gate. Run pnpm lint, pnpm typecheck or pnpm test at the head only for a named doubt; record the result.',
  '',
  'Check: plan alignment (all planned functionality present, deviations justified); correctness and edge cases; error handling; type safety; security, CJIS and GDPR exposure in the sensitive files (credentials, audit rows never deleted or rewritten, fail-open paths, real-looking records in fixtures); architecture and integration; tests verify real behaviour; production readiness (migrations, backward compatibility, docs).',
  'Severity: critical = broken behaviour, security or data risk; important = must fix before merge; minor = polish. A defect the plan explicitly mandates is still a finding: important, planMandated true. Every finding cites file:line and says why it matters and how to fix.',
  'Declined to judge: list every behaviour you considered and set aside as outside the plan or spec, one per entry with the reason. The controller rules on each; nothing set aside is dropped silently.',
  `Write your full report to ${REVIEW_FILE}: Strengths, Issues (Critical, Important, Minor), Answers, Declined to judge, Assessment (approve or fixes, with reasoning).`,
  artifactRule('reviewer', 'reviewed head'),
  HOUSE,
  'verdict: approve only with no critical or important finding. preconditionFailed: "" when the precondition holds.',
].join('\n')
let review = await agent(reviewPrompt, { label: 'reviewer', phase: 'Review', schema: REVIEW, ...role('reviewer') })

const reviewPre = review && review.preconditionFailed ? preconditionAnswers('reviewer') : ''
if (reviewPre) {
  log(`review: cached precondition failure (${review.preconditionFailed}); retrying the reviewer with the controller answer`)
  review = await agent(`${reviewPrompt}\n\n${reviewPre}`, { label: 'reviewer-retry', phase: 'Review', schema: REVIEW, ...role('reviewer') })
}
if (!review) {
  log('review: reviewer returned null (skipped or died); stopping')
  return done({ verdict: 'fixes', stopped: 'reviewer', reviewedSha: null, artifactWritten: false, findings: [], residual: [] })
}
if (review.preconditionFailed) {
  log(`review: precondition failed: ${review.preconditionFailed}; stopping before any ruler or fixer`)
  return done({ verdict: 'fixes', stopped: 'precondition', stopPoint: 'precondition:reviewer', problem: `reviewer: ${review.preconditionFailed}`, reviewedSha: review.reviewedSha || null, artifactWritten: false, findings: [], residual: [] })
}
state.answers = review.answers
state.declined = review.declined
const firstBlocking = review.findings.filter(blocking)
log(`review: ${review.verdict}, ${review.findings.length} finding(s) (${firstBlocking.length} critical/important), ${review.answers.length} answer(s), ${review.declined.length} declined, artifact ${review.artifactWritten ? 'written' : 'not written'}`)
if (review.declined.length) log(`review: ${review.declined.length} declined-to-judge item(s) returned for the controller to rule on`)

if (review.verdict === 'approve' && firstBlocking.length === 0) {
  if (!review.artifactWritten) log('review: approve but the artifact was not written; re-run the review, never hand-write it')
  return done({ verdict: 'approve', reviewedSha: review.reviewedSha, artifactWritten: review.artifactWritten, findings: review.findings, residual: review.findings.filter((f) => !blocking(f)) })
}
if (review.verdict === 'approve') log(`review: verdict approve but ${firstBlocking.length} critical/important finding(s); treating as fixes`)
let stray = review.artifactWritten
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
      `You are the ruler for wave PR #${A.pr} (${A.base}..${review.reviewedSha}). The spec (${SPEC}) is binding; the plan is not when it conflicts. ADRs in docs/decisions/ and ledger Rulings${A.ledgerPath ? ` (${A.ledgerPath})` : ''} are in force unless the spec contradicts them.`,
      `The full review is ${REVIEW_FILE}. Read only the spec sections, plan text and files each item needs. ${GIT}`,
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
    `You are fixing the whole-branch review findings of wave PR #${A.pr} at ${review.reviewedSha}. Read the review ${REVIEW_FILE} and the plan ${A.planPath} and spec ${SPEC} sections the findings cite.`,
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
    `Commit only the files you changed (git add <paths>, never git add -A), message "fix: wave review findings for PR #${A.pr}", body listing the finding ids. End the message with the attribution trailer your session's system reminder gives; if none, use:\n${A.trailer}`,
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
      `Check the fix pass on wave PR #${A.pr} in ${REPO}. Fix base: ${review.reviewedSha}. ${GIT}`,
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
    fixHead = pc.head
    state.fixCommits = pc.newCommits
    if (!pc.ok) problems = pc.problems.length ? pc.problems : ['progress checker reported not ok but listed no problem']
  } else {
    fixHead = fx.head
    state.fixCommits = fx.commits
    problems = ['progress checker returned no result; fix pass unchecked']
  }
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
    `You are the fresh re-reviewer for wave PR #${A.pr}. The first review is ${REVIEW_FILE}; its findings are below with any ruling, followed by progress-check findings. ${fixHead === review.reviewedSha ? 'There was no fix diff: confirm each ruled item and the head.' : `A single fix pass produced ${review.reviewedSha}..${fixHead}; the fix report is ${FIX_REPORT}.`}`,
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
    `Write ${REREVIEW_FILE}: Finding Verdicts, Accepted stands, New Breakage, Verdict.`,
    `reviewedSha: git rev-parse ${fixHead} (full).`,
    artifactRule('reReviewer', 'reviewed head (the fix head)'),
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

return done({
  verdict,
  reviewedSha: rr.reviewedSha,
  artifactWritten: rr.artifactWritten && verdict === 'approve',
  findings: review.findings,
  residual,
  fixCommits: state.fixCommits,
  strayArtifact: stray ? ARTIFACT : undefined,
})
