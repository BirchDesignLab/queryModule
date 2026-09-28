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
 *   tier?: "ordinary" | "gate" | "critical", // wave default; a task that sets tier or sensitive wins
 *   maxAgents?: 16,                          // wave default agent budget per task; a task's maxAgents wins
 *   roles?: { ... },                         // wave defaults; a task's roles override per role
 *   sddTaskPath?: ".claude/workflows/sdd-task.js",
 *   tasks: [{ task: 17, title, issue?, ids?, specRefs, briefPath, carries?, reportPath?, runLabel?,
 *             tier?, sensitive?, ui?, critic?, criticFocus?, maxAgents?, roles?, implemented? }, ...],
 *   answers?: { "18": [{ at, text?, decisions? }] },  // per task, only on a re-run after a stop
 *   carried?: ["- Task 17 carry forward: ..."]         // a follow-on run: the carried of the run before
 * } })
 * The controller writes every task's carries at wave start. Between tasks the script adds, to the
 * next task's carries, each earlier task's carryForward items (always) and its stands and verified
 * ruler and controller rulings (precedents; the most recent RULING_CAP lines), and sets the next
 * base to the previous head. A fix ruling is settled inside its own task and is not forwarded.
 * Nothing here writes to GitHub. The only agent the wave runs is verifyHead (#222): between two tasks
 * it reads git rev-parse HEAD and git cat-file -e <sha>^{commit} (a Haiku role) and the next task's
 * base is that value, never a head an earlier agent reported. The wave stops at the first task
 * whose status is not "complete".
 *
 * Returns { wave, status: "complete" | "stopped" | "parked", stoppedTask?, stop?, base, head, tasks:
 * [sdd-task result without ledgerLines], totals (with agents: the sum of the tasks' agent calls), carried,
 * ledgerLines } where ledgerLines is every
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
  for (const k of ['task', 'title', 'issue', 'ids', 'specRefs', 'briefPath', 'tier', 'sensitive', 'ui', 'critic', 'criticFocus', 'maxAgents', 'implemented']) put(k, t[k])
  // Wave defaults: the task's own value wins. A task that sets sensitive (true or false) gets no
  // wave tier: sensitive: true is critical, sensitive: false is ordinary, and a wave tier could
  // conflict with either in sdd-task.
  if (!('tier' in out) && !('sensitive' in out)) put('tier', A.tier)
  if (!('maxAgents' in out)) put('maxAgents', A.maxAgents)
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

// ---------- verifyHead (#222) ----------
// One Haiku agent reads git; only a 40-hex sha it confirmed exists is accepted. The child head is
// compared and logged on a difference, never used. Returns { head } or { problem }.
const SHA40 = /^[0-9a-f]{40}$/
const REPO = String(A.repoDir).replace(/\\/g, '/')
let verifyCalls = 0
async function verifyHead(childHead, label) {
  const prompt = [
    `Read-only git check in ${REPO}. Run these two commands in Git Bash and return the raw stdout of each, copied exactly, with no interpretation. Change nothing.`,
    `1. git -C "${REPO}" rev-parse HEAD`,
    `2. sha=$(git -C "${REPO}" rev-parse HEAD) && git -C "${REPO}" cat-file -e "$sha^{commit}" && echo "EXISTS $sha" || echo MISSING`,
    'Return revParse (the stdout of command 1) and catFile (the stdout of command 2).',
    'Rules: never dispatch subagents; finish every command before you reply; never run git push, gh pr, gh api writes or git merge.',
  ].join('\n')
  const schema = {
    type: 'object',
    properties: {
      revParse: { type: 'string', description: 'the raw stdout of git rev-parse HEAD, copied exactly' },
      catFile: { type: 'string', description: 'the raw stdout of the cat-file check: EXISTS <sha> or MISSING' },
    },
    required: ['revParse', 'catFile'],
  }
  verifyCalls++
  const v = await agent(prompt, { label, phase: 'Wave', schema, model: 'haiku' })
  const head = String((v && v.revParse) || '').trim()
  if (!SHA40.test(head) || String((v && v.catFile) || '').trim() !== `EXISTS ${head}`) {
    return { problem: `verifyHead: ${label} did not return a 40-hex sha that exists in git (${v ? JSON.stringify({ revParse: String(v.revParse).slice(0, 60), catFile: String(v.catFile).slice(0, 20) }) : 'no result'}); fix the repository in ${REPO}, then start a fresh sdd-wave with base set to git rev-parse HEAD and carried set to the returned carried` }
  }
  const c = String(childHead || '').trim().toLowerCase()
  if (c && !(c.length >= 7 && head.startsWith(c))) log(`agent-reported head ${c.slice(0, 16)}... differs from git; using git`)
  return { head }
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
  // the completed task's obligations enter the flow before the verify read, so a verify stop still returns them in carried
  for (const c of res.carryForward || []) flow.push(`- Task ${t.task} carry forward: ${short(c, 400)}`)
  for (const r of res.rulings || []) {
    // checker rulings are verified checks; a fix ruling was settled inside its own task
    if (r.source === 'checker' || r.decision === 'fix') continue
    flow.push(`- Task ${t.task} ruling T${t.task}/${r.item} (${r.source}): ${r.decision}: ${short(r.reason, 240)}`)
  }
  if (t === A.tasks[A.tasks.length - 1]) {
    base = res.head // no later task: nothing to carry the head into
  } else {
    const v = await verifyHead(res.head, `verify-head-t${t.task}`)
    if (v.problem) {
      log(`wave ${W}: ${v.problem}`)
      stop = { task: t.task, status: 'stopped', stopped: 'precondition', stopPoint: 'precondition:verifyHead', problem: v.problem, questions: [], escalated: [], parked: [] }
      ledger.push(`- Task ${t.task}: complete, but the wave stopped: ${short(v.problem, 300)}; controller action needed`)
      break
    }
    base = v.head
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
  agents: results.reduce((s, r) => s + (r.agents || 0), 0) + verifyCalls,
}
const head = results.length ? results[results.length - 1].head || base : base
if (stop) {
  log(`wave ${W}: stopped at Task ${stop.task} (${stop.status}${stop.stopped ? `: ${stop.stopped}` : ''}); answer with answers["${stop.task}"] and re-run with the full args`)
  ledger.push(`- Wave ${W}: stopped at Task ${stop.task} (${stop.status}${stop.stopped ? `: ${stop.stopped}` : ''}; ${done.length} of ${A.tasks.length} task(s) complete, head ${h7(head)}); controller action needed`)
  return { wave: W, status: stop.status === 'parked' ? 'parked' : 'stopped', stoppedTask: stop.task, stop, base: A.base, head, tasks: results, totals, carried: flow, ledgerLines: ledger }
}
log(`wave ${W}: complete, ${done.length} task(s), ${totals.rounds} fix round(s), ${totals.deferredMinors} deferred minor(s), ${totals.agents} agent(s)`)
ledger.push(`- Wave ${W}: complete (Tasks ${A.tasks.map((t) => t.task).join(', ')}; commits ${h7(A.base)}..${h7(head)}; ${totals.rounds} fix round(s))`)
return { wave: W, status: 'complete', base: A.base, head, tasks: results, totals, carried: flow, ledgerLines: ledger }
