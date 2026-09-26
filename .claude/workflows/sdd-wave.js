export const meta = {
  name: 'sdd-wave',
  description: 'Run a wave of plan tasks through sdd-task in order, carrying rulings and carryForward from task to task',
  whenToUse: 'All tasks of one wave on the wave branch, back to back; stops at the first task that does not complete',
  phases: [{ title: 'Wave', detail: 'one nested sdd-task run per task, in order' }],
}

/*
 * sdd-wave: run the tasks of one wave in order, each as a nested sdd-task run (ADR-0006, item 11).
 * Full reference: .claude/workflows/README.md ("sdd-wave"). Test: node scripts/sdd/workflow-harness.mjs
 *
 * Invoke: Workflow({ scriptPath: ".claude/workflows/sdd-wave.js", args: {
 *   wave: "w4", repoDir, branch: "feat/p0-wave-4", base: "<full sha, HEAD before the first task>",
 *   workDir, scratchRoot, ledgerPath?, globalConstraints, trailer, requirementsDoc?, maxRounds?,
 *   roles?: { ... },                         // wave defaults; a task's roles override per role
 *   sddTaskPath?: ".claude/workflows/sdd-task.js",
 *   tasks: [{ task: 17, title, issue?, ids?, specRefs, briefPath, carries?, reportPath?, runLabel?,
 *             sensitive?, ui?, critic?, criticFocus?, roles?, implemented? }, ...],
 *   answers?: { "18": [{ at, text?, decisions? }] },  // per task, only on a re-run after a stop
 *   carried?: ["- Task 17 carry forward: ..."]         // a follow-on run: the carried of the run before
 * } })
 * The controller writes every task's carries at wave start. Between tasks the script adds, to the
 * next task's carries, each earlier task's carryForward items (always) and its stands and verified
 * ruler and controller rulings (precedents; the most recent RULING_CAP lines), and sets the next
 * base to the previous head. A fix ruling is settled inside its own task and is not forwarded.
 * No agent runs between tasks, and nothing here writes to GitHub. The wave stops at the first task
 * whose status is not "complete".
 *
 * Returns { wave, status: "complete" | "stopped" | "parked", stoppedTask?, stop?, base, head, tasks:
 * [sdd-task result without ledgerLines], totals, carried, ledgerLines } where ledgerLines is every
 * task's lines in order plus one "- Wave <w>: ..." line (append with scripts/sdd/append-ledger.mjs).
 * carried is the flow so far: after a parked task or a thrown child, adjudicate, then run the
 * remaining tasks as a new sdd-wave with base: head and carried: the returned carried.
 * Answering a stop: keep every arg identical, add answers[<stoppedTask>] exactly as for sdd-task,
 * and re-run with resumeFromRunId and the full args; earlier tasks replay from cache.
 */

// ---------- arguments ----------
const A = args || {}
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
for (const k of ['wave', 'repoDir', 'branch', 'base', 'workDir', 'scratchRoot', 'globalConstraints', 'trailer']) {
  if (blank(A[k])) throw new Error(`sdd-wave: required arg "${k}" is missing or empty (see .claude/workflows/README.md)`)
}
if (!Array.isArray(A.tasks) || !A.tasks.length) throw new Error('sdd-wave: tasks must be a non-empty list of task entries')
const seen = new Set()
A.tasks.forEach((t, i) => {
  if (!t || typeof t !== 'object') throw new Error(`sdd-wave: tasks[${i}] is not an object`)
  for (const k of ['task', 'title', 'specRefs', 'briefPath']) {
    if (blank(t[k])) throw new Error(`sdd-wave: tasks[${i}].${k} is missing or empty`)
  }
  for (const k of ['base', 'answers']) {
    if (k in t) throw new Error(`sdd-wave: tasks[${i}].${k} is set by the wave (${k === 'base' ? 'the previous task head' : 'use answers["<task>"] at the top level'}); remove it`)
  }
  const key = String(t.task)
  if (seen.has(key)) throw new Error(`sdd-wave: duplicate task ${key} in tasks`)
  seen.add(key)
})
const ANSWERS = A.answers === undefined || A.answers === null ? {} : A.answers
if (typeof ANSWERS !== 'object' || Array.isArray(ANSWERS)) throw new Error('sdd-wave: answers must be an object keyed by task number')
for (const k of Object.keys(ANSWERS)) {
  if (!seen.has(k)) throw new Error(`sdd-wave: answers for task ${k}, which is not in tasks`)
}
if (A.carried !== undefined && A.carried !== null && (!Array.isArray(A.carried) || A.carried.some((l) => typeof l !== 'string'))) {
  throw new Error('sdd-wave: carried must be a list of strings (the carried of an earlier sdd-wave result)')
}
const SDD_TASK = A.sddTaskPath || '.claude/workflows/sdd-task.js'
// Rulings forwarded as precedents are capped (most recent kept); carry-forward lines never are.
const RULING_CAP = 30
const W = String(A.wave)
const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t }
const h7 = (s) => String(s || '').slice(0, 7)

const isRuling = (l) => / ruling T\d+\//.test(l)
function flowText(lines) {
  const rulings = lines.filter(isRuling)
  const drop = Math.max(0, rulings.length - RULING_CAP)
  if (!drop) return lines.join('\n')
  const dropped = new Set(rulings.slice(0, drop))
  return [`(${drop} earlier ruling line(s) omitted; the ledger has them)`, ...lines.filter((l) => !dropped.has(l))].join('\n')
}

// Only defined values reach sdd-task, so an unset option stays unset there.
function childArgs(t, base, flow) {
  const out = {}
  const put = (k, v) => { if (v !== undefined && v !== null) out[k] = v }
  for (const k of ['repoDir', 'branch', 'workDir', 'scratchRoot', 'ledgerPath', 'globalConstraints', 'trailer', 'requirementsDoc', 'maxRounds']) put(k, A[k])
  for (const k of ['task', 'title', 'issue', 'ids', 'specRefs', 'briefPath', 'sensitive', 'ui', 'critic', 'criticFocus', 'implemented']) put(k, t[k])
  put('reportPath', t.reportPath || `${A.workDir}/task-${t.task}-report.md`)
  put('runLabel', t.runLabel || `${W}-t${t.task}`)
  put('base', base)
  const carries = [t.carries, flow.length ? `Earlier in this wave (sdd-wave). Carry-forward lines are obligations on this task; ruling lines are precedents from earlier tasks (ids prefixed T<n>/, not this task's items):\n${flowText(flow)}` : '']
    .filter((x) => !blank(x)).join('\n\n')
  if (carries) out.carries = carries
  if (A.roles || t.roles) out.roles = Object.assign({}, A.roles || {}, t.roles || {})
  if (ANSWERS[String(t.task)] !== undefined) out.answers = ANSWERS[String(t.task)]
  return out
}

// ---------- run ----------
phase('Wave')
log(`wave ${W}: ${A.tasks.length} task(s) (${A.tasks.map((t) => t.task).join(', ')}) on ${A.branch} from ${h7(A.base)}; each runs as a nested ${SDD_TASK}`)
const results = []
const flow = (A.carried || []).slice()
const ledger = []
let base = A.base
let stop = null
for (const t of A.tasks) {
  const ca = childArgs(t, base, flow)
  log(`wave ${W}: Task ${t.task} starts from ${h7(base)}${flow.length ? `, with ${flow.length} line(s) carried from earlier tasks` : ''}${ca.answers ? ', with controller answers' : ''}`)
  let res = null
  let problem = ''
  try {
    res = await workflow({ scriptPath: SDD_TASK }, ca)
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    if (/abort|cancel|budget/i.test(msg)) throw e // a run the user stopped is not a task result
    problem = `sdd-task threw: ${msg}`
  }
  if (!res || typeof res !== 'object') {
    problem = problem || 'sdd-task returned no result'
    results.push({ task: t.task, status: 'stopped', base, head: base, problem })
    stop = { task: t.task, status: 'stopped', problem }
    ledger.push(`- Task ${t.task}: stopped at sdd-task (${short(problem, 300)}); controller action needed`)
    break
  }
  const { ledgerLines, ...summary } = res
  results.push(summary)
  ledger.push(...(Array.isArray(ledgerLines) ? ledgerLines : []))
  log(`wave ${W}: Task ${t.task} ${res.status} at ${h7(res.head)}, ${res.rounds || 0} fix round(s)`)
  if (res.status !== 'complete') {
    stop = {
      task: t.task,
      status: res.status,
      stopped: res.stopped,
      stopPoint: res.stopPoint,
      problem: res.problem,
      questions: res.questions || [],
      escalated: res.escalated || [],
      parked: res.parked || [],
    }
    break
  }
  base = res.head
  for (const c of res.carryForward || []) flow.push(`- Task ${t.task} carry forward: ${short(c, 400)}`)
  for (const r of res.rulings || []) {
    // checker rulings are verified checks; a fix ruling was settled inside its own task
    if (r.source === 'checker' || r.decision === 'fix') continue
    flow.push(`- Task ${t.task} ruling T${t.task}/${r.item} (${r.source}): ${r.decision}: ${short(r.reason, 240)}`)
  }
}

// ---------- return ----------
const done = results.filter((r) => r.status === 'complete')
const totals = {
  tasks: A.tasks.length,
  run: results.length,
  completed: done.length,
  rounds: results.reduce((s, r) => s + (r.rounds || 0), 0),
  escalations: results.reduce((s, r) => s + ((r.escalated || []).length), 0),
  parked: results.reduce((s, r) => s + ((r.parked || []).length), 0),
  deferredMinors: results.reduce((s, r) => s + ((r.deferredMinors || []).length), 0),
}
const head = results.length ? results[results.length - 1].head || base : base
if (stop) {
  log(`wave ${W}: stopped at Task ${stop.task} (${stop.status}${stop.stopped ? `: ${stop.stopped}` : ''}); answer with answers["${stop.task}"] and re-run with the full args`)
  ledger.push(`- Wave ${W}: stopped at Task ${stop.task} (${stop.status}${stop.stopped ? `: ${stop.stopped}` : ''}; ${done.length} of ${A.tasks.length} task(s) complete, head ${h7(head)}); controller action needed`)
  return { wave: W, status: stop.status === 'parked' ? 'parked' : 'stopped', stoppedTask: stop.task, stop, base: A.base, head, tasks: results, totals, carried: flow, ledgerLines: ledger }
}
log(`wave ${W}: complete, ${done.length} task(s), ${totals.rounds} fix round(s), ${totals.deferredMinors} deferred minor(s)`)
ledger.push(`- Wave ${W}: complete (Tasks ${A.tasks.map((t) => t.task).join(', ')}; commits ${h7(A.base)}..${h7(head)}; ${totals.rounds} fix round(s))`)
return { wave: W, status: 'complete', base: A.base, head, tasks: results, totals, carried: flow, ledgerLines: ledger }
