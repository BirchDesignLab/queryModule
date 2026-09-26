// workflow-harness.mjs: mock harness for the saved Workflow scripts in .claude/workflows
// (sdd-task.js, wave-review.js). It runs no agents and touches no files.
//
// Usage (repo root, PowerShell or Git Bash): node scripts/sdd/workflow-harness.mjs
//
// Each script body is wrapped in an async function, imported from a data: URL (which also
// proves it parses), and run against stubbed agent(), parallel(), phase() and log(). The stub
// checks every call: model set, effort set unless Haiku, no Haiku effort, no "undefined" or
// "[object Object]" in a prompt, and every mock return valid against the call's schema (object
// root, required a subset of properties). Scenarios assert control flow, agent counts, role
// tiers, gate, rulings routing, answers re-runs and the sensitive ruler rule.
// Exit code 0 when every scenario passes, 1 otherwise. Run it after any change to a workflow.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WF_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.claude/workflows",
);

async function load(file) {
  const src = fs.readFileSync(path.join(WF_DIR, file), "utf8");
  const metaAt = src.indexOf("export const meta");
  const bodyAt = src.indexOf("\n}\n", metaAt) + 3;
  const wrapped = `${src.slice(0, bodyAt)}export default async function __wf__(agent, parallel, pipeline, phase, log, args, budget) {\n${src.slice(bodyAt)}\n}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(wrapped).toString("base64")}`);
}

function checkSchema(schema, p = "$") {
  if (schema.type === "object") {
    for (const r of schema.required || []) {
      assert.ok(r in (schema.properties || {}), `schema ${p}: required "${r}" not in properties`);
    }
    for (const [k, s] of Object.entries(schema.properties || {})) checkSchema(s, `${p}.${k}`);
  } else if (schema.type === "array") checkSchema(schema.items, `${p}[]`);
}

function validate(schema, v, p = "$") {
  if (schema.type === "object") {
    assert.ok(v && typeof v === "object" && !Array.isArray(v), `${p} not an object`);
    for (const r of schema.required || []) assert.ok(r in v, `${p}.${r} missing`);
    for (const [k, s] of Object.entries(schema.properties || {}))
      if (k in v) validate(s, v[k], `${p}.${k}`);
  } else if (schema.type === "array") {
    assert.ok(Array.isArray(v), `${p} not an array`);
    for (const [i, x] of v.entries()) validate(schema.items, x, `${p}[${i}]`);
  } else if (schema.type === "string") {
    assert.equal(typeof v, "string", `${p} not a string`);
    if (schema.enum) assert.ok(schema.enum.includes(v), `${p} "${v}" not in enum`);
  } else if (schema.type === "integer") assert.ok(Number.isInteger(v), `${p} not an integer`);
  else if (schema.type === "boolean") assert.equal(typeof v, "boolean", `${p} not a boolean`);
}

async function run(mod, args, responder) {
  const calls = [];
  const logs = [];
  const agent = async (prompt, opts) => {
    assert.ok(opts.model, `agent ${opts.label} has no model`);
    if (opts.model === "haiku")
      assert.equal(opts.effort, undefined, `Haiku with effort on ${opts.label}`);
    else assert.ok(opts.effort, `no effort on ${opts.label}`);
    assert.ok(
      !/undefined|\[object Object\]/.test(prompt),
      `prompt of ${opts.label} has undefined or [object Object]`,
    );
    if (opts.schema) checkSchema(opts.schema);
    const call = { label: opts.label, model: opts.model, effort: opts.effort, prompt, opts };
    calls.push(call);
    assert.ok(calls.length <= 200, "runaway loop: more than 200 agent calls");
    const r = responder(opts.label, prompt, calls);
    if (r && opts.schema) validate(opts.schema, r, opts.label);
    return r ?? null;
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const res = await mod.default(
    agent,
    parallel,
    null,
    () => {},
    (m) => logs.push(m),
    args,
    {},
  );
  const labels = calls.map((c) => c.label);
  const find = (l) => calls.find((c) => c.label === l);
  return { res, calls, logs, labels, find };
}

// ---------- fixtures ----------
const ids = (prompt) => [...prompt.matchAll(/^- \[([^\]]+)\]/gm)].map((m) => m[1]);
const work = (head, extra = {}) => ({
  status: "DONE",
  commits: [{ sha: head, subject: "s" }],
  head,
  testSummary: "10/10 passing",
  concerns: [],
  questions: [],
  ...extra,
});
const F = (id, severity, extra = {}) => ({
  id,
  severity,
  file: "a.ts",
  line: "1",
  summary: `bad ${id}`,
  fix: "do x",
  planMandated: false,
  contestsRuling: "",
  ...extra,
});
const PASS = { verdict: "pass", findings: [], cannotVerify: [] };
const GATE_OK = (head = "hgate") => ({ ok: true, head, problems: [] });
const progress = (label) => ({
  ok: true,
  problems: [],
  head: `h-${label}`,
  newCommits: [{ sha: `h-${label}`, subject: "fix" }],
  testCount: 10,
});
const addressAll = (p) => ({
  verdicts: ids(p).map((id) => ({ id, verdict: "ADDRESSED", evidence: "a.ts:2" })),
  newFindings: [],
  outOfScope: [],
});
const checkAll = (result) => (p) => ({
  results: ids(p).map((id) => ({ id, result, evidence: `ran it: ${result}` })),
});
const BASE = {
  task: 7,
  title: "SiteConfig",
  issue: 8,
  repoDir: "C:\\git\\queryModule",
  branch: "feat/p0-wave-2",
  base: "aaaaaaa1111",
  briefPath: "C:/w/task-7-brief.md",
  reportPath: "C:/w/task-7-report.md",
  workDir: "C:\\w",
  scratchRoot: "C:\\scratch",
  runLabel: "w2-t7",
  ledgerPath: "C:/w/progress.md",
  ids: "BR-001",
  specRefs: "spec 4.1",
  globalConstraints: "- TDD for every task",
  carries: "none",
  trailer: "Co-Authored-By: X",
};
const SENSITIVE_RULE =
  "escalate any ruling that would: (a) weaken a security, audit, credential, delegation or dispatch invariant; (b) change a shape frozen at a phase gate or listed as a contract file (master plan 8.2); (c) keep a Critical finding with stands. Everything else it rules.";

// Generic sdd-task responder; override per label with `over`.
function sddResponder(over = {}) {
  return (label, prompt, calls) => {
    for (const [k, v] of Object.entries(over)) {
      if (label === k || (k.endsWith("*") && label.startsWith(k.slice(0, -1)))) {
        return typeof v === "function" ? v(prompt, calls, label) : v;
      }
    }
    if (label === "implementer") return work("h-impl");
    if (label === "implementer-continue") return work("h-cont");
    if (label.startsWith("ruler")) {
      return {
        rulings: ids(prompt).map((id) => ({
          item: id,
          decision: "fix",
          reason: "r",
          costIfWrong: "c",
          fixInstruction: "fi",
        })),
      };
    }
    if (label.endsWith("-review")) return PASS;
    if (label === "checker") return checkAll("verified")(prompt);
    if (label.startsWith("fixer")) return work(`h-${label}`);
    if (label.startsWith("progress")) return progress(label);
    if (label.startsWith("re-review")) return addressAll(prompt);
    if (label.startsWith("gate")) return GATE_OK(`h-${label}`);
    return null;
  };
}

// ---------- runner ----------
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (e) {
    results.push([false, name, e.message]);
  }
}

const sdd = await load("sdd-task.js");
const wr = await load("wave-review.js");

// ================= sdd-task =================
await test("sdd: happy path runs implementer, spec, quality and gate-0, and completes", async () => {
  const r = await run(sdd, BASE, sddResponder());
  assert.deepEqual(r.labels, ["implementer", "spec-review", "quality-review", "gate-0"]);
  assert.equal(r.res.status, "complete");
  assert.equal(r.find("gate-0").model, "sonnet");
  assert.equal(r.find("gate-0").effort, "low");
  assert.ok(
    /pnpm lint/.test(r.find("gate-0").prompt) && /pnpm typecheck/.test(r.find("gate-0").prompt),
  );
  assert.equal(r.res.head, "h-gate-0");
});

await test("sdd: a failing gate opens findings that go through the fix loop, then the gate re-runs", async () => {
  let gates = 0;
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "gate*": () =>
        ++gates === 1
          ? { ok: false, head: "h-impl", problems: ["pnpm lint: 2 errors"] }
          : GATE_OK("h-final"),
    }),
  );
  assert.deepEqual(r.labels, [
    "implementer",
    "spec-review",
    "quality-review",
    "gate-0",
    "fixer-r1",
    "progress-r1",
    "gate-r1",
  ]);
  assert.ok(r.find("fixer-r1").prompt.includes("pnpm lint: 2 errors"));
  assert.equal(r.res.status, "complete");
  assert.equal(r.res.rounds, 1);
});

// Worst case at maxRounds 5: implementer, ruler-concerns, fixer-pre, progress-pre, three reviewers
// and gate-0 in parallel, checker (needsJudgment), ruler-review, then round 1 with a review finding (fixer, progress,
// re-review, red gate-r1) and four mechanical rounds (fixer, progress, red gate).
await test("sdd: gate failing every round parks at the cap (worst case 26 agents at maxRounds 5)", async () => {
  const r = await run(
    sdd,
    { ...BASE, sensitive: true, ui: true },
    sddResponder({
      implementer: work("h0", { concerns: [{ kind: "correctness", text: "unsure" }] }),
      "spec-review": { verdict: "pass", findings: [], cannotVerify: [{ item: "i", check: "c" }] },
      "critic-review": { verdict: "fail", findings: [F("C1", "important")], cannotVerify: [] },
      checker: checkAll("needsJudgment"),
      "ruler-review": {
        rulings: [
          {
            item: "spec:CV1",
            decision: "verified",
            reason: "ok",
            costIfWrong: "c",
            command: "ran",
          },
        ],
      },
      "gate*": { ok: false, head: "hg", problems: ["tests red"] },
    }),
  );
  assert.equal(r.calls.length, 26, r.labels.join(","));
  assert.equal(r.labels.filter((l) => l.startsWith("re-review")).join(","), "re-review-r1");
  assert.equal(r.labels.filter((l) => l.startsWith("gate")).length, 6);
  assert.equal(r.res.status, "parked");
  assert.equal(r.res.rounds, 5);
});

await test("sdd: worst case with every finding NOT ADDRESSED is 24 agents; escalated fixer after a repeat", async () => {
  const r = await run(
    sdd,
    { ...BASE, sensitive: true, ui: true },
    sddResponder({
      implementer: work("h0", { concerns: [{ kind: "correctness", text: "unsure" }] }),
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "quality-review": {
        verdict: "fail",
        findings: [F("Q1", "important", { planMandated: true })],
        cannotVerify: [],
      },
      "critic-review": { verdict: "fail", findings: [F("C1", "critical")], cannotVerify: [] },
      "re-review*": (p) => ({
        verdicts: ids(p).map((id) => ({ id, verdict: "NOT ADDRESSED", evidence: "a.ts:1" })),
        newFindings: [],
        outOfScope: [],
      }),
    }),
  );
  assert.equal(r.calls.length, 24, r.labels.join(","));
  assert.equal(r.res.status, "parked");
  assert.equal(r.find("fixer-r2").effort, "medium");
  assert.equal(r.find("fixer-r3").effort, "high");
});

await test("sdd: sensitive defaults (implementer opus/medium, re-reviewer opus/medium, ruler opus/medium)", async () => {
  const r = await run(
    sdd,
    { ...BASE, sensitive: true },
    sddResponder({
      "spec-review": {
        verdict: "fail",
        findings: [F("S1", "important", { planMandated: true })],
        cannotVerify: [],
      },
    }),
  );
  assert.equal(`${r.find("implementer").model}/${r.find("implementer").effort}`, "opus/medium");
  assert.equal(`${r.find("re-review-r1").model}/${r.find("re-review-r1").effort}`, "opus/medium");
  assert.equal(`${r.find("ruler-review").model}/${r.find("ruler-review").effort}`, "opus/medium");
});

await test("sdd: rulings reach reviewers, fixers and re-reviewers; fixers are told never to reverse one", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      implementer: work("h0", {
        concerns: [{ kind: "planVsSpec", text: "plan says A, spec says B" }],
      }),
      "ruler-concerns": {
        rulings: [
          { item: "IC1", decision: "stands", reason: "spec silent, plan wins", costIfWrong: "c" },
        ],
      },
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
    }),
  );
  for (const l of ["spec-review", "quality-review", "fixer-r1", "re-review-r1"]) {
    assert.ok(r.find(l).prompt.includes("[IC1] stands"), `${l} lacks the IC1 ruling`);
  }
  assert.ok(/never reverse a ruling/i.test(r.find("fixer-r1").prompt));
});

await test("sdd: a finding that contests a ruling goes to the ruler, never straight to the fixer", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      implementer: work("h0", { concerns: [{ kind: "planVsSpec", text: "plan vs spec" }] }),
      "ruler-concerns": {
        rulings: [{ item: "IC1", decision: "stands", reason: "plan wins", costIfWrong: "c" }],
      },
      "spec-review": {
        verdict: "fail",
        findings: [F("S1", "important", { contestsRuling: "IC1" })],
        cannotVerify: [],
      },
      "ruler-review": {
        rulings: [{ item: "spec:S1", decision: "stands", reason: "IC1 holds", costIfWrong: "c" }],
      },
    }),
  );
  assert.ok(ids(r.find("ruler-review").prompt).includes("spec:S1"));
  assert.ok(!r.labels.includes("fixer-r1"), r.labels.join(","));
  assert.equal(r.res.status, "complete");
});

await test("sdd: the sensitive ruler rule is in the ruler prompt verbatim; ordinary tasks omit it", async () => {
  const resp = sddResponder({
    "spec-review": {
      verdict: "fail",
      findings: [F("S1", "important", { planMandated: true })],
      cannotVerify: [],
    },
  });
  const s = await run(sdd, { ...BASE, sensitive: true }, resp);
  assert.ok(s.find("ruler-review").prompt.includes(SENSITIVE_RULE));
  const o = await run(sdd, BASE, resp);
  assert.ok(!o.find("ruler-review").prompt.includes(SENSITIVE_RULE));
});

await test("sdd: on a sensitive task a critical ruled stands is escalated by the script", async () => {
  const r = await run(
    sdd,
    { ...BASE, sensitive: true },
    sddResponder({
      "critic-review": {
        verdict: "fail",
        findings: [F("C1", "critical", { planMandated: true })],
        cannotVerify: [],
      },
      "ruler-review": {
        rulings: [{ item: "critic:C1", decision: "stands", reason: "plan", costIfWrong: "c" }],
      },
    }),
  );
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stopped, "ruler-review");
  assert.equal(r.res.escalated.length, 1);
});

await test("sdd: answers after an implementer stop replay the implementer and run a continue implementer", async () => {
  const resp = sddResponder({
    implementer: work("h0", {
      status: "NEEDS_CONTEXT",
      commits: [],
      questions: ["Which key format?"],
    }),
  });
  const first = await run(sdd, BASE, resp);
  assert.equal(first.res.status, "stopped");
  assert.equal(first.res.stopped, "implementer");
  const second = await run(
    sdd,
    { ...BASE, answers: { at: "implementer", text: "Use FieldKeySchema." } },
    resp,
  );
  assert.equal(
    second.find("implementer").prompt,
    first.find("implementer").prompt,
    "implementer prompt changed, cache would miss",
  );
  assert.deepEqual(second.find("implementer").opts, first.find("implementer").opts);
  assert.ok(!second.find("implementer").prompt.includes("Use FieldKeySchema."));
  const cont = second.find("implementer-continue");
  assert.ok(cont, second.labels.join(","));
  assert.ok(
    cont.prompt.includes("Use FieldKeySchema.") && cont.prompt.includes("Which key format?"),
  );
  assert.equal(second.res.status, "complete");
});

await test("sdd: answers at a later stop leave earlier prompts unchanged and reach the ruler", async () => {
  const resp = sddResponder({
    "spec-review": {
      verdict: "fail",
      findings: [F("S1", "important", { planMandated: true })],
      cannotVerify: [],
    },
    "ruler-review": (p) =>
      p.includes("Controller answers")
        ? {
            rulings: [
              {
                item: "spec:S1",
                decision: "fix",
                reason: "answered",
                costIfWrong: "c",
                fixInstruction: "fi",
              },
            ],
          }
        : {
            rulings: [{ item: "spec:S1", decision: "escalate", reason: "guess", costIfWrong: "c" }],
          },
  });
  const first = await run(sdd, BASE, resp);
  assert.equal(first.res.stopped, "ruler-review");
  const second = await run(
    sdd,
    { ...BASE, answers: { at: "ruler-review", text: "Spec wins." } },
    resp,
  );
  for (const l of ["implementer", "spec-review", "quality-review"]) {
    assert.equal(second.find(l).prompt, first.find(l).prompt, `${l} prompt changed`);
  }
  assert.ok(second.find("ruler-review").prompt.includes("Spec wins."));
  assert.equal(second.res.status, "complete");
});

await test("sdd: answers with an unknown stop point throw", async () => {
  await assert.rejects(
    run(sdd, { ...BASE, answers: { at: "nowhere", text: "x" } }, sddResponder()),
    /answers(\[\d+\])?\.at "nowhere"/,
  );
});

await test("sdd: required args throw clearly, including globalConstraints", async () => {
  for (const k of ["globalConstraints", "briefPath", "reportPath", "repoDir", "base", "branch"]) {
    await assert.rejects(run(sdd, { ...BASE, [k]: "" }, sddResponder()), new RegExp(`"${k}"`));
  }
});

await test("sdd: maxRounds is coerced and logged (numeric string, float, junk)", async () => {
  const a = await run(sdd, { ...BASE, maxRounds: "3" }, sddResponder());
  assert.ok(
    a.logs.some((l) => /maxRounds "3" coerced to 3/.test(l)),
    a.logs.join(" | "),
  );
  const b = await run(sdd, { ...BASE, maxRounds: 2.7 }, sddResponder());
  assert.ok(b.logs.some((l) => /maxRounds 2\.7 coerced to 2/.test(l)));
  const c = await run(sdd, { ...BASE, maxRounds: "abc" }, sddResponder());
  assert.ok(c.logs.some((l) => /maxRounds "abc" is not a number; using 5/.test(l)));
  const d = await run(sdd, { ...BASE, maxRounds: 99 }, sddResponder());
  assert.ok(d.logs.some((l) => /clamped to 8/.test(l)));
});

await test("sdd: carryForward from rulings is returned", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": {
        verdict: "pass",
        findings: [],
        cannotVerify: [{ item: "tsc -b", check: "run it" }],
      },
      checker: checkAll("needsJudgment"),
      "ruler-review": {
        rulings: [
          {
            item: "spec:CV1",
            decision: "verified",
            reason: "ok",
            costIfWrong: "c",
            command: "tsc -b: 0",
            carryForward: ["Task 8 must show tsc -b exit 0"],
          },
        ],
      },
    }),
  );
  assert.deepEqual(r.res.carryForward, ["Task 8 must show tsc -b exit 0"]);
});

await test("sdd: role overrides (Haiku drops effort; Fable throws)", async () => {
  const r = await run(
    sdd,
    { ...BASE, roles: { specReviewer: { model: "haiku", effort: "low" } } },
    sddResponder(),
  );
  assert.equal(r.find("spec-review").effort, undefined);
  await assert.rejects(
    run(
      sdd,
      { ...BASE, roles: { implementer: { model: "fable", effort: "low" } } },
      sddResponder(),
    ),
    /fable/,
  );
});

await test("sdd: implementer BLOCKED stops with questions", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({ implementer: work("h", { status: "BLOCKED", commits: [], questions: ["q?"] }) }),
  );
  assert.equal(r.res.status, "stopped");
  assert.deepEqual(r.res.questions, ["q?"]);
  assert.deepEqual(r.labels, ["implementer"]);
});

// ---------- fix pass 2: N1 to N6 (sdd-task) ----------
const criticC1 = {
  verdict: "fail",
  findings: [F("C1", "critical", { planMandated: true })],
  cannotVerify: [],
};

await test("sdd N1: an answered critical-stands closes without a ruler or fix loop and is ledgered as controller", async () => {
  const resp = sddResponder({
    "critic-review": criticC1,
    "ruler-review": {
      rulings: [{ item: "critic:C1", decision: "stands", reason: "plan", costIfWrong: "c" }],
    },
  });
  const first = await run(sdd, { ...BASE, sensitive: true }, resp);
  assert.equal(first.res.stopped, "ruler-review");
  const answers = {
    at: "ruler-review",
    decisions: [{ item: "critic:C1", decision: "stands", reason: "false positive" }],
  };
  const second = await run(sdd, { ...BASE, sensitive: true, answers }, resp);
  for (const l of ["implementer", "spec-review", "quality-review", "critic-review"]) {
    assert.equal(second.find(l).prompt, first.find(l).prompt, `${l} prompt changed`);
  }
  assert.ok(!second.labels.includes("ruler-review"), second.labels.join(","));
  assert.ok(!second.labels.some((l) => l.startsWith("fixer")), second.labels.join(","));
  assert.equal(second.res.status, "complete");
  const c1 = second.res.rulings.find((r) => r.item === "critic:C1");
  assert.equal(c1.source, "controller");
  assert.equal(c1.decision, "stands");
  assert.ok(second.res.ledgerLines.some((l) => l.includes("Ruling (controller): ")));
});

await test("sdd N1: an answered fix reaches the fixer with its fixInstruction", async () => {
  const answers = {
    at: "ruler-review",
    decisions: [
      {
        item: "critic:C1",
        decision: "fix",
        reason: "real",
        fixInstruction: "guard the audit write",
      },
    ],
  };
  const r = await run(
    sdd,
    { ...BASE, sensitive: true, answers },
    sddResponder({ "critic-review": criticC1 }),
  );
  assert.ok(r.find("fixer-r1").prompt.includes("guard the audit write"));
  assert.equal(r.res.status, "complete");
});

await test("sdd N3: every stop point names its consumer; an unknown at throws listing the valid ones", async () => {
  await assert.rejects(
    run(sdd, { ...BASE, answers: { at: "gate", text: "x" } }, sddResponder()),
    /gate-0.*gate-r<r>/s,
  );
  await assert.rejects(
    run(sdd, { ...BASE, answers: { at: "ruler-review" } }, sddResponder()),
    /text or decisions/,
  );
  const review = await run(
    sdd,
    { ...BASE, answers: { at: "review", text: "ANS-REVIEW" } },
    sddResponder({
      "spec-review": {
        verdict: "fail",
        findings: [F("S1", "important", { planMandated: true })],
        cannotVerify: [],
      },
    }),
  );
  assert.ok(review.find("ruler-review").prompt.includes("ANS-REVIEW"));
  assert.ok(!review.find("spec-review").prompt.includes("ANS-REVIEW"));
  let gates = 0;
  const gate = await run(
    sdd,
    { ...BASE, answers: { at: "gate-0", text: "ANS-GATE" } },
    sddResponder({
      "gate*": () =>
        ++gates === 1 ? { ok: false, head: "h", problems: ["lint red"] } : GATE_OK("h2"),
    }),
  );
  assert.ok(gate.find("fixer-r1").prompt.includes("ANS-GATE"));
  assert.ok(!gate.find("gate-0").prompt.includes("ANS-GATE"));
  const unused = await run(
    sdd,
    { ...BASE, answers: { at: "fixer-r2", text: "never used" } },
    sddResponder(),
  );
  assert.ok(
    unused.logs.some((l) => /answers .*not consumed/.test(l)),
    unused.logs.join(" | "),
  );
  assert.equal(unused.res.answersUnconsumed, true);
});

await test("sdd N4: a later ruling supersedes the earlier one; only rulings in force reach the fixer", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      implementer: work("h0", { concerns: [{ kind: "planVsSpec", text: "plan vs spec" }] }),
      "ruler-concerns": {
        rulings: [{ item: "IC1", decision: "stands", reason: "plan wins", costIfWrong: "c" }],
      },
      "spec-review": {
        verdict: "fail",
        findings: [F("S1", "important", { contestsRuling: "IC1" })],
        cannotVerify: [],
      },
      "ruler-review": {
        rulings: [
          {
            item: "spec:S1",
            decision: "fix",
            reason: "spec wins",
            costIfWrong: "c",
            fixInstruction: "follow spec",
          },
        ],
      },
    }),
  );
  const fx = r.find("fixer-r1").prompt;
  assert.ok(fx.includes("[spec:S1] fix"), fx);
  assert.ok(!fx.includes("[IC1] stands"), "superseded ruling shown to the fixer");
  assert.equal(r.res.supersededRulings.length, 1);
  assert.equal(r.res.supersededRulings[0].item, "IC1");
  assert.ok(r.res.ledgerLines.some((l) => l.includes("Ruling superseded: IC1")));
  assert.ok(!r.res.rulings.some((x) => x.item === "IC1"));
});

await test("sdd N5: an implementer precondition failure stops the run; answers at precondition retry it", async () => {
  const resp = sddResponder({
    implementer: work("h", {
      status: "BLOCKED",
      commits: [],
      preconditionFailed: "HEAD is abc, not aaaaaaa1111",
    }),
    "implementer-retry": work("h-retry"),
  });
  const r = await run(sdd, BASE, resp);
  assert.equal(r.res.stopped, "precondition");
  assert.ok(r.res.problem.includes("HEAD is abc"));
  assert.deepEqual(r.labels, ["implementer"]);
  const again = await run(
    sdd,
    { ...BASE, answers: { at: "precondition", text: "Reset to base; retry." } },
    resp,
  );
  assert.ok(again.find("implementer-retry").prompt.includes("Reset to base; retry."));
  assert.equal(again.res.status, "complete");
});

await test("sdd N5: a gate head mismatch stops as a precondition, never reaching a fixer", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "gate*": {
        ok: false,
        head: "zzz",
        problems: [],
        preconditionFailed: "HEAD zzz, expected h-impl",
      },
    }),
  );
  assert.equal(r.res.stopped, "precondition");
  assert.ok(!r.labels.some((l) => l.startsWith("fixer")));
});

// ================= wave-review =================
const WBASE = {
  pr: 32,
  base: "b0",
  head: "h0",
  repoDir: "C:\\git\\queryModule",
  planPath: "p.md",
  ledgerPath: "l.md",
  workDir: "C:\\w",
  scratchRoot: "C:\\scratch",
  runLabel: "w2-xhigh",
  sensitiveFiles: ["a.ts"],
  questions: ["q1"],
  trailer: "T",
};
const WF = (id, severity, extra = {}) => F(id, severity, { contests: "", ...extra });
function wrResponder(over = {}) {
  return (label, prompt) => {
    if (label in over) return typeof over[label] === "function" ? over[label](prompt) : over[label];
    if (label === "fixer") return work("h1");
    if (label === "progress")
      return {
        ok: true,
        problems: [],
        head: "h1full",
        newCommits: [{ sha: "h1full", subject: "f" }],
        testCount: 12,
      };
    if (label === "ruler")
      return {
        rulings: ids(prompt).map((id) => ({
          item: id,
          decision: "fix",
          reason: "r",
          costIfWrong: "c",
          fixInstruction: "fi",
        })),
      };
    if (label === "re-reviewer") {
      return {
        verdict: "approve",
        reviewedSha: "h1full",
        verdicts: ids(prompt).map((id) => ({ id, verdict: "ADDRESSED", evidence: "e" })),
        acceptedStands: [],
        newFindings: [],
        artifactWritten: true,
      };
    }
    return null;
  };
}
const reviewWith = (findings) => ({
  verdict: "fixes",
  reviewedSha: "h0full",
  preconditionFailed: "",
  findings,
  answers: [],
  declined: [],
  artifactWritten: false,
});

await test("wr: clean approve is one agent", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: { ...reviewWith([WF("M1", "minor")]), verdict: "approve", artifactWritten: true },
    }),
  );
  assert.deepEqual(r.labels, ["reviewer"]);
  assert.equal(r.res.verdict, "approve");
});

await test("wr: worst case is 5 agents; ruler opus/high with the sensitive rule verbatim; front matter exact", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([
        WF("C1", "critical"),
        WF("I1", "important", { planMandated: true }),
        WF("M1", "minor"),
      ]),
      ruler: { rulings: [{ item: "I1", decision: "stands", reason: "plan", costIfWrong: "c" }] },
    }),
  );
  assert.deepEqual(r.labels, ["reviewer", "ruler", "fixer", "progress", "re-reviewer"]);
  assert.equal(`${r.find("ruler").model}/${r.find("ruler").effort}`, "opus/high");
  assert.ok(r.find("ruler").prompt.includes(SENSITIVE_RULE));
  assert.ok(r.find("re-reviewer").prompt.includes('reviewer: "opus-5.5"\neffort: "xhigh"'));
  assert.ok(/never reverse a ruling/i.test(r.find("fixer").prompt));
  assert.equal(r.res.verdict, "approve");
});

await test("wr: a critical ruled stands is escalated by the script", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("C1", "critical", { planMandated: true })]),
      ruler: { rulings: [{ item: "C1", decision: "stands", reason: "plan", costIfWrong: "c" }] },
    }),
  );
  assert.equal(r.res.stopped, "ruler");
  assert.equal(r.res.escalated.length, 1);
  assert.deepEqual(r.labels, ["reviewer", "ruler"]);
});

await test("wr: progress problems become structured findings the re-reviewer must verdict", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("I1", "important")]),
      progress: {
        ok: false,
        problems: ["test count 12 -> 11"],
        head: "h1full",
        newCommits: [],
        testCount: 11,
      },
      "re-reviewer": {
        verdict: "approve",
        reviewedSha: "h1full",
        verdicts: [{ id: "I1", verdict: "ADDRESSED", evidence: "e" }],
        acceptedStands: [],
        newFindings: [],
        artifactWritten: true,
      },
    }),
  );
  assert.ok(ids(r.find("re-reviewer").prompt).includes("progress-1"));
  assert.equal(r.res.verdict, "fixes");
  assert.ok(r.res.residual.some((f) => f.id === "progress-1"));
  assert.equal(r.res.artifactWritten, false);
  assert.equal(r.res.strayArtifact, "docs/reviews/pr-32.md");
});

await test("wr: re-reviewer STANDS on a critical cannot approve", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("C1", "critical")]),
      "re-reviewer": {
        verdict: "approve",
        reviewedSha: "h1full",
        verdicts: [{ id: "C1", verdict: "STANDS", evidence: "e" }],
        acceptedStands: [],
        newFindings: [],
        artifactWritten: false,
      },
    }),
  );
  assert.equal(r.res.verdict, "fixes");
  assert.ok(r.res.residual.some((f) => f.id === "C1"));
});

await test("wr: an important accepted as stands must be listed with its ruling id", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("I1", "important", { planMandated: true }), WF("I2", "important")]),
      ruler: { rulings: [{ item: "I1", decision: "stands", reason: "plan", costIfWrong: "c" }] },
      "re-reviewer": {
        verdict: "approve",
        reviewedSha: "h1full",
        verdicts: [
          { id: "I1", verdict: "STANDS", evidence: "e" },
          { id: "I2", verdict: "ADDRESSED", evidence: "e" },
        ],
        acceptedStands: [],
        newFindings: [],
        artifactWritten: true,
      },
    }),
  );
  assert.equal(r.res.verdict, "fixes", "STANDS without acceptedStands entry must not approve");
  const ok = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("I1", "important", { planMandated: true }), WF("I2", "important")]),
      ruler: { rulings: [{ item: "I1", decision: "stands", reason: "plan", costIfWrong: "c" }] },
      "re-reviewer": {
        verdict: "approve",
        reviewedSha: "h1full",
        verdicts: [
          { id: "I1", verdict: "STANDS", evidence: "e" },
          { id: "I2", verdict: "ADDRESSED", evidence: "e" },
        ],
        acceptedStands: [{ id: "I1", rulingId: "I1" }],
        newFindings: [],
        artifactWritten: true,
      },
    }),
  );
  assert.equal(ok.res.verdict, "approve");
  assert.equal(ok.res.artifactWritten, true);
});

await test("wr: dead reviewer returns verdict fixes with stopped reviewer; labels match scratch keys", async () => {
  const r = await run(wr, WBASE, wrResponder({ reviewer: null }));
  assert.equal(r.res.verdict, "fixes");
  assert.equal(r.res.stopped, "reviewer");
  const full = await run(wr, WBASE, wrResponder({ reviewer: reviewWith([WF("I1", "important")]) }));
  assert.ok(full.find("re-reviewer").prompt.includes("w2-xhigh/re-reviewer"));
});

await test("wr: missing required arg throws", async () => {
  await assert.rejects(run(wr, { ...WBASE, pr: "" }, wrResponder()), /"pr"/);
});

// ---------- fix pass 2: N1 to N6 (wave-review) ----------
await test("wr N2: an escalation is answered; the review replays from cache and the run reaches the fix pass", async () => {
  const resp = wrResponder({
    reviewer: reviewWith([WF("C1", "critical", { planMandated: true })]),
    ruler: { rulings: [{ item: "C1", decision: "stands", reason: "plan", costIfWrong: "c" }] },
  });
  const first = await run(wr, WBASE, resp);
  assert.equal(first.res.stopped, "ruler");
  const answers = {
    at: "ruler",
    text: "ANS-WR",
    decisions: [
      { item: "C1", decision: "fix", reason: "real", fixInstruction: "close the fail-open path" },
    ],
  };
  const second = await run(wr, { ...WBASE, answers }, resp);
  assert.equal(
    second.find("reviewer").prompt,
    first.find("reviewer").prompt,
    "reviewer prompt changed, cache would miss",
  );
  assert.deepEqual(second.find("reviewer").opts, first.find("reviewer").opts);
  assert.ok(!second.labels.includes("ruler"), second.labels.join(","));
  assert.ok(second.find("fixer").prompt.includes("close the fail-open path"));
  assert.ok(second.find("fixer").prompt.includes("ANS-WR"));
  assert.equal(second.res.verdict, "approve");
  assert.equal(second.res.rulings.find((r) => r.item === "C1").source, "controller");
});

await test("wr N1: a controller stands on a critical is final through the re-review", async () => {
  const answers = {
    at: "ruler",
    decisions: [{ item: "C1", decision: "stands", reason: "false positive" }],
  };
  const r = await run(
    wr,
    { ...WBASE, answers },
    wrResponder({
      reviewer: reviewWith([WF("C1", "critical", { planMandated: true }), WF("I2", "important")]),
      "re-reviewer": {
        verdict: "approve",
        reviewedSha: "h1full",
        verdicts: [
          { id: "C1", verdict: "STANDS", evidence: "controller" },
          { id: "I2", verdict: "ADDRESSED", evidence: "e" },
        ],
        acceptedStands: [],
        newFindings: [],
        artifactWritten: true,
      },
    }),
  );
  assert.ok(!r.labels.includes("ruler"));
  assert.equal(r.res.verdict, "approve");
  assert.ok(!r.res.residual.some((f) => f.id === "C1"));
});

await test("wr N3: an unknown at throws listing the valid stop points; answers at reviewer reach the ruler", async () => {
  await assert.rejects(
    run(wr, { ...WBASE, answers: { at: "gate", text: "x" } }, wrResponder()),
    /reviewer.*precondition.*ruler.*fixer.*re-review/s,
  );
  const r = await run(
    wr,
    { ...WBASE, answers: { at: "reviewer", text: "ANS-R" } },
    wrResponder({ reviewer: reviewWith([WF("I1", "important", { planMandated: true })]) }),
  );
  assert.ok(!r.find("reviewer").prompt.includes("ANS-R"));
  assert.ok(r.find("ruler").prompt.includes("ANS-R"));
});

await test("wr N5: a reviewer precondition failure stops before any ruler or fixer; answers retry the reviewer", async () => {
  const resp = wrResponder({
    reviewer: {
      ...reviewWith([WF("X", "critical")]),
      preconditionFailed: "b0 is not an ancestor of h0",
    },
    "reviewer-retry": { ...reviewWith([]), verdict: "approve", artifactWritten: true },
  });
  const r = await run(wr, WBASE, resp);
  assert.equal(r.res.stopped, "precondition");
  assert.ok(r.res.problem.includes("not an ancestor"));
  assert.deepEqual(r.labels, ["reviewer"]);
  const again = await run(
    wr,
    { ...WBASE, answers: { at: "precondition", text: "base fixed to the merge-base" } },
    resp,
  );
  assert.ok(again.find("reviewer-retry").prompt.includes("base fixed to the merge-base"));
  assert.equal(again.res.verdict, "approve");
});

await test("wr N5: a fixer precondition failure stops the run", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("I1", "important")]),
      fixer: work("h", { status: "BLOCKED", commits: [], preconditionFailed: "HEAD moved" }),
    }),
  );
  assert.equal(r.res.stopped, "precondition");
  assert.ok(!r.labels.includes("progress"));
});

await test("wr N5: a wrong artifactPath throws at start", async () => {
  await assert.rejects(
    run(wr, { ...WBASE, artifactPath: "docs/reviews/pr-31.md" }, wrResponder()),
    /artifactPath/,
  );
});

// ---------- fix pass 3: answers history (R1), clean-tree message (R3) ----------
await test("sdd R1: two stops (implementer NEEDS_CONTEXT, then a ruler escalation) complete without a stale replay", async () => {
  const resp = sddResponder({
    implementer: work("h0", { status: "NEEDS_CONTEXT", commits: [], questions: ["Which key?"] }),
    "spec-review": {
      verdict: "fail",
      findings: [F("S1", "important", { planMandated: true })],
      cannotVerify: [],
    },
    "ruler-review": (p) =>
      p.includes("ANS-2")
        ? {
            rulings: [
              {
                item: "spec:S1",
                decision: "fix",
                reason: "answered",
                costIfWrong: "c",
                fixInstruction: "fi",
              },
            ],
          }
        : {
            rulings: [{ item: "spec:S1", decision: "escalate", reason: "guess", costIfWrong: "c" }],
          },
  });
  const run1 = await run(sdd, BASE, resp);
  assert.equal(run1.res.stopped, "implementer");
  const e1 = { at: "implementer", text: "ANS-1" };
  const run2 = await run(sdd, { ...BASE, answers: [e1] }, resp);
  assert.equal(run2.res.stopped, "ruler-review");
  const run3 = await run(
    sdd,
    { ...BASE, answers: [e1, { at: "ruler-review", text: "ANS-2" }] },
    resp,
  );
  for (const l of ["implementer", "implementer-continue", "spec-review", "quality-review"]) {
    assert.equal(
      run3.find(l).prompt,
      run2.find(l).prompt,
      `${l} prompt changed between run 2 and run 3`,
    );
  }
  assert.ok(run3.find("implementer-continue").prompt.includes("ANS-1"));
  assert.ok(!run3.find("implementer-continue").prompt.includes("ANS-2"));
  assert.ok(run3.find("ruler-review").prompt.includes("ANS-2"));
  assert.ok(!run3.find("ruler-review").prompt.includes("ANS-1"));
  assert.equal(run3.res.status, "complete");
  assert.ok(!run3.res.answersUnconsumed);
});

await test("sdd R1: a single answers object is a one-entry list; every entry's at is validated", async () => {
  const resp = sddResponder({
    implementer: work("h0", { status: "NEEDS_CONTEXT", commits: [], questions: ["q"] }),
  });
  const obj = await run(sdd, { ...BASE, answers: { at: "implementer", text: "X" } }, resp);
  const list = await run(sdd, { ...BASE, answers: [{ at: "implementer", text: "X" }] }, resp);
  assert.equal(obj.find("implementer-continue").prompt, list.find("implementer-continue").prompt);
  await assert.rejects(
    run(
      sdd,
      {
        ...BASE,
        answers: [
          { at: "implementer", text: "X" },
          { at: "nowhere", text: "Y" },
        ],
      },
      resp,
    ),
    /answers\[1\]\.at "nowhere"/,
  );
});

await test("sdd R1: decisions from all entries apply, later over earlier", async () => {
  const answers = [
    { at: "ruler-review", decisions: [{ item: "critic:C1", decision: "stands", reason: "first" }] },
    {
      at: "fixer-r1",
      decisions: [
        { item: "critic:C1", decision: "fix", reason: "second", fixInstruction: "later wins" },
      ],
    },
  ];
  const r = await run(
    sdd,
    { ...BASE, sensitive: true, answers },
    sddResponder({ "critic-review": criticC1 }),
  );
  assert.ok(r.find("fixer-r1").prompt.includes("later wins"));
  assert.equal(r.res.rulings.find((x) => x.item === "critic:C1").reason, "second");
});

await test("sdd R3: the clean-tree precondition asks for the untracked and modified files by name", async () => {
  const r = await run(sdd, BASE, sddResponder());
  assert.ok(/name each untracked or modified file/i.test(r.find("implementer").prompt));
});

await test("wr R1: two stops (precondition, then a ruler escalation) complete without a stale replay", async () => {
  const resp = wrResponder({
    reviewer: { ...reviewWith([]), preconditionFailed: "dirty tree: ?? docs/reviews/pr-32.md" },
    "reviewer-retry": reviewWith([WF("C1", "critical", { planMandated: true })]),
    ruler: { rulings: [{ item: "C1", decision: "stands", reason: "plan", costIfWrong: "c" }] },
  });
  const run1 = await run(wr, WBASE, resp);
  assert.equal(run1.res.stopped, "precondition");
  assert.equal(run1.res.stopPoint, "precondition:reviewer");
  const e1 = { at: "precondition", text: "PRE-1" };
  const run2 = await run(wr, { ...WBASE, answers: [e1] }, resp);
  assert.equal(run2.res.stopped, "ruler");
  const e2 = {
    at: "ruler",
    text: "RUL-2",
    decisions: [{ item: "C1", decision: "fix", reason: "real", fixInstruction: "fix C1" }],
  };
  const run3 = await run(wr, { ...WBASE, answers: [e1, e2] }, resp);
  for (const l of ["reviewer", "reviewer-retry"]) {
    assert.equal(
      run3.find(l).prompt,
      run2.find(l).prompt,
      `${l} prompt changed between run 2 and run 3`,
    );
  }
  assert.ok(run3.find("reviewer-retry").prompt.includes("PRE-1"));
  assert.ok(!run3.find("reviewer-retry").prompt.includes("RUL-2"));
  assert.ok(
    run3.find("fixer").prompt.includes("RUL-2") && run3.find("fixer").prompt.includes("fix C1"),
  );
  assert.ok(!run3.find("fixer").prompt.includes("PRE-1"));
  assert.equal(run3.res.verdict, "approve");
});

await test("wr R3: the reviewer precondition names files and calls out a stray artifact", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({ reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true } }),
  );
  const p = r.find("reviewer").prompt;
  assert.ok(/name each untracked or modified file/i.test(p));
  assert.ok(p.includes("stray artifact") && p.includes("docs/reviews/pr-32.md"));
});

await test("sdd R2: implemented { head } skips the implementer and reviews base..head (review stages only)", async () => {
  const r = await run(sdd, { ...BASE, implemented: { head: "cafe1234cafe1234" } }, sddResponder());
  assert.ok(!r.labels.includes("implementer"), r.labels.join(","));
  assert.deepEqual(r.labels, ["spec-review", "quality-review", "gate-0"]);
  assert.ok(r.find("spec-review").prompt.includes("aaaaaaa1111..cafe1234cafe1234"));
  assert.equal(r.res.status, "complete");
  await assert.rejects(run(sdd, { ...BASE, implemented: {} }, sddResponder()), /implemented\.head/);
  await assert.rejects(
    run(
      sdd,
      { ...BASE, implemented: { head: "x" }, answers: [{ at: "implementer", text: "t" }] },
      sddResponder(),
    ),
    /implemented/,
  );
});

// ---------- post-pilot (09-26-26): items 1 to 10 of the post-pilot brief ----------
const NO_REMOTE =
  "Never run git push, gh pr (any subcommand), gh api writes, or git merge into another branch; the controller and the developer own the remote.";
const neverAddressed = (p) => ({
  verdicts: ids(p).map((id) => ({ id, verdict: "NOT ADDRESSED", evidence: "a.ts:1" })),
  newFindings: [],
  outOfScope: [],
});
// Runs that between them reach every sdd-task agent that can run shell commands.
async function shellRuns() {
  const loop = await run(
    sdd,
    BASE,
    sddResponder({
      implementer: work("h0", { concerns: [{ kind: "correctness", text: "unsure" }] }),
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "re-review*": neverAddressed,
    }),
  );
  let gates = 0;
  const gate = await run(
    sdd,
    BASE,
    sddResponder({
      "gate*": () =>
        ++gates === 1 ? { ok: false, head: "h", problems: ["lint red"] } : GATE_OK("h2"),
    }),
  );
  const cont = await run(
    sdd,
    { ...BASE, answers: { at: "implementer", text: "A" } },
    sddResponder({
      implementer: work("h0", { status: "NEEDS_CONTEXT", commits: [], questions: ["q"] }),
    }),
  );
  const retry = await run(
    sdd,
    { ...BASE, answers: { at: "precondition", text: "fixed" } },
    sddResponder({
      implementer: work("h", { status: "BLOCKED", commits: [], preconditionFailed: "dirty" }),
      "implementer-retry": work("h-retry"),
    }),
  );
  const calls = [loop, gate, cont, retry].flatMap((r) => r.calls);
  return { loop, gate, cont, retry, calls };
}

await test("sdd P1: every gate runs pnpm lint, pnpm typecheck and pnpm coverage, never pnpm test", async () => {
  const { calls } = await shellRuns();
  const gates = calls.filter((c) => c.label.startsWith("gate"));
  assert.ok(
    gates.some((c) => c.label === "gate-r1"),
    "no gate-r1 in the runs",
  );
  for (const g of gates) {
    for (const cmd of ["pnpm lint", "pnpm typecheck", "pnpm coverage"])
      assert.ok(g.prompt.includes(cmd), `${g.label} lacks ${cmd}`);
    assert.ok(!/pnpm test\b/.test(g.prompt), `${g.label} still runs pnpm test`);
  }
});

await test("sdd P2: reviewers are told the gate runs lint, typecheck and coverage; never cannot-verify", async () => {
  const r = await run(sdd, { ...BASE, sensitive: true }, sddResponder());
  for (const l of ["spec-review", "quality-review", "critic-review"]) {
    const p = r.find(l).prompt;
    assert.ok(
      p.includes(
        "never list lint, typecheck, tests, coverage or the report's test counts as cannotVerify",
      ),
      `${l} lacks the cannot-verify exclusion`,
    );
    assert.ok(
      !/the check the ruler should run/.test(p),
      `${l} still sends cannot-verify to the ruler`,
    );
  }
});

await test("sdd P5: every shell-running agent is told never to push, open a PR or merge; wave-review fixer too", async () => {
  const { calls } = await shellRuns();
  const want = [
    "implementer",
    "implementer-continue",
    "implementer-retry",
    "fixer-pre",
    "fixer-r1",
    "fixer-r4",
    "gate-0",
    "gate-r1",
  ];
  for (const l of want) {
    const c = calls.find((x) => x.label === l);
    assert.ok(c, `no ${l} call in the runs`);
    assert.ok(c.prompt.includes(NO_REMOTE), `${l} lacks the no-remote rule`);
  }
  const w = await run(wr, WBASE, wrResponder({ reviewer: reviewWith([WF("I1", "important")]) }));
  assert.ok(
    w.find("fixer").prompt.includes(NO_REMOTE),
    "wave-review fixer lacks the no-remote rule",
  );
});

await test("sdd P8: implementer, continue, retry and every fixer self-check lint and coverage before each commit", async () => {
  const { calls } = await shellRuns();
  const want = [
    "implementer",
    "implementer-continue",
    "implementer-retry",
    "fixer-pre",
    "fixer-r1",
    "fixer-r4",
  ];
  for (const l of want) {
    const p = calls.find((x) => x.label === l).prompt;
    assert.ok(p.includes("Before each commit run pnpm lint"), `${l} lacks the lint self-check`);
    assert.ok(p.includes("pnpm exec biome format --write <files>"), `${l} lacks the format fix`);
    assert.ok(p.includes("pnpm coverage"), `${l} lacks pnpm coverage`);
    assert.ok(/do not commit on red/i.test(p), `${l} lacks "do not commit on red"`);
  }
});

await test("sdd P4: critic: true turns the critic on for an ordinary task with the default focus, tiers unchanged", async () => {
  const r = await run(
    sdd,
    { ...BASE, critic: true },
    sddResponder({
      "spec-review": {
        verdict: "fail",
        findings: [F("S1", "important", { planMandated: true })],
        cannotVerify: [],
      },
    }),
  );
  const c = r.find("critic-review");
  assert.ok(c, r.labels.join(","));
  assert.equal(`${c.model}/${c.effort}`, "opus/medium");
  assert.ok(
    c.prompt.includes(
      "Focus: correctness and security risk: fail-open paths, data that crosses a trust boundary (server to client, config to audit), contract drift from the spec, tests that cannot fail.",
    ),
    c.prompt,
  );
  assert.equal(`${r.find("implementer").model}/${r.find("implementer").effort}`, "sonnet/medium");
  assert.equal(`${r.find("ruler-review").model}/${r.find("ruler-review").effort}`, "opus/low");
  assert.ok(!r.find("ruler-review").prompt.includes(SENSITIVE_RULE));
  const off = await run(sdd, BASE, sddResponder());
  assert.ok(!off.labels.includes("critic-review"));
});

await test("sdd P4: criticFocus replaces the default focus, and is appended on sensitive or UI tasks", async () => {
  const o = await run(sdd, { ...BASE, critic: true, criticFocus: "ZZ-FOCUS" }, sddResponder());
  const op = o.find("critic-review").prompt;
  assert.ok(op.includes("Focus: ZZ-FOCUS."), op);
  assert.ok(!op.includes("fail-open paths, data that crosses"));
  const s = await run(sdd, { ...BASE, sensitive: true, criticFocus: "ZZ-FOCUS" }, sddResponder());
  const sp = s.find("critic-review").prompt;
  assert.ok(sp.includes("sensitive-code risk") && sp.includes("; ZZ-FOCUS."), sp);
  const u = await run(sdd, { ...BASE, ui: true }, sddResponder());
  assert.ok(u.find("critic-review").prompt.includes("Focus: UI risk"));
});

await test("sdd P4: critic must be a boolean and criticFocus a non-empty string", async () => {
  await assert.rejects(run(sdd, { ...BASE, critic: "yes" }, sddResponder()), /critic/);
  await assert.rejects(run(sdd, { ...BASE, criticFocus: "  " }, sddResponder()), /criticFocus/);
  await assert.rejects(run(sdd, { ...BASE, criticFocus: 3 }, sddResponder()), /criticFocus/);
});

const specS1Mandated = {
  verdict: "fail",
  findings: [F("S1", "important", { planMandated: true })],
  cannotVerify: [],
};

await test("sdd P7: gate-0 runs in parallel with the reviewers on the review head, before any ruler", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      implementer: work("h0", { concerns: [{ kind: "correctness", text: "unsure" }] }),
      "spec-review": specS1Mandated,
    }),
  );
  const at = (l) => r.labels.indexOf(l);
  assert.ok(
    at("gate-0") > at("quality-review") && at("gate-0") < at("ruler-review"),
    r.labels.join(","),
  );
  assert.ok(
    r.find("gate-0").prompt.includes("equals h-progress-pre"),
    "gate-0 not on the review head",
  );
  assert.ok(r.find("spec-review").prompt.includes("head h-progress-pre"));
  assert.equal(r.labels.filter((l) => l.startsWith("gate")).join(","), "gate-0,gate-r1");
  assert.equal(r.res.status, "complete");
});

await test("sdd P7: gate-0 problems join the reviewer findings in one fix round; the re-reviewer runs", async () => {
  let gates = 0;
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "gate*": () =>
        ++gates === 1
          ? { ok: false, head: "h-impl", problems: ["pnpm coverage: branches 93% < 95%"] }
          : GATE_OK("h-final"),
    }),
  );
  const fx = r.find("fixer-r1").prompt;
  assert.ok(fx.includes("[spec:S1]") && fx.includes("[gate-0:1]"), fx);
  assert.ok(r.labels.includes("re-review-r1"), r.labels.join(","));
  assert.ok(!r.labels.includes("fixer-r2"), r.labels.join(","));
  assert.ok(
    r.logs.some((l) => /round 1 .*re-reviewer runs/.test(l)),
    r.logs.join(" | "),
  );
  assert.equal(r.res.status, "complete");
});

await test("sdd P7: a clean review and a green gate-0 complete with no further gate", async () => {
  const r = await run(sdd, BASE, sddResponder());
  assert.equal(r.labels.filter((l) => l.startsWith("gate")).join(","), "gate-0");
  assert.equal(r.res.status, "complete");
});

await test("sdd P7: a gate-0 precondition failure stops after the parallel reviewers; answers retry the gate", async () => {
  const resp = sddResponder({
    "spec-review": specS1Mandated,
    "gate-0": {
      ok: false,
      head: "zzz",
      problems: [],
      preconditionFailed: "HEAD zzz, expected h-impl",
    },
    "gate-0-retry": GATE_OK("h-impl"),
  });
  const r = await run(sdd, BASE, resp);
  assert.equal(r.res.stopped, "precondition");
  assert.equal(r.res.stopPoint, "precondition:gate-0");
  assert.ok(r.labels.includes("spec-review") && r.labels.includes("quality-review"));
  assert.ok(!r.labels.includes("ruler-review") && !r.labels.some((l) => l.startsWith("fixer")));
  const again = await run(
    sdd,
    { ...BASE, answers: [{ at: "precondition:gate-0", text: "HEAD reset" }] },
    resp,
  );
  assert.ok(again.find("gate-0-retry").prompt.includes("HEAD reset"));
  assert.equal(again.find("spec-review").prompt, r.find("spec-review").prompt);
  assert.equal(again.res.status, "complete");
});

await test("sdd P7: review stages only (implemented) runs gate-0 in parallel on implemented.head", async () => {
  const r = await run(
    sdd,
    { ...BASE, implemented: { head: "cafe1234cafe1234" } },
    sddResponder({ "spec-review": specS1Mandated }),
  );
  assert.equal(r.labels.slice(0, 3).join(","), "spec-review,quality-review,gate-0");
  assert.ok(r.find("gate-0").prompt.includes("equals cafe1234cafe1234"));
});

await test("sdd P9: a gate-only fix round skips the re-reviewer; progress and gate-r<r> decide", async () => {
  let gates = 0;
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "gate*": () =>
        ++gates <= 2 ? { ok: false, head: "h", problems: ["lint red"] } : GATE_OK("h3"),
    }),
  );
  assert.ok(!r.labels.some((l) => l.startsWith("re-review")), r.labels.join(","));
  assert.ok(r.labels.includes("gate-r1") && r.labels.includes("gate-r2"), r.labels.join(","));
  assert.ok(
    r.logs.some((l) => /round 1 is mechanical .*re-reviewer skipped/.test(l)),
    r.logs.join(" | "),
  );
  assert.equal(r.res.status, "complete");
  const p = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "progress-r1": {
        ok: false,
        problems: ["tree dirty"],
        head: "hp",
        newCommits: [],
        testCount: 10,
      },
    }),
  );
  assert.ok(
    p.labels.includes("re-review-r1") && !p.labels.includes("re-review-r2"),
    p.labels.join(","),
  );
  assert.ok(p.find("fixer-r2").prompt.includes("[progress-r1-1]"));
});

const specCV = (n = 1) => ({
  verdict: "pass",
  findings: [],
  cannotVerify: Array.from({ length: n }, (_, k) => ({
    item: `item ${k + 1}`,
    check: `check ${k + 1}`,
  })),
});

await test("sdd P6: a cannot-verify item goes to the checker (sonnet/low), not the ruler; verified is a checker ruling", async () => {
  for (const sensitive of [false, true]) {
    const r = await run(sdd, { ...BASE, sensitive }, sddResponder({ "spec-review": specCV() }));
    const c = r.find("checker");
    assert.ok(c, r.labels.join(","));
    assert.equal(`${c.model}/${c.effort}`, "sonnet/low");
    assert.deepEqual(ids(c.prompt), ["spec:CV1"]);
    assert.ok(c.prompt.includes("check 1"));
    assert.ok(
      /read-only/i.test(c.prompt) && /never edit/i.test(c.prompt) && /commit/.test(c.prompt),
    );
    assert.ok(!r.labels.some((l) => l.startsWith("ruler")), r.labels.join(","));
    const ruling = r.res.rulings.find((x) => x.item === "spec:CV1");
    assert.equal(ruling.source, "checker");
    assert.equal(ruling.decision, "verified");
    assert.ok(r.res.ledgerLines.some((l) => l.includes("Ruling (checker): ")));
    assert.equal(r.res.status, "complete");
  }
});

await test("sdd P6: a failed check is an open important finding; the fix round gets a re-reviewer", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({ "spec-review": specCV(), checker: checkAll("failed") }),
  );
  assert.ok(!r.labels.some((l) => l.startsWith("ruler")), r.labels.join(","));
  assert.ok(r.find("fixer-r1").prompt.includes("[spec:CV1] IMPORTANT"), r.find("fixer-r1").prompt);
  assert.ok(r.labels.includes("re-review-r1"));
  assert.equal(r.res.status, "complete");
});

await test("sdd P6: needsJudgment and unanswered items go to the ruler; the ruler runs only then", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": specCV(3),
      checker: () => ({
        results: [
          { id: "spec:CV1", result: "verified", evidence: "ok" },
          { id: "spec:CV2", result: "needsJudgment", evidence: "ambiguous" },
        ],
      }),
    }),
  );
  assert.deepEqual(ids(r.find("ruler-review").prompt).sort(), ["spec:CV2", "spec:CV3"]);
  assert.ok(r.find("ruler-review").prompt.includes("ambiguous"));
  const dead = await run(sdd, BASE, sddResponder({ "spec-review": specCV(), checker: null }));
  assert.deepEqual(ids(dead.find("ruler-review").prompt), ["spec:CV1"]);
});

await test("sdd P6: a controller-decided cannot-verify item never reaches the checker", async () => {
  const answers = {
    at: "review",
    decisions: [{ item: "spec:CV1", decision: "verified", reason: "controller ran it" }],
  };
  const r = await run(sdd, { ...BASE, answers }, sddResponder({ "spec-review": specCV() }));
  assert.ok(
    !r.labels.includes("checker") && !r.labels.some((l) => l.startsWith("ruler")),
    r.labels.join(","),
  );
  assert.equal(r.res.rulings.find((x) => x.item === "spec:CV1").source, "controller");
  const two = await run(sdd, { ...BASE, answers }, sddResponder({ "spec-review": specCV(2) }));
  assert.deepEqual(ids(two.find("checker").prompt), ["spec:CV2"]);
});

await test("sdd P10: no ledger agent; ledgerLines are returned and the controller appends them", async () => {
  const r = await run(sdd, BASE, sddResponder());
  assert.ok(!r.labels.includes("ledger"), r.labels.join(","));
  assert.ok(r.res.ledgerLines.length > 0);
  assert.ok(
    r.logs.includes(
      `ledger: controller appends ${r.res.ledgerLines.length} lines to C:/w/progress.md`,
    ),
    r.logs.join(" | "),
  );
  const none = await run(sdd, { ...BASE, ledgerPath: undefined }, sddResponder());
  assert.ok(none.res.ledgerLines.length > 0);
  assert.ok(!none.labels.includes("ledger"));
});

await test("sdd P10: a roles.ledger override is logged as ignored, never thrown", async () => {
  const r = await run(sdd, { ...BASE, roles: { ledger: { model: "haiku" } } }, sddResponder());
  assert.ok(
    r.logs.some((l) => /roles\.ledger .*ignored/.test(l)),
    r.logs.join(" | "),
  );
  assert.ok(!r.logs.some((l) => /ledger haiku/.test(l)), "roles log still lists a ledger role");
  assert.equal(r.res.status, "complete");
});

const AL_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "append-ledger.mjs");
await test("append-ledger: finds ledgerLines in a bare result, wrapped text and escaped JSON", async () => {
  const al = await import(new URL("./append-ledger.mjs", import.meta.url).href);
  const res = (await run(sdd, BASE, sddResponder())).res;
  const lines = res.ledgerLines;
  assert.deepEqual(al.findLedgerLines(JSON.stringify(res, null, 2)), lines);
  assert.deepEqual(
    al.findLedgerLines(`Workflow finished.\n\`\`\`json\n${JSON.stringify(res)}\n\`\`\`\ndone`),
    lines,
  );
  assert.deepEqual(
    al.findLedgerLines(JSON.stringify({ status: "completed", output: JSON.stringify(res) })),
    lines,
  );
  assert.deepEqual(
    al.findLedgerLines(`${JSON.stringify({ ledgerLines: ["old"] })}\n${JSON.stringify(res)}`),
    lines,
    "the last result wins",
  );
  assert.equal(al.findLedgerLines('{"task": 7}'), null);
  assert.equal(al.findLedgerLines("no json here"), null);
  assert.equal(al.appendText("a\n", ["x", "y"]), "x\ny\n");
  assert.equal(al.appendText("a", ["x"]), "\nx\n");
  assert.equal(al.appendText("", ["x"]), "x\n");
  assert.equal(al.appendText("a\r\n", ["x", "y"]), "x\r\ny\r\n");
});

await test("append-ledger: exits 2 on a usage error and 3 when no ledgerLines are found", async () => {
  const usage = spawnSync(process.execPath, [AL_PATH], { encoding: "utf8" });
  assert.equal(usage.status, 2, usage.stderr);
  assert.ok(/usage/i.test(usage.stderr));
  const missing = spawnSync(process.execPath, [AL_PATH, "no-such-output.json", "l.md"], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 2, missing.stderr);
  const pkg = path.resolve(path.dirname(AL_PATH), "../../package.json");
  const none = spawnSync(process.execPath, [AL_PATH, pkg, "no-such-ledger.md"], {
    encoding: "utf8",
  });
  assert.equal(none.status, 3, none.stderr);
});

await test("README P3: a resume re-passes the full args; stopping mid-review loses the reviewers' work", async () => {
  const readme = fs.readFileSync(path.join(WF_DIR, "README.md"), "utf8");
  assert.ok(readme.includes("{ scriptPath, resumeFromRunId, args }"), "resume call shape missing");
  assert.ok(/without `args` throws at the first required-arg check/.test(readme));
  assert.ok(/partial work/.test(readme) && /cheap place to intervene is at a stop/.test(readme));
  assert.ok(readme.includes("node scripts/sdd/append-ledger.mjs"), "append-ledger not documented");
  assert.ok(!/\| ledger \|/.test(readme), "README still lists a ledger role");
});

// ---------- report ----------
let failed = 0;
for (const [ok, name, err] of results) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n     ${err}`}`);
  if (!ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
