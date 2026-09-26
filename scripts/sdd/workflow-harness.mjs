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
const LEDGER_OK = { ok: true, linesAppended: 1 };
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
    if (label.startsWith("fixer")) return work(`h-${label}`);
    if (label.startsWith("progress")) return progress(label);
    if (label.startsWith("re-review")) return addressAll(prompt);
    if (label.startsWith("gate")) return GATE_OK(`h-${label}`);
    if (label === "ledger") return LEDGER_OK;
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
await test("sdd: happy path runs implementer, spec, quality, gate, ledger and completes", async () => {
  const r = await run(sdd, BASE, sddResponder());
  assert.deepEqual(r.labels, ["implementer", "spec-review", "quality-review", "gate-0", "ledger"]);
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
    "re-review-r1",
    "gate-r1",
    "ledger",
  ]);
  assert.ok(r.find("fixer-r1").prompt.includes("pnpm lint: 2 errors"));
  assert.equal(r.res.status, "complete");
  assert.equal(r.res.rounds, 1);
});

await test("sdd: gate failing every round parks at the cap (worst case 30 agents at maxRounds 5)", async () => {
  const r = await run(
    sdd,
    { ...BASE, sensitive: true, ui: true },
    sddResponder({
      implementer: work("h0", { concerns: [{ kind: "correctness", text: "unsure" }] }),
      "spec-review": { verdict: "pass", findings: [], cannotVerify: [{ item: "i", check: "c" }] },
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
  assert.equal(r.calls.length, 30, r.labels.join(","));
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
    /answers\.at/,
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
  assert.deepEqual(r.labels, ["implementer", "ledger"]);
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

// ---------- report ----------
let failed = 0;
for (const [ok, name, err] of results) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n     ${err}`}`);
  if (!ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
