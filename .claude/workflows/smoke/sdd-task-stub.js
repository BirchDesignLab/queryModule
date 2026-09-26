export const meta = {
  name: 'sdd-task-stub',
  description: 'Zero-agent stand-in for sdd-task: returns a canned result so sdd-wave nesting can be smoke-tested in the real runtime',
  phases: [],
}

/*
 * Smoke test for sdd-wave in the real Workflow runtime, with no agents and no repo changes:
 *   Workflow({ scriptPath: ".claude/workflows/sdd-wave.js", args: { ...any valid wave args,
 *     sddTaskPath: ".claude/workflows/smoke/sdd-task-stub.js" } })
 * Expect status "complete", each task's base equal to the previous task's head, and each task's
 * echoCarries showing the "Earlier in this wave" block built from the stub's carryForward and ruling.
 * A task whose title contains "park" returns status "parked" instead.
 */
const A = args || {}
const park = String(A.title || '').includes('park')
log(`sdd-task-stub: task ${A.task} from ${A.base}${park ? ' (parks)' : ''}`)
return {
  task: A.task,
  status: park ? 'parked' : 'complete',
  base: A.base,
  head: `${A.base}-t${A.task}`,
  commits: [],
  rounds: 0,
  rulings: [
    { item: 'spec:I1', what: 'w', decision: 'stands', reason: `stub precedent from ${A.task}`, costIfWrong: 'c', fixInstruction: '', command: '', source: 'ruler' },
    { item: 'spec:I2', what: 'w', decision: 'fix', reason: 'settled in its own task', costIfWrong: 'c', fixInstruction: 'f', command: '', source: 'ruler' },
  ],
  supersededRulings: [],
  carryForward: [`obligation from task ${A.task}`],
  deferredMinors: [],
  parked: park ? [{ id: 'spec:I3' }] : [],
  questions: [],
  concerns: [],
  echoCarries: A.carries || '',
  ledgerLines: [`- Task ${A.task}: ${park ? 'parked' : 'complete'} (sdd-task-stub)`],
}
