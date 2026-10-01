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
//
// Options (for a RED proof, task 602 round 3):
//   --workflows-dir <dir>  load sdd-task.js, wave-review.js, sdd-wave.js and README.md from <dir>
//                          instead of .claude/workflows (e.g. a pre-change copy from git show, or a
//                          mutated copy), so a scenario can be seen failing without touching the tree.
//   --only <text>          run only the scenarios whose name contains <text>.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function optArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`workflow-harness: ${name} needs a value`);
    process.exit(2);
  }
  return v;
}
const WF_DIR_ARG = optArg("--workflows-dir");
const ONLY = optArg("--only");
const WF_DIR = WF_DIR_ARG ? path.resolve(WF_DIR_ARG) : path.join(REPO_ROOT, ".claude/workflows");
if (WF_DIR_ARG) console.log(`workflow-harness: workflows from ${WF_DIR}`);

async function load(file) {
  const src = fs.readFileSync(path.join(WF_DIR, file), "utf8");
  const metaAt = src.indexOf("export const meta");
  const bodyAt = src.indexOf("\n}\n", metaAt) + 3;
  const wrapped = `${src.slice(0, bodyAt)}export default async function __wf__(agent, parallel, pipeline, phase, log, args, budget, workflow) {\n${src.slice(bodyAt)}\n}\n`;
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

// sub: the module a nested workflow({ scriptPath }) call runs (sdd-wave nests sdd-task); its
// agents go through the same stub, and childArgs records every nested call's args.
async function run(mod, args, responder, sub = null) {
  const calls = [];
  const logs = [];
  const childArgs = [];
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
  const nested = async () => {
    throw new Error("workflow(): nesting is one level only");
  };
  const workflow = async (ref, a) => {
    assert.ok(sub, "workflow() called with no sub-workflow module");
    assert.ok(ref && typeof ref.scriptPath === "string", "workflow() needs { scriptPath }");
    childArgs.push({ scriptPath: ref.scriptPath, args: a });
    return sub.default(
      agent,
      parallel,
      null,
      () => {},
      (m) => logs.push(m),
      a,
      {},
      nested,
    );
  };
  const res = await mod.default(
    agent,
    parallel,
    null,
    () => {},
    (m) => logs.push(m),
    args,
    {},
    workflow,
  );
  // labels leaves out the verify-head-* agents (#222: one Haiku git read after each stage that
  // commits) so the flow assertions read as before; calls and verifyLabels carry them, and every
  // agent-count assertion counts them through calls.length.
  const isVerify = (l) => l.startsWith("verify-head");
  const labels = calls.map((c) => c.label).filter((l) => !isVerify(l));
  const verifyLabels = calls.map((c) => c.label).filter(isVerify);
  const find = (l) => calls.find((c) => c.label === l);
  return { res, calls, logs, labels, verifyLabels, find, childArgs };
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
  // The scenarios below were written against five fix rounds; the default (2) has its own scenario.
  maxRounds: 5,
};
const SENSITIVE_RULE =
  "escalate any ruling that would: (a) weaken a security, audit, credential, delegation or dispatch invariant; (b) change a shape frozen at a phase gate or listed as a contract file (master plan 8.2); (c) keep a Critical finding with stands. Everything else it rules.";

// Generic sdd-task responder; override per label with `over`.
// Agents that run after gate-0 (checker, ruler-review) report head and treeClean; the script
// compares head with the gate-0 head. Unless a test sets head itself, the fixture reports the
// head the prompt expects and a clean tree.
const expectedHead = (p) => (/git rev-parse HEAD must equal (\S+?)\./.exec(p) || [])[1];
const POST_GATE = /^(checker|ruler-review)/;
function postFill(label, prompt, r) {
  if (!r || typeof r !== "object") return r;
  if (POST_GATE.test(label) && !("head" in r))
    return {
      ...r,
      head: expectedHead(prompt) || "no-expected-head",
      treeClean: true,
      dirtyFiles: [],
    };
  if (label.startsWith("progress") && !("guardHits" in r)) return { ...r, guardHits: [] };
  return r;
}
// verifyHead (#222): the script takes every head from a "verify-head-*" agent that reads git. The
// fixture plays git: it answers with a 40-hex sha derived from the head the last agent reported
// (a 40-hex head passes through unchanged), so a scenario that sets a head sees it back as hex40(head).
// A scenario overrides "verify-head*" to play a lying agent or a broken git.
const hex40 = (h) =>
  /^[0-9a-f]{40}$/.test(h) ? h : crypto.createHash("sha1").update(String(h)).digest("hex");
// A review-stages-only run (implemented: { head }) has no implementer, so the fixture's git HEAD is
// the implemented head: gitAt(head) overrides the first verify.
// A 40-hex implemented head: git reports it unchanged, so it matches (critic M3 on #222).
const IMPL_HEAD = "cafe1234".repeat(5);
const gitAt = (h) => ({
  "verify-head-impl": { revParse: `${hex40(h)}\n`, catFile: `EXISTS ${hex40(h)}\n` },
});
function sddResponder(over = {}) {
  const ctx = { lastHead: BASE.base };
  const base = sddBase(over, ctx);
  return (label, prompt, calls) => {
    const r = postFill(label, prompt, base(label, prompt, calls));
    // only the agents that commit set the git head; gates, the checker and rulers merely report it
    if (
      r &&
      typeof r === "object" &&
      typeof r.head === "string" &&
      /^(implementer|fixer|progress)/.test(label)
    )
      ctx.lastHead = r.head;
    return r;
  };
}
// Every tier runs one reviewer ("combined-review", #391) carrying the spec, quality and critic
// lenses. Unless a test overrides "combined-review" itself, the fixture answers it by merging the
// "spec-review", "quality-review" and "critic-review" answers (PASS when not overridden), each
// finding and cannot-verify item tagged with its kind, so a scenario reads the same on every tier.
function combineReviews(get) {
  const parts = [
    [get("spec-review"), "spec"],
    [get("quality-review"), "quality"],
    [get("critic-review"), "critic"],
  ];
  if (parts.some(([r]) => !r)) return null;
  const tag = (r, kind) => ({
    findings: r.findings.map((f) => ({ ...f, kind })),
    cannotVerify: r.cannotVerify.map((c) => ({ ...c, kind })),
  });
  const tagged = parts.map(([r, kind]) => tag(r, kind));
  return {
    verdict: parts.some(([r]) => r.verdict === "fail") ? "fail" : "pass",
    findings: tagged.flatMap((t) => t.findings),
    cannotVerify: tagged.flatMap((t) => t.cannotVerify),
  };
}
function sddBase(over, ctx = { lastHead: BASE.base }) {
  const self = (label, prompt, calls) => {
    if (label === "combined-review" && !("combined-review" in over))
      return combineReviews((l) => self(l, prompt, calls));
    for (const [k, v] of Object.entries(over)) {
      if (label === k || (k.endsWith("*") && label.startsWith(k.slice(0, -1)))) {
        return typeof v === "function" ? v(prompt, calls, label) : v;
      }
    }
    if (label.startsWith("verify-head"))
      return { revParse: `${hex40(ctx.lastHead)}\n`, catFile: `EXISTS ${hex40(ctx.lastHead)}\n` };
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
  return self;
}

// ---------- runner ----------
const results = [];
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    await fn();
    results.push([true, name]);
  } catch (e) {
    results.push([false, name, e.message]);
  }
}

const sdd = await load("sdd-task.js");
const wr = await load("wave-review.js");
const wave = await load("sdd-wave.js");

// ================= sdd-task =================
await test("sdd: happy path runs implementer, the combined reviewer and gate-0, and completes", async () => {
  const r = await run(sdd, BASE, sddResponder());
  assert.deepEqual(r.labels, ["implementer", "combined-review", "gate-0"]);
  assert.equal(r.res.status, "complete");
  assert.equal(r.find("gate-0").model, "sonnet");
  assert.equal(r.find("gate-0").effort, "low");
  assert.ok(
    /pnpm lint/.test(r.find("gate-0").prompt) && /pnpm typecheck/.test(r.find("gate-0").prompt),
  );
  // the head comes from verifyHead (git), not from the gate: the fixture's git head for h-impl
  assert.equal(r.res.head, hex40("h-impl"));
  assert.deepEqual(r.verifyLabels, ["verify-head-impl"]);
  assert.equal(r.calls.length, 4);
});

// #222: heads come from git (verifyHead), never from an implementer, fixer, progress checker or gate.
await test("sdd: fabricated-head: a head the fixer and progress checker report is never used, git's is", async () => {
  const LIE = "2e31c7761aecdcf5d0f0a1e0a3f9e1a5f6c5e6a1";
  const GIT = "2e31c77c6d9b971f6afc69a7ff4a714fb5315268";
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "fixer-r1": () => work(LIE),
      "progress-r1": () => ({ ...progress("progress-r1"), head: LIE }),
      "verify-head-r1": { revParse: `${GIT}\n`, catFile: `EXISTS ${GIT}\n` },
    }),
  );
  const gate = r.find("gate-r1").prompt;
  assert.ok(gate.includes(`equals ${GIT} `), "gate-r1 expectedHead was not the git head");
  assert.ok(!gate.includes(LIE), "gate-r1 prompt carries the fabricated head");
  assert.ok(
    r.logs.includes("agent-reported head 2e31c7761aecdcf5... differs from git; using git"),
    r.logs.join("\n"),
  );
  assert.equal(r.res.status, "complete");
  assert.equal(r.res.head, GIT);
  // the verifyHead role is Haiku and gets no effort, and its prompt never carries the reported head
  assert.equal(r.find("verify-head-r1").model, "haiku");
  assert.equal(r.find("verify-head-r1").effort, undefined);
  assert.ok(!r.find("verify-head-r1").prompt.includes(LIE));
});

await test("sdd: bad-sha: a verifyHead answer that is not a 40-hex sha stops the run at precondition", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({ "verify-head*": { revParse: "not-a-sha\n", catFile: "EXISTS\n" } }),
  );
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stopped, "precondition");
  assert.equal(r.res.stopPoint, "precondition:verifyHead");
  assert.ok(/verifyHead/.test(r.res.problem), r.res.problem);
  assert.deepEqual(r.labels, ["implementer"]);
  assert.deepEqual(r.verifyLabels, ["verify-head-impl"]);
});

await test("sdd: bad-sha: a 40-hex sha the role could not find in git stops the run at precondition", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({ "verify-head*": { revParse: `${"a".repeat(40)}\n`, catFile: "MISSING\n" } }),
  );
  assert.equal(r.res.stopped, "precondition");
  assert.ok(/verifyHead/.test(r.res.problem), r.res.problem);
  assert.ok(!r.labels.includes("combined-review"));
});

await test("sdd: bad-sha: a cat-file answer for a different sha than revParse stops the run (K1)", async () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const r = await run(
    sdd,
    BASE,
    sddResponder({ "verify-head*": { revParse: `${A}\n`, catFile: `EXISTS ${B}\n` } }),
  );
  assert.equal(r.res.stopped, "precondition");
  assert.equal(r.res.stopPoint, "precondition:verifyHead");
  assert.ok(!r.labels.includes("combined-review"));
  // the second command prints the sha it checked, and the prompt asks for it
  assert.ok(r.find("verify-head-impl").prompt.includes('echo "EXISTS $sha"'));
});

await test("sdd: bad-sha: an implemented.head that git does not report stops at precondition, not a silent swap (critic M3)", async () => {
  const GIT = "d".repeat(40);
  const r = await run(
    sdd,
    { ...BASE, implemented: { head: IMPL_HEAD } },
    sddResponder({ "verify-head-impl": { revParse: `${GIT}\n`, catFile: `EXISTS ${GIT}\n` } }),
  );
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stopPoint, "precondition:verifyHead");
  assert.ok(/implemented\.head/.test(r.res.problem), r.res.problem);
  assert.ok(!r.labels.includes("combined-review"));
});

await test("sdd: bad-sha: a verifyHead stop after the implementer keeps its questions (critic M2)", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      implementer: () => ({ ...work("h-impl"), questions: ["Q-keep"] }),
      "verify-head*": { revParse: "not-a-sha\n", catFile: "MISSING\n" },
    }),
  );
  assert.equal(r.res.stopPoint, "precondition:verifyHead");
  assert.ok(r.res.questions.includes("Q-keep"), JSON.stringify(r.res.questions));
});

await test("sdd: bad-sha: a verifyHead stop in a fix round returns the open findings as parked (critic M4)", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "verify-head-r1": { revParse: "not-a-sha\n", catFile: "MISSING\n" },
    }),
  );
  assert.equal(r.res.stopPoint, "precondition:verifyHead");
  assert.ok(
    r.res.parked.some((f) => /S1/.test(f.id)),
    JSON.stringify(r.res.parked),
  );
});

await test("sdd: bad-sha: an answer at precondition:verifyHead re-runs verifyHead once as -retry", async () => {
  const r = await run(
    sdd,
    { ...BASE, answers: [{ at: "precondition:verifyHead", text: "git repaired" }] },
    sddResponder({
      "verify-head-impl": { revParse: "not-a-sha\n", catFile: "EXISTS\n" },
    }),
  );
  assert.equal(r.res.status, "complete", r.logs.join("\n"));
  assert.ok(r.find("verify-head-impl-retry").prompt.includes("git repaired"));
  assert.equal(r.res.answersUnconsumed, undefined);
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
    "combined-review",
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
// re-review, red gate-r1) and four mechanical rounds (fixer, progress, red gate), plus verifyHead
// after the implementer, the pre-review fixer and each of the five rounds (7, #222).
await test("sdd: gate failing every round parks at the cap (worst case 31 agents at maxRounds 5; #391 one reviewer)", async () => {
  const r = await run(
    sdd,
    { ...BASE, sensitive: true, ui: true, maxAgents: 40 },
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
  assert.equal(r.calls.length, 31, r.labels.join(","));
  assert.equal(r.verifyLabels.length, 7, r.verifyLabels.join(","));
  assert.equal(r.labels.filter((l) => l.startsWith("re-review")).join(","), "re-review-r1");
  assert.equal(r.labels.filter((l) => l.startsWith("gate")).length, 6);
  assert.equal(r.res.status, "parked");
  assert.equal(r.res.rounds, 5);
});

await test("sdd: worst case with every finding NOT ADDRESSED is 29 agents (#391 one reviewer); escalated fixer after a repeat", async () => {
  const r = await run(
    sdd,
    { ...BASE, sensitive: true, ui: true, maxAgents: 40 },
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
  assert.equal(r.calls.length, 29, r.labels.join(","));
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
  for (const l of ["combined-review", "fixer-r1", "re-review-r1"]) {
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
  for (const l of ["implementer", "combined-review"]) {
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

// Developer rule 09-27-26, #391: with no maxRounds arg an ordinary task parks after fix round 1 and a
// gate or critical task after round 2.
await test("sdd: default maxRounds is 1 on ordinary and 2 on gate and critical (#391); open findings then park", async () => {
  const { maxRounds: _unset, ...noCap } = BASE;
  const notAddressed = sddResponder({
    "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
    "re-review*": (p) => ({
      verdicts: ids(p).map((id) => ({ id, verdict: "NOT ADDRESSED", evidence: "a.ts:1" })),
      newFindings: [],
      outOfScope: [],
    }),
  });
  const o = await run(sdd, noCap, notAddressed);
  assert.ok(o.labels.includes("fixer-r1") && !o.labels.includes("fixer-r2"), o.labels.join(","));
  assert.equal(o.res.rounds, 1);
  assert.ok(
    o.logs.some((l) => /cap: maxRounds 1 reached/.test(l)),
    o.logs.join(" | "),
  );
  const r = await run(
    sdd,
    { ...noCap, tier: "gate" },
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "re-review*": (p) => ({
        verdicts: ids(p).map((id) => ({ id, verdict: "NOT ADDRESSED", evidence: "a.ts:1" })),
        newFindings: [],
        outOfScope: [],
      }),
    }),
  );
  assert.ok(r.labels.includes("fixer-r2") && !r.labels.includes("fixer-r3"), r.labels.join(","));
  assert.equal(r.res.status, "parked");
  assert.equal(r.res.rounds, 2);
  assert.ok(
    r.logs.some((l) => /maxRounds 2;/.test(l)),
    r.logs.join(" | "),
  );
  assert.ok(
    r.logs.some((l) => /cap: maxRounds 2 reached/.test(l)),
    r.logs.join(" | "),
  );
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
  assert.ok(c.logs.some((l) => /maxRounds "abc" is not a number; using 1/.test(l)));
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
    { ...BASE, roles: { reviewer: { model: "haiku", effort: "low" } } },
    sddResponder(),
  );
  assert.equal(r.find("combined-review").effort, undefined);
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
  for (const l of ["implementer", "combined-review"]) {
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
  assert.ok(!review.find("combined-review").prompt.includes("ANS-REVIEW"));
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
// verifyHead (#222): the fixture plays git and answers with hex40 of the head the last agent reported.
function wrResponder(over = {}) {
  const ctx = { lastHead: "h0full" };
  const inner = wrInner(over, ctx);
  return (label, prompt) => {
    const r = inner(label, prompt);
    if (r && typeof r === "object" && !label.startsWith("verify-head")) {
      if (typeof r.head === "string") ctx.lastHead = r.head;
      else if (typeof r.reviewedSha === "string" && label !== "re-reviewer")
        ctx.lastHead = r.reviewedSha;
    }
    return r;
  };
}
function wrInner(over, ctx) {
  return (label, prompt) => {
    if (label in over) return typeof over[label] === "function" ? over[label](prompt) : over[label];
    if (label.startsWith("verify-head"))
      return { revParse: `${hex40(ctx.lastHead)}\n`, catFile: `EXISTS ${hex40(ctx.lastHead)}\n` };
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
        reviewedSha: hex40("h1full"),
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
  reviewedSha: hex40("h0full"),
  preconditionFailed: "",
  findings,
  answers: [],
  declined: [],
  artifactWritten: false,
});

// #391 (wave-review side): minor findings alone never start the paid fix pass.
await test("wr: minors-only: a fixes verdict with only minor findings stops at minorsOnly, no ruler, fixer or re-reviewer", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({ reviewer: reviewWith([WF("M1", "minor"), WF("M2", "minor")]) }),
  );
  assert.equal(r.res.verdict, "fixes");
  assert.equal(r.res.stopped, "minorsOnly");
  assert.equal(r.res.artifactWritten, false);
  assert.deepEqual(
    r.res.residual.map((f) => f.id),
    ["M1", "M2"],
  );
  assert.deepEqual(r.labels, ["reviewer"]);
  assert.ok(
    r.logs.some((l) => l.includes("no fix pass for minor findings")),
    r.logs.join("\n"),
  );
  // one important finding still runs the normal flow, minors riding along
  const n = await run(
    wr,
    WBASE,
    wrResponder({ reviewer: reviewWith([WF("I1", "important"), WF("M1", "minor")]) }),
  );
  assert.equal(n.res.stopped, undefined);
  assert.ok(n.labels.includes("fixer"));
});

// #222: wave-review reads reviewedSha and the fix head from git, never from an agent field.
await test("wr: fabricated-head: the fix head and reviewedSha come from git, not the progress checker or re-reviewer", async () => {
  const LIE = "2e31c7761aecdcf5d0f0a1e0a3f9e1a5f6c5e6a1";
  const GIT = "2e31c77c6d9b971f6afc69a7ff4a714fb5315268";
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("I1", "important")]),
      progress: () => ({ ok: true, problems: [], head: LIE, newCommits: [], testCount: 12 }),
      "verify-head-fix": { revParse: `${GIT}\n`, catFile: `EXISTS ${GIT}\n` },
      "re-reviewer": (p) => ({
        verdict: "approve",
        reviewedSha: LIE,
        verdicts: ids(p).map((id) => ({ id, verdict: "ADDRESSED", evidence: "e" })),
        acceptedStands: [],
        newFindings: [],
        artifactWritten: true,
      }),
    }),
  );
  assert.equal(r.res.reviewedSha, GIT);
  assert.ok(
    !r.find("re-reviewer").prompt.includes(LIE),
    "re-reviewer prompt carries the fabricated head",
  );
  assert.ok(r.find("re-reviewer").prompt.includes(GIT));
  assert.ok(r.logs.includes("agent-reported head 2e31c7761aecdcf5... differs from git; using git"));
  assert.deepEqual(r.verifyLabels, ["verify-head-review", "verify-head-fix"]);
  assert.equal(r.find("verify-head-review").model, "haiku");
  assert.equal(r.find("verify-head-review").effort, undefined);
});

await test("wr: bad-sha: a verifyHead answer that is not a 40-hex sha stops the run at precondition:verifyHead", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("I1", "important")]),
      "verify-head-review": { revParse: "not-a-sha\n", catFile: "EXISTS\n" },
    }),
  );
  assert.equal(r.res.stopped, "precondition");
  assert.equal(r.res.stopPoint, "precondition:verifyHead");
  assert.ok(/verifyHead/.test(r.res.problem), r.res.problem);
  assert.deepEqual(r.labels, ["reviewer"]);
  assert.equal(r.res.reviewedSha, null);
  // a clean approve is gated on it too: no reviewedSha returns unverified
  const a = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true },
      "verify-head-review": { revParse: `${"a".repeat(40)}\n`, catFile: "MISSING\n" },
    }),
  );
  assert.equal(a.res.stopped, "precondition");
  assert.equal(a.res.strayArtifact, "docs/reviews/pr-32.md");
});

await test("wr: bad-sha: a cat-file answer for a different sha than revParse stops the run (K1)", async () => {
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("I1", "important")]),
      "verify-head-review": {
        revParse: `${"a".repeat(40)}\n`,
        catFile: `EXISTS ${"b".repeat(40)}\n`,
      },
    }),
  );
  assert.equal(r.res.stopped, "precondition");
  assert.equal(r.res.stopPoint, "precondition:verifyHead");
  assert.ok(r.find("verify-head-review").prompt.includes('echo "EXISTS $sha"'));
});

// K2: a reviewer that reports a reviewedSha different from git wrote an artifact that records the
// wrong sha; the script must not return it as the written artifact.
await test("wr: fabricated-head: an approve whose reviewer reported a sha that differs from git is not artifactWritten (K2)", async () => {
  const LIE = "2e31c7761aecdcf5d0f0a1e0a3f9e1a5f6c5e6a1";
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: { ...reviewWith([]), verdict: "approve", reviewedSha: LIE, artifactWritten: true },
      // git answers with the real head; the fixture would otherwise follow the reviewer's claim
      "verify-head-review": {
        revParse: `${hex40("h0full")}
`,
        catFile: `EXISTS ${hex40("h0full")}
`,
      },
    }),
  );
  assert.equal(r.res.verdict, "approve");
  assert.equal(r.res.artifactWritten, false);
  assert.equal(r.res.strayArtifact, "docs/reviews/pr-32.md");
  assert.equal(r.res.reviewedSha, hex40("h0full"));
  assert.ok(
    r.logs.some((l) => / differs from git; using git$/.test(l)),
    r.logs.join("\n"),
  );
});

await test("wr: fabricated-head: a re-review approve whose re-reviewer reported a sha that differs from git is not artifactWritten (K2)", async () => {
  const LIE = "2e31c7761aecdcf5d0f0a1e0a3f9e1a5f6c5e6a1";
  const r = await run(
    wr,
    WBASE,
    wrResponder({
      reviewer: reviewWith([WF("I1", "important")]),
      "re-reviewer": (p) => ({
        verdict: "approve",
        reviewedSha: LIE,
        verdicts: ids(p).map((id) => ({ id, verdict: "ADDRESSED", evidence: "e" })),
        acceptedStands: [],
        newFindings: [],
        artifactWritten: true,
      }),
    }),
  );
  assert.equal(r.res.verdict, "approve");
  assert.equal(r.res.artifactWritten, false);
  assert.equal(r.res.strayArtifact, "docs/reviews/pr-32.md");
});

await test("wr: bad-sha: an answer at precondition:verifyHead re-runs verifyHead once as -retry", async () => {
  const r = await run(
    wr,
    { ...WBASE, answers: [{ at: "precondition:verifyHead", text: "git repaired" }] },
    wrResponder({
      reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true },
      "verify-head-review": { revParse: "not-a-sha\n", catFile: "EXISTS\n" },
    }),
  );
  assert.equal(r.res.verdict, "approve", r.logs.join("\n"));
  assert.ok(r.find("verify-head-review-retry").prompt.includes("git repaired"));
  assert.equal(r.res.reviewedSha, hex40("h0full"));
});

await test("wr: clean approve is the reviewer plus verifyHead", async () => {
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

await test("wr: worst case is 7 agents (5 plus two verifyHead reads); ruler opus/medium with the sensitive rule verbatim; front matter exact", async () => {
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
  assert.deepEqual(r.verifyLabels, ["verify-head-review", "verify-head-fix"]);
  assert.equal(r.calls.length, 7);
  assert.equal(`${r.find("ruler").model}/${r.find("ruler").effort}`, "opus/medium");
  assert.ok(r.find("ruler").prompt.includes(SENSITIVE_RULE));
  assert.ok(r.find("re-reviewer").prompt.includes('reviewer: "opus-5.5"\neffort: "high"'));
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
        reviewedSha: hex40("h1full"),
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
        reviewedSha: hex40("h1full"),
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
        reviewedSha: hex40("h1full"),
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
        reviewedSha: hex40("h1full"),
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
        reviewedSha: hex40("h1full"),
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
  for (const l of ["implementer", "implementer-continue", "combined-review"]) {
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
  const r = await run(
    sdd,
    { ...BASE, implemented: { head: IMPL_HEAD } },
    sddResponder(gitAt(IMPL_HEAD)),
  );
  assert.ok(!r.labels.includes("implementer"), r.labels.join(","));
  assert.deepEqual(r.labels, ["combined-review", "gate-0"]);
  assert.ok(r.find("combined-review").prompt.includes(`aaaaaaa1111..${hex40(IMPL_HEAD)}`));
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
    { ...BASE, maxAgents: 40 },
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
  for (const l of ["combined-review"]) {
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
    assert.ok(p.includes("pnpm typecheck"), `${l} lacks pnpm typecheck`);
    assert.ok(/do not commit on red/i.test(p), `${l} lacks "do not commit on red"`);
  }
});

await test("sdd P4 (#391): the one Opus reviewer carries the critic lens with the default focus on an ordinary task; tiers unchanged", async () => {
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
  const c = r.find("combined-review");
  assert.ok(c, r.labels.join(","));
  assert.ok(!r.labels.includes("critic-review"), r.labels.join(","));
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
  // without critic: true the lens is still there: no separate critic call on any tier
  const off = await run(sdd, BASE, sddResponder());
  assert.ok(!off.labels.includes("critic-review"));
  assert.ok(off.find("combined-review").prompt.includes("Critic lens:"));
});

await test("sdd P4: criticFocus replaces the default focus, and is appended on sensitive or UI tasks", async () => {
  const o = await run(sdd, { ...BASE, critic: true, criticFocus: "ZZ-FOCUS" }, sddResponder());
  const op = o.find("combined-review").prompt;
  assert.ok(op.includes("Focus: ZZ-FOCUS."), op);
  assert.ok(!op.includes("fail-open paths, data that crosses"));
  const s = await run(sdd, { ...BASE, sensitive: true, criticFocus: "ZZ-FOCUS" }, sddResponder());
  const sp = s.find("combined-review").prompt;
  assert.ok(sp.includes("sensitive-code risk") && sp.includes("; ZZ-FOCUS."), sp);
  const u = await run(sdd, { ...BASE, ui: true }, sddResponder());
  assert.ok(u.find("combined-review").prompt.includes("Focus: UI risk"));
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
    at("gate-0") > at("combined-review") && at("gate-0") < at("ruler-review"),
    r.labels.join(","),
  );
  assert.ok(
    r.find("gate-0").prompt.includes(`equals ${hex40("h-progress-pre")}`),
    "gate-0 not on the review head",
  );
  assert.ok(r.find("combined-review").prompt.includes(`head ${hex40("h-progress-pre")}`));
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
  assert.ok(r.labels.includes("combined-review"));
  assert.ok(!r.labels.includes("ruler-review") && !r.labels.some((l) => l.startsWith("fixer")));
  const again = await run(
    sdd,
    { ...BASE, answers: [{ at: "precondition:gate-0", text: "HEAD reset" }] },
    resp,
  );
  assert.ok(again.find("gate-0-retry").prompt.includes("HEAD reset"));
  assert.equal(again.find("combined-review").prompt, r.find("combined-review").prompt);
  assert.equal(again.res.status, "complete");
});

await test("sdd P7: review stages only (implemented) runs gate-0 in parallel on implemented.head", async () => {
  const r = await run(
    sdd,
    { ...BASE, implemented: { head: IMPL_HEAD } },
    sddResponder({ ...gitAt(IMPL_HEAD), "spec-review": specS1Mandated }),
  );
  assert.equal(r.labels.slice(0, 2).join(","), "combined-review,gate-0");
  assert.ok(r.find("gate-0").prompt.includes(`equals ${hex40(IMPL_HEAD)}`));
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

// Run wf_cfeda18c-be1 (B1 Task 1, 09-27-26): a fixer stop answered with a no-code ruling. The
// resumed fixer rightly commits nothing, but a real progress checker reports "no new commits"
// unless told check 1 does not apply, so the task looped to its budget. The stub checker below
// behaves like the real one: it raises that problem unless the prompt waives check 1.
const NO_CODE_TEXT = "S1 closed by ruling: the brief allows it; no code change";
const noCodeResponder = (over = {}) =>
  sddResponder({
    "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
    "fixer*": (p) =>
      p.includes(NO_CODE_TEXT)
        ? work("h-impl", { commits: [] })
        : work("h-impl", { status: "BLOCKED", commits: [], questions: ["S1 needs a ruling"] }),
    "progress*": (p) =>
      /Check 1 does not apply/.test(p)
        ? { ok: true, problems: [], head: "h-impl", newCommits: [], testCount: 10 }
        : {
            ok: false,
            problems: ["No new commits since round base"],
            head: "h-impl",
            newCommits: [],
            testCount: 10,
          },
    ...over,
  });

await test("sdd: a fixer stop answered noCode ends the round without a new-commits problem", async () => {
  const stop = await run(sdd, { ...BASE, maxAgents: 16 }, noCodeResponder());
  assert.equal(stop.res.stopped, "fixer-r1");
  const r = await run(
    sdd,
    { ...BASE, maxAgents: 16, answers: { at: "fixer-r1", text: NO_CODE_TEXT, noCode: true } },
    noCodeResponder(),
  );
  assert.ok(!r.labels.includes("fixer-r2"), r.labels.join(","));
  assert.ok(r.labels.includes("re-review-r1") && r.labels.includes("gate-r1"), r.labels.join(","));
  assert.equal(r.res.status, "complete");
  const pp = r.find("progress-r1").prompt;
  assert.ok(pp.includes("Working tree clean"), "the other progress checks still run");
  assert.ok(
    r.logs.some((l) => /round 1: controller answered noCode/.test(l)),
    r.logs.join(" | "),
  );
});

await test("sdd: a fixer that commits nothing without a noCode answer still raises the progress problem", async () => {
  const r = await run(
    sdd,
    { ...BASE, maxAgents: 16, answers: { at: "fixer-r1", text: NO_CODE_TEXT } },
    noCodeResponder(),
  );
  assert.ok(!/Check 1 does not apply/.test(r.find("progress-r1").prompt));
  assert.ok(r.find("fixer-r2").prompt.includes("[progress-r1-1]"), r.labels.join(","));
  // re-reviewer ADDRESSED on an empty diff does not waive the check either
  assert.ok(r.labels.includes("re-review-r1"));
  assert.notEqual(r.res.status, "complete");
});

// ---------- #300: same-source test counts, reasoned no-change fixer rounds, implementer head from git ----------

// (c) B5 Task 17 (run wf_0fbb3b1d-6ea, 09-28-26): the implementer committed 2946979 but reported
// commits [] and head "pending"; the script stopped on "no commits" although git had moved.
await test("sdd #300: an implementer that lists no commits while git HEAD moved continues to review", async () => {
  const r = await run(sdd, BASE, sddResponder({ implementer: work("pending", { commits: [] }) }));
  assert.equal(r.res.status, "complete", JSON.stringify(r.res.questions));
  assert.ok(
    r.labels.includes("spec-review") || r.labels.includes("combined-review"),
    r.labels.join(","),
  );
  assert.ok(
    r.res.commits.some((c) => c.sha === hex40("pending") && /from git/.test(c.subject)),
    JSON.stringify(r.res.commits),
  );
  assert.ok(
    r.logs.some((l) => /listed no commits.*git HEAD moved/.test(l)),
    r.logs.join(" | "),
  );
});

await test("sdd #300: an implementer that lists commits while git HEAD is still the base stops", async () => {
  const b40 = "b".repeat(40);
  const r = await run(
    sdd,
    { ...BASE, base: b40 },
    sddResponder({
      implementer: work("h-impl"),
      "verify-head-impl": { revParse: `${b40}\n`, catFile: `EXISTS ${b40}\n` },
    }),
  );
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stopped, "implementer");
  assert.ok(
    r.res.questions.some((q) => /HEAD is still the base/.test(q)),
    JSON.stringify(r.res.questions),
  );
});

// (a) A2 Task 7 (run wf_2d86b480-2fb): the round-1 progress checker compared a pnpm test count with
// the implementer's coverage summary (a different source) and reported a drop that was not real.
const oneFinding = (over = {}) =>
  sddResponder({
    "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
    implementer: work("h-impl", { testSummary: "coverage 153 files, 2144/2144" }),
    ...over,
  });

await test("sdd #300: the first progress check sets a same-source baseline; the implementer summary is context only", async () => {
  const r = await run(sdd, BASE, oneFinding());
  const p = r.find("progress-r1").prompt;
  assert.ok(/same source/i.test(p), p);
  assert.ok(/baseline/i.test(p), p);
  assert.ok(/Test Files/.test(p) && /testRaw/.test(p), "asks for the raw vitest summary lines");
  assert.ok(/context only/i.test(p) && p.includes("coverage 153 files, 2144/2144"), p);
  assert.ok(
    !/Prior evidence: coverage 153 files/.test(p),
    "implementer summary is not the baseline",
  );
});

await test("sdd #300: a later progress check compares with the earlier progress counts and their raw lines", async () => {
  const RAW1 = "Test Files  153 passed (153) / Tests  2144 passed (2144)";
  let round = 0;
  const r = await run(
    sdd,
    BASE,
    oneFinding({
      "progress*": (_p, _calls, label) => ({
        ...progress(label),
        testCount: 2144,
        testFiles: 153,
        testRaw: RAW1,
      }),
      "re-review*": (p) => {
        round++;
        return round === 1
          ? {
              verdicts: [{ id: "spec:S1", verdict: "NOT ADDRESSED", evidence: "still" }],
              newFindings: [],
              outOfScope: [],
            }
          : addressAll(p);
      },
    }),
  );
  const p2 = r.find("progress-r2").prompt;
  assert.ok(p2.includes(RAW1), p2);
  assert.ok(/2144 tests in 153 test files/.test(p2), p2);
  assert.ok(/quote both/i.test(p2), p2);
});

// (b) A2 Task 7 round 2 and A3 Task 14 (#189): a fixer correctly made no change (a false alarm, or an
// issue comment only the developer may post) and the no-new-commits rule parked the task.
const DECLINE_REASON = "false alarm: 153 test files before and after";
const declineResponder = (kind, rulerDecision = "stands", over = {}) =>
  oneFinding({
    "fixer-r1": work("h-impl", {
      commits: [],
      declined: [{ id: "spec:S1", kind, reason: DECLINE_REASON }],
    }),
    "progress*": (p, _calls, label) =>
      /Check 1 does not apply/.test(p)
        ? { ok: true, problems: [], head: "h-impl", newCommits: [], testCount: 10 }
        : label === "progress-r1"
          ? {
              ok: false,
              problems: ["No new commits since round base"],
              head: "h-impl",
              newCommits: [],
              testCount: 10,
            }
          : progress(label),
    "ruler-r1": (p) => ({
      rulings: ids(p).map((id) => ({
        item: id,
        decision: rulerDecision,
        reason: "ruler reason",
        costIfWrong: "c",
        fixInstruction: rulerDecision === "fix" ? "RULER-FIX-INSTRUCTION" : "",
      })),
    }),
    ...over,
  });

await test("sdd #300: a fixer round that declines every finding as noChangeNeeded goes to the ruler, not a park", async () => {
  const r = await run(sdd, BASE, declineResponder("noChangeNeeded"));
  assert.ok(r.labels.includes("ruler-r1"), r.labels.join(","));
  assert.ok(!r.labels.includes("re-review-r1"), "declined findings skip the re-reviewer");
  assert.ok(!r.labels.includes("fixer-r2"), r.labels.join(","));
  assert.ok(/Check 1 does not apply/.test(r.find("progress-r1").prompt));
  const rp = r.find("ruler-r1").prompt;
  assert.ok(rp.includes("[spec:S1]") && rp.includes(DECLINE_REASON), rp);
  assert.equal(r.res.status, "complete");
  assert.deepEqual(r.res.controllerActions, []);
  assert.ok(r.find("fixer-r1").prompt.includes("declined"), "the fixer is told how to decline");
});

await test("sdd #300: a needsDeveloper decline that stands is listed in controllerActions, never closed silently", async () => {
  const r = await run(sdd, BASE, declineResponder("needsDeveloper"));
  assert.equal(r.res.status, "complete");
  assert.equal(r.res.controllerActions.length, 1);
  assert.equal(r.res.controllerActions[0].id, "spec:S1");
  assert.ok(
    r.res.controllerActions[0].reason.includes(DECLINE_REASON),
    JSON.stringify(r.res.controllerActions),
  );
  assert.ok(
    r.logs.some((l) => /controller action/.test(l)),
    r.logs.join(" | "),
  );
  assert.ok(
    r.res.ledgerLines.some(
      (l) => /developer action: spec:S1/.test(l) && l.includes(DECLINE_REASON),
    ),
    r.res.ledgerLines.join(" | "),
  );
});

await test("sdd #300: a declined finding the ruler rules fix goes to the next fixer round with the instruction", async () => {
  const r = await run(sdd, BASE, declineResponder("noChangeNeeded", "fix"));
  assert.ok(r.labels.includes("fixer-r2"), r.labels.join(","));
  assert.ok(r.find("fixer-r2").prompt.includes("RULER-FIX-INSTRUCTION"));
});

await test("sdd #300: a declined finding the ruler escalates is parked", async () => {
  const r = await run(sdd, BASE, declineResponder("needsDeveloper", "escalate"));
  assert.equal(r.res.status, "parked");
  assert.ok(
    r.res.parked.some((f) => f.id === "spec:S1"),
    JSON.stringify(r.res.parked),
  );
  assert.ok(
    r.res.controllerActions.some((a) => a.id === "spec:S1"),
    "a needsDeveloper item is still relayed",
  );
});

await test("sdd #300: a mixed round (one declined, one fixed) keeps the new-commits check and re-reviews only the fixed one", async () => {
  const r = await run(
    sdd,
    BASE,
    oneFinding({
      "spec-review": {
        verdict: "fail",
        findings: [F("S1", "important"), F("S2", "important")],
        cannotVerify: [],
      },
      "fixer-r1": work("h-fix1", {
        declined: [{ id: "spec:S1", kind: "noChangeNeeded", reason: DECLINE_REASON }],
      }),
      "ruler-r1": (p) => ({
        rulings: ids(p).map((id) => ({
          item: id,
          decision: "stands",
          reason: "r",
          costIfWrong: "c",
        })),
      }),
    }),
  );
  assert.ok(!/Check 1 does not apply/.test(r.find("progress-r1").prompt));
  const rr = r.find("re-review-r1").prompt;
  assert.deepEqual(ids(rr), ["spec:S2"], "only the fixed finding is re-reviewed");
  assert.ok(r.find("ruler-r1").prompt.includes("[spec:S1]"));
  assert.equal(r.res.status, "complete");
});

await test("sdd: noCode is only valid on a fixer-r<r> answer with text", async () => {
  await assert.rejects(
    run(sdd, { ...BASE, answers: { at: "review", text: "t", noCode: true } }, sddResponder()),
    /noCode/,
  );
  await assert.rejects(
    run(
      sdd,
      {
        ...BASE,
        answers: {
          at: "fixer-r1",
          noCode: true,
          decisions: [{ item: "spec:S1", decision: "stands", reason: "r" }],
        },
      },
      sddResponder(),
    ),
    /noCode/,
  );
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

await test("sdd N1: a null checker with no later tree check stops at precondition:checker; the answer retries it", async () => {
  const late = {
    at: "ruler-review",
    decisions: [{ item: "spec:CV1", decision: "verified", reason: "controller ran it" }],
  };
  const over = {
    "spec-review": specCV(),
    checker: null,
    "checker-retry": (p) => checkAll("verified")(p),
  };
  const r = await run(sdd, { ...BASE, answers: [late] }, sddResponder(over));
  assert.equal(r.res.status, "stopped", r.logs.join(" | "));
  assert.equal(r.res.stopPoint, "precondition:checker");
  assert.ok(!r.labels.some((l) => l.startsWith("ruler")), r.labels.join(","));
  const again = await run(
    sdd,
    { ...BASE, answers: [late, { at: "precondition:checker", text: "tree verified clean" }] },
    sddResponder(over),
  );
  assert.ok(again.labels.includes("checker-retry"), again.labels.join(","));
  assert.equal(again.res.status, "complete", again.logs.join(" | "));
  // checker-retry null again: a second N1 stop; a second answer changes the retry prompt and completes.
  const pc1 = { at: "precondition:checker", text: "tree verified clean" };
  const pc2 = { at: "precondition:checker", text: "verified again" };
  const flaky = {
    ...over,
    "checker-retry": (p) => (p.includes("verified again") ? checkAll("verified")(p) : null),
  };
  const twice = await run(sdd, { ...BASE, answers: [late, pc1] }, sddResponder(flaky));
  assert.equal(twice.res.stopPoint, "precondition:checker", twice.logs.join(" | "));
  const third = await run(sdd, { ...BASE, answers: [late, pc1, pc2] }, sddResponder(flaky));
  assert.equal(third.res.status, "complete", third.logs.join(" | "));
  // A null ruler after a null checker checked nothing either: N1 stop.
  const deadRuler = await run(
    sdd,
    BASE,
    sddResponder({ "spec-review": specCV(), checker: null, "ruler-review": null }),
  );
  assert.equal(deadRuler.res.stopPoint, "precondition:checker", deadRuler.logs.join(" | "));
  // A plain precondition answer meant for a later stop is not taken by a null checker.
  const plain = await run(
    sdd,
    { ...BASE, answers: [{ at: "precondition", text: "for a later stop" }] },
    sddResponder({ "spec-review": specCV(), checker: null }),
  );
  assert.ok(!plain.labels.includes("checker-retry"), plain.labels.join(","));
  // A checker that returns a clean result consumes a pending precondition:checker answer.
  const fresh = await run(
    sdd,
    { ...BASE, answers: [pc1] },
    sddResponder({ "spec-review": specCV() }),
  );
  assert.equal(fresh.res.status, "complete", fresh.logs.join(" | "));
  assert.ok(!fresh.res.answersUnconsumed, fresh.logs.join(" | "));
  // A null checker whose items reach a running ruler needs no stop: the ruler checks the tree.
  const ruled = await run(sdd, BASE, sddResponder({ "spec-review": specCV(), checker: null }));
  assert.ok(ruled.labels.includes("ruler-review"));
  assert.notEqual(ruled.res.stopPoint, "precondition:checker");
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

// ---------- fix pass (critic review post-pilot-critic.md; controller rulings) ----------
await test("sdd FP-I1: a checker that reports another head or a dirty tree stops at precondition:checker", async () => {
  const resp = sddResponder({
    "spec-review": specCV(),
    checker: (p) => ({
      ...checkAll("verified")(p),
      head: "moved000",
      treeClean: false,
      dirtyFiles: ["packages/core/src/x.ts"],
    }),
    "checker-retry": checkAll("verified"),
  });
  const r = await run(sdd, BASE, resp);
  const c = r.find("checker").prompt;
  assert.ok(c.includes(`git rev-parse HEAD must equal ${hex40("h-impl")}.`), c);
  assert.ok(c.includes("git status --porcelain") && /never edit/i.test(c));
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stopped, "precondition");
  assert.equal(r.res.stopPoint, "precondition:checker");
  assert.ok(r.res.problem.includes("packages/core/src/x.ts") && r.res.problem.includes("moved000"));
  assert.ok(
    !r.labels.some((l) => l.startsWith("ruler") || l.startsWith("fixer")),
    r.labels.join(","),
  );
  const again = await run(
    sdd,
    { ...BASE, answers: [{ at: "precondition:checker", text: "tree restored" }] },
    resp,
  );
  assert.equal(again.find("checker").prompt, r.find("checker").prompt);
  assert.ok(again.find("checker-retry").prompt.includes("tree restored"));
  assert.equal(again.res.status, "complete");
});

await test("sdd N2: a checker head shorter than 7 characters counts as moved (full-sha gate head)", async () => {
  const resp = sddResponder({
    "spec-review": specCV(),
    checker: (p) => ({ ...checkAll("verified")(p), head: "h", treeClean: true, dirtyFiles: [] }),
  });
  const r = await run(sdd, BASE, resp);
  assert.equal(r.res.stopPoint, "precondition:checker");
  assert.ok(r.res.problem.includes("HEAD is h,"), r.res.problem);
});

await test("sdd N3: decisions in a plain precondition answer throw; use the returned stopPoint", async () => {
  await assert.rejects(
    run(
      sdd,
      {
        ...BASE,
        answers: [
          {
            at: "precondition",
            text: "x",
            decisions: [{ item: "spec:CV1", decision: "verified", reason: "r" }],
          },
        ],
      },
      sddResponder({}),
    ),
    /stopPoint/,
  );
});

await test("sdd FP-I1: a ruler-review that reports another head stops at precondition:ruler-review", async () => {
  const resp = sddResponder({
    "spec-review": specS1Mandated,
    "ruler-review": (p) => ({
      rulings: ids(p).map((id) => ({
        item: id,
        decision: "stands",
        reason: "r",
        costIfWrong: "c",
      })),
      head: "moved111",
      treeClean: true,
      dirtyFiles: [],
    }),
    "ruler-review-retry": (p) => ({
      rulings: ids(p).map((id) => ({
        item: id,
        decision: "stands",
        reason: "r",
        costIfWrong: "c",
      })),
    }),
  });
  const r = await run(sdd, BASE, resp);
  assert.ok(
    r.find("ruler-review").prompt.includes(`git rev-parse HEAD must equal ${hex40("h-impl")}.`),
  );
  assert.equal(r.res.stopPoint, "precondition:ruler-review");
  assert.ok(r.res.problem.includes("moved111"));
  assert.equal(r.res.rulings.length, 0, "rulings from a moved head must not be applied");
  const again = await run(
    sdd,
    { ...BASE, answers: [{ at: "precondition:ruler-review", text: "HEAD reset" }] },
    resp,
  );
  assert.ok(again.find("ruler-review-retry").prompt.includes("HEAD reset"));
  assert.equal(again.res.status, "complete");
  // ruler-concerns runs before gate-0 and carries no head check
  const pre = await run(
    sdd,
    BASE,
    sddResponder({ implementer: work("h0", { concerns: [{ kind: "correctness", text: "u" }] }) }),
  );
  assert.ok(!pre.find("ruler-concerns").prompt.includes("must equal"));
});

await test("sdd FP-I3: a ruler-review answer on a checked item keeps the checker prompt cache-stable", async () => {
  const resp = sddResponder({
    "spec-review": specCV(2),
    checker: () => ({
      results: [
        { id: "spec:CV1", result: "verified", evidence: "ok" },
        { id: "spec:CV2", result: "needsJudgment", evidence: "ambiguous" },
      ],
    }),
    "ruler-review": (p) => ({
      rulings: ids(p).map((id) => ({
        item: id,
        decision: "escalate",
        reason: "guess",
        costIfWrong: "c",
      })),
    }),
  });
  const first = await run(sdd, BASE, resp);
  assert.equal(first.res.stopped, "ruler-review");
  const answers = [
    {
      at: "ruler-review",
      decisions: [{ item: "spec:CV2", decision: "verified", reason: "ran it" }],
    },
  ];
  const second = await run(sdd, { ...BASE, answers }, resp);
  assert.equal(
    second.find("checker").prompt,
    first.find("checker").prompt,
    "checker cache would miss",
  );
  assert.ok(!second.labels.includes("ruler-review"), second.labels.join(","));
  assert.equal(second.res.rulings.find((x) => x.item === "spec:CV2").source, "controller");
  assert.equal(second.res.rulings.find((x) => x.item === "spec:CV1").source, "checker");
  assert.equal(second.res.status, "complete");
  // a later decision overrides the checker's own result
  const failed = await run(
    sdd,
    {
      ...BASE,
      answers: [
        {
          at: "ruler-review",
          decisions: [{ item: "spec:CV1", decision: "stands", reason: "known" }],
        },
      ],
    },
    sddResponder({ "spec-review": specCV(), checker: checkAll("failed") }),
  );
  assert.ok(!failed.labels.some((l) => l.startsWith("fixer")), failed.labels.join(","));
  assert.equal(failed.res.rulings.find((x) => x.item === "spec:CV1").source, "controller");
});

await test("sdd FP-I2: the progress checker flags gate-weakening moves; a hit makes the next round reviewed", async () => {
  let gates = 0;
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "gate*": () =>
        ++gates === 1
          ? { ok: false, head: "h", problems: ["pnpm coverage: branches 93% < 95%"] }
          : GATE_OK("h2"),
      "progress-r1": {
        ...progress("progress-r1"),
        guardHits: ["vitest.config.ts: coverage threshold lowered from 95 to 90"],
      },
    }),
  );
  const pp = r.find("progress-r1").prompt;
  for (const t of [
    "vitest",
    "biome.json",
    "tsconfig",
    "package.json",
    "coverage thresholds",
    "biome-ignore",
    "@ts-ignore",
    "@ts-expect-error",
    "istanbul ignore",
    "v8 ignore",
    "c8 ignore",
    "eslint-disable",
    "guardHits",
  ])
    assert.ok(pp.includes(t), `progress prompt lacks ${t}`);
  assert.ok(!r.labels.includes("re-review-r1"), "round 1 is gate-only, so mechanical");
  assert.ok(
    r.find("fixer-r2").prompt.includes("[progress-r1-guard-1] IMPORTANT"),
    r.labels.join(","),
  );
  assert.ok(
    r.labels.includes("re-review-r2"),
    `a guard hit must bring the re-reviewer: ${r.labels.join(",")}`,
  );
  assert.ok(ids(r.find("re-review-r2").prompt).includes("progress-r1-guard-1"));
  for (const l of ["fixer-r1", "fixer-r2"]) {
    const fp = r.find(l).prompt;
    assert.ok(
      fp.includes("unless the brief or a ruling in force asks for it") &&
        fp.includes("biome-ignore"),
      `${l} does not forbid gate-weakening moves`,
    );
  }
  const esc = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "re-review*": neverAddressed,
    }),
  );
  assert.ok(
    esc.find("fixer-r4").prompt.includes("unless the brief or a ruling in force asks for it"),
  );
});

const gate0Red = () => {
  let gates = 0;
  return () =>
    ++gates === 1
      ? { ok: false, head: "h-impl", problems: ["pnpm coverage red"] }
      : GATE_OK("h-final");
};

await test("sdd FP-M1: in a mixed round the re-reviewer does not verdict gate findings; gate-r decides them", async () => {
  let rr = 0;
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "gate*": gate0Red(),
      "re-review*": (p) => (++rr === 1 ? neverAddressed(p) : addressAll(p)),
    }),
  );
  const p1 = r.find("re-review-r1").prompt;
  assert.deepEqual(ids(p1), ["spec:S1"], "gate findings must not be up for a verdict");
  assert.ok(p1.includes("[gate-0:1]") && p1.includes("verified by gate-r1"), p1);
  // S1 still open after round 1, so the gate finding stays open and reaches the round-2 fixer
  assert.ok(r.find("fixer-r2").prompt.includes("[gate-0:1]"), "gate finding dropped after round 1");
  assert.ok(!r.labels.includes("gate-r1"), "no gate while a review finding is open");
  assert.ok(r.find("re-review-r2").prompt.includes("verified by gate-r2"));
  assert.ok(r.labels.includes("gate-r2"));
  assert.equal(r.res.status, "complete");
});

await test("sdd FP-M2: gate findings open at the round cap are parked, never dropped", async () => {
  const prog = await run(
    sdd,
    { ...BASE, maxRounds: 1 },
    sddResponder({
      "gate*": gate0Red(),
      "progress-r1": { ...progress("progress-r1"), ok: false, problems: ["tree dirty"] },
    }),
  );
  const parkedIds = (x) => x.res.parked.map((f) => f.id);
  assert.equal(prog.res.status, "parked");
  assert.ok(parkedIds(prog).includes("gate-0:1"), parkedIds(prog).join(","));
  assert.ok(parkedIds(prog).includes("progress-r1-1"));
  const mixed = await run(
    sdd,
    { ...BASE, maxRounds: 1 },
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "gate*": gate0Red(),
      "re-review*": neverAddressed,
    }),
  );
  assert.ok(
    parkedIds(mixed).includes("gate-0:1") && parkedIds(mixed).includes("spec:S1"),
    parkedIds(mixed).join(","),
  );
});

await test("sdd FP-M3: every sdd-task agent that can run shell commands carries the no-remote rule", async () => {
  const { calls } = await shellRuns();
  const crit = await run(
    sdd,
    { ...BASE, sensitive: true },
    sddResponder({ "spec-review": specCV(), checker: checkAll("needsJudgment") }),
  );
  const all = calls.concat(crit.calls);
  const want = [
    "combined-review",
    "checker",
    "ruler-concerns",
    "ruler-review",
    "progress-pre",
    "progress-r1",
    "re-review-r1",
  ];
  for (const l of want) {
    const c = all.find((x) => x.label === l);
    assert.ok(c, `no ${l} call`);
    assert.ok(c.prompt.includes(NO_REMOTE), `${l} lacks the no-remote rule`);
  }
  for (const c of all)
    assert.ok(c.prompt.includes(NO_REMOTE), `${c.label} lacks the no-remote rule`);
});

await test("sdd FP-M4: review-stages-only text names coverage, not test", async () => {
  const r = await run(
    sdd,
    { ...BASE, implemented: { head: IMPL_HEAD } },
    sddResponder(gitAt(IMPL_HEAD)),
  );
  assert.ok(!r.logs.some((l) => /lint, typecheck and test\b/.test(l)), r.logs.join(" | "));
  assert.ok(r.logs.some((l) => /re-runs lint, typecheck and coverage/.test(l)));
});

await test("sdd FP-M5 (#391): criticFocus alone shapes the reviewer's critic lens; no separate critic runs", async () => {
  const r = await run(sdd, { ...BASE, criticFocus: "ZZ" }, sddResponder());
  assert.ok(!r.labels.includes("critic-review"));
  assert.ok(r.find("combined-review").prompt.includes("Focus: ZZ."));
  assert.ok(!r.logs.some((l) => /criticFocus ignored/.test(l)), r.logs.join(" | "));
  const ovr = await run(
    sdd,
    { ...BASE, roles: { critic: { model: "sonnet", effort: "low" } } },
    sddResponder(),
  );
  assert.ok(
    ovr.logs.some((l) => l.includes("roles.critic ignored (#391")),
    ovr.logs.join(" | "),
  );
});

await test("append-ledger FP-M7: an already-appended block is skipped; UTF-16 and UTF-8 BOM input decode", async () => {
  const al = await import(new URL("./append-ledger.mjs", import.meta.url).href);
  assert.equal(al.appendText("head\nx\ny\n", ["x", "y"]), null, "tail already holds the block");
  assert.equal(al.appendText("x\ny", ["x", "y"]), null);
  assert.equal(al.appendText("head\r\nx\r\ny\r\n", ["x", "y"]), null);
  assert.equal(al.appendText("ax\ny\n", ["x", "y"]), "x\n", "a partial line is not a match; y is");
  assert.equal(
    al.appendText("x\ny\nz\n", ["x", "y"]),
    null,
    "lines already anywhere in the ledger are skipped",
  );
  // Stop and resume: the resumed result repeats the rulings the stopped run already ledgered.
  const stopped =
    "- Task 9: Ruling: a -- fix: r -- c\n- Task 9: stopped at review (head abc1234); controller action needed\n";
  const resumed = [
    "- Task 9: Ruling: a -- fix: r -- c",
    "- Task 9: fix round 1/5 (1 addressed, 0 open; head def5678)",
    "- Task 9: complete (commits a..b, review clean, gate green)",
  ];
  assert.equal(al.appendText(stopped, resumed), `${resumed[1]}\n${resumed[2]}\n`, "only new lines");
  assert.deepEqual(al.freshLines(stopped, resumed), resumed.slice(1));
  assert.equal(
    al.appendText("a\n", ["b", "b"]),
    "b\n",
    "a line repeated in one block is written once",
  );
  // A stop line is an event: the same stop twice at the same head is ledgered twice.
  const stop = "- Task 9: stopped at precondition (head abc1234); controller action needed";
  assert.equal(al.appendText(`${stop}\n`, [stop]), `${stop}\n`, "a repeated stop is kept");
  const res = {
    task: 7,
    ledgerLines: ["- Task 7: complete (commits a..b, review clean, gate green)"],
  };
  const json = JSON.stringify(res);
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")]);
  assert.deepEqual(al.findLedgerLines(al.decodeText(le)), res.ledgerLines, "UTF-16LE");
  const be = Buffer.from(json, "utf16le").swap16();
  assert.deepEqual(
    al.findLedgerLines(al.decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))),
    res.ledgerLines,
    "UTF-16BE",
  );
  const u8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, "utf8")]);
  assert.equal(al.decodeText(u8), json, "UTF-8 BOM stripped");
  assert.equal(al.decodeText(Buffer.from(json, "utf8")), json);
});

// ---------- sdd-wave ----------
const WAVE = {
  wave: "w4",
  repoDir: "C:\\git\\queryModule",
  branch: "feat/p0-wave-4",
  base: "base0000",
  workDir: "C:\\w",
  scratchRoot: "C:\\scratch",
  ledgerPath: "C:/w/progress.md",
  globalConstraints: "- TDD for every task",
  trailer: "Co-Authored-By: X",
  tasks: [17, 18, 19].map((n) => ({
    task: n,
    title: `T${n}`,
    issue: n + 1,
    ids: "SEC-010",
    specRefs: "spec 4.7",
    briefPath: `C:/w/task-${n}-brief.md`,
    carries: `carry-${n}`,
  })),
};
// Per-task overrides use "<label>@<task>"; the task is read from a brief, report or review path
// in the prompt.
function waveResponder(over = {}) {
  const taskOf = (p) => (/task-(\d+)-(?:brief|report|review)/.exec(p) || [])[1];
  // Each task commits its own head (#300: git decides whether an implementer committed, so two
  // tasks must never report the same new head).
  const base = sddResponder({
    implementer: (p) => work(hex40(`h-impl-${taskOf(p)}`)),
    "implementer-continue": (p) => work(hex40(`h-cont-${taskOf(p)}`)),
  });
  const self = (label, prompt, calls) => {
    const n = taskOf(prompt);
    const k = `${label}@${n}`;
    if (label === "combined-review" && !(k in over))
      return combineReviews((l) => self(l, prompt, calls));
    if (k in over) {
      const v = over[k];
      return postFill(label, prompt, typeof v === "function" ? v(prompt, calls, label) : v);
    }
    return base(label, prompt, calls);
  };
  return self;
}
const planMandated = {
  verdict: "fail",
  findings: [F("I1", "important", { planMandated: true })],
  cannotVerify: [],
};

await test("sdd-wave: every task runs through sdd-task in order; base and carries flow; one ledger block", async () => {
  const r = await run(
    wave,
    WAVE,
    waveResponder({
      "spec-review@17": {
        verdict: "fail",
        findings: [
          F("I1", "important", { planMandated: true }),
          F("I2", "important", { planMandated: true }),
        ],
        cannotVerify: [],
      },
      "ruler-review@17": (p) => ({
        rulings: ids(p).map((id) =>
          id === "spec:I1"
            ? {
                item: id,
                decision: "fix",
                reason: "spec 4.7 says so",
                costIfWrong: "c",
                fixInstruction: "fi",
                carryForward: ["Task 18 must bound\n   the email"],
              }
            : { item: id, decision: "stands", reason: "plan line 9 mandates it", costIfWrong: "c" },
        ),
      }),
    }),
    sdd,
  );
  assert.equal(r.res.status, "complete", r.logs.join(" | "));
  assert.deepEqual(
    r.childArgs.map((c) => c.args.task),
    [17, 18, 19],
  );
  assert.ok(r.childArgs.every((c) => c.scriptPath === ".claude/workflows/sdd-task.js"));
  const [a17, a18, a19] = r.childArgs.map((c) => c.args);
  assert.equal(a17.base, "base0000");
  assert.equal(a18.base, r.res.tasks[0].head);
  assert.equal(a19.base, r.res.tasks[1].head);
  assert.equal(a18.runLabel, "w4-t18");
  assert.equal(a18.reportPath, "C:\\w/task-18-report.md");
  assert.equal(a17.carries, "carry-17");
  assert.ok(a18.carries.startsWith("carry-18"), a18.carries);
  assert.ok(a18.carries.includes("Earlier in this wave"), a18.carries);
  assert.ok(
    a18.carries.includes("Task 17 carry forward: Task 18 must bound the email"),
    a18.carries,
  );
  assert.ok(
    a18.carries.includes("Task 17 ruling T17/spec:I2 (ruler): stands: plan line 9 mandates it"),
    a18.carries,
  );
  assert.ok(!a18.carries.includes("spec:I1 (ruler): fix"), "a fix ruling is settled in its task");
  assert.ok(a19.carries.includes("Task 17 carry forward"), "flow accumulates");
  assert.deepEqual(
    r.res.carried,
    a19.carries.split("\n").filter((l) => l.startsWith("- Task ")),
  );
  assert.ok(!/escalation/.test(r.res.ledgerLines.at(-1)), r.res.ledgerLines.at(-1));
  assert.equal(r.res.head, r.res.tasks[2].head);
  assert.ok(r.res.tasks.every((t) => !("ledgerLines" in t)));
  for (const n of [17, 18, 19])
    assert.ok(
      r.res.ledgerLines.some((l) => l.startsWith(`- Task ${n}: complete`)),
      `${n}`,
    );
  assert.ok(r.res.ledgerLines.at(-1).startsWith("- Wave w4: complete (Tasks 17, 18, 19"));
  assert.equal(r.res.totals.completed, 3);
  assert.equal(r.res.totals.rounds, 1);
  const al = await import(new URL("./append-ledger.mjs", import.meta.url).href);
  assert.deepEqual(al.findLedgerLines(JSON.stringify(r.res)), r.res.ledgerLines);
});

// #222: the next task's base is read from git between tasks, never taken from the child's head.
await test("sdd-wave: fabricated-head: the next base is git's head, and a differing child head is logged", async () => {
  const GIT = "2e31c77c6d9b971f6afc69a7ff4a714fb5315268";
  const r = await run(wave, WAVE, waveResponder(), sdd);
  assert.equal(r.res.status, "complete", r.logs.join(" | "));
  assert.deepEqual(
    r.calls.filter((c) => /^verify-head-t\d+$/.test(c.label)).map((c) => c.label),
    ["verify-head-t17", "verify-head-t18"],
  );
  // a consistent git: no child head differs from the between-task read (K3)
  assert.ok(!r.logs.some((l) => /differs from git/.test(l)), r.logs.join(" | "));
  // one responder per run, so the fixture's git follows the heads the children commit
  const inner = waveResponder();
  const lied = await run(
    wave,
    WAVE,
    (label, prompt, calls) =>
      label === "verify-head-t17"
        ? { revParse: `${GIT}\n`, catFile: `EXISTS ${GIT}\n` }
        : inner(label, prompt, calls),
    sdd,
  );
  assert.equal(lied.childArgs[1].args.base, GIT);
  const childHead = r.res.tasks[0].head;
  const diffs = lied.logs.filter((l) => /differs from git/.test(l));
  assert.deepEqual(
    diffs,
    [`agent-reported head ${childHead.slice(0, 16)}... differs from git; using git`],
    lied.logs.join(" | "),
  );
  assert.equal(lied.find("verify-head-t17").model, "haiku");
  assert.equal(lied.find("verify-head-t17").effort, undefined);
});

await test("sdd-wave: bad-sha: a verifyHead answer that is not a 40-hex sha stops the wave", async () => {
  const inner = waveResponder({
    "spec-review@17": planMandated,
    "ruler-review@17": (p) => ({
      rulings: ids(p).map((id) => ({
        item: id,
        decision: "stands",
        reason: "plan line 9 mandates it",
        costIfWrong: "c",
        carryForward: ["Task 18 must bound the email"],
      })),
    }),
  });
  const r = await run(
    wave,
    WAVE,
    (label, prompt, calls) =>
      label === "verify-head-t17"
        ? { revParse: "not-a-sha\n", catFile: "EXISTS\n" }
        : inner(label, prompt, calls),
    sdd,
  );
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stoppedTask, 17);
  assert.equal(r.res.stop.stopPoint, "precondition:verifyHead");
  assert.ok(/verifyHead/.test(r.res.stop.problem), r.res.stop.problem);
  assert.equal(r.childArgs.length, 1, "Task 18 must not start");
  // Q1: the restart uses the returned carried, so the completed task's obligations are in it
  assert.ok(
    r.res.carried.some((l) => l === "- Task 17 carry forward: Task 18 must bound the email"),
    JSON.stringify(r.res.carried),
  );
  assert.ok(
    r.res.carried.some((l) => l.startsWith("- Task 17 ruling T17/spec:I1 (ruler): stands")),
    JSON.stringify(r.res.carried),
  );
});

await test("sdd-wave: bad-sha: a cat-file answer for a different sha than revParse stops the wave (K1)", async () => {
  const inner = waveResponder();
  const r = await run(
    wave,
    WAVE,
    (label, prompt, calls) =>
      label === "verify-head-t17"
        ? { revParse: `${"a".repeat(40)}\n`, catFile: `EXISTS ${"b".repeat(40)}\n` }
        : inner(label, prompt, calls),
    sdd,
  );
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stop.stopPoint, "precondition:verifyHead");
  assert.ok(r.find("verify-head-t17").prompt.includes('echo "EXISTS $sha"'));
});

await test("sdd-wave: stops at the first task that does not complete; answers[task] resumes, earlier args unchanged", async () => {
  const blocked = {
    "implementer@18": {
      status: "BLOCKED",
      commits: [],
      head: "h-impl-17",
      testSummary: "",
      concerns: [],
      questions: ["which bound?"],
    },
  };
  const r = await run(wave, WAVE, waveResponder(blocked), sdd);
  assert.equal(r.res.status, "stopped", r.logs.join(" | "));
  assert.equal(r.res.stoppedTask, 18);
  assert.equal(r.res.stop.stopped, "implementer");
  assert.deepEqual(r.res.stop.questions, ["which bound?"]);
  assert.equal(r.childArgs.length, 2, "task 19 never starts");
  assert.ok(r.res.ledgerLines.at(-1).startsWith("- Wave w4: stopped at Task 18"));
  const answers = { 18: [{ at: "implementer", text: "use 254" }] };
  const again = await run(wave, { ...WAVE, answers }, waveResponder(blocked), sdd);
  assert.equal(again.res.status, "complete", again.logs.join(" | "));
  assert.deepEqual(
    again.childArgs[0].args,
    r.childArgs[0].args,
    "task 17 args identical: replays from cache",
  );
  assert.ok(!("answers" in again.childArgs[0].args));
  assert.deepEqual(again.childArgs[1].args.answers, answers[18]);
  assert.ok(again.labels.includes("implementer-continue"));
});

await test("sdd-wave: a parked task stops the wave", async () => {
  const r = await run(
    wave,
    WAVE,
    waveResponder({ "spec-review@17": planMandated, "ruler-review@17": { rulings: [] } }),
    sdd,
  );
  assert.equal(r.res.status, "parked", r.logs.join(" | "));
  assert.equal(r.res.stoppedTask, 17);
  assert.equal(r.res.stop.parked.length, 1);
  assert.equal(r.childArgs.length, 1);
  assert.equal(r.res.head, r.res.tasks[0].head, "a parked task's head is the wave head");
});

await test("sdd-wave: a second stop at a later task; each resume keeps earlier nested args identical", async () => {
  const blocked = (n) => ({
    status: "BLOCKED",
    commits: [],
    head: `h-impl-${n - 1}`,
    testSummary: "",
    concerns: [],
    questions: [`q${n}`],
  });
  const over = { "implementer@18": blocked(18), "implementer@19": blocked(19) };
  const a18 = { 18: [{ at: "implementer", text: "a18" }] };
  const two = await run(wave, { ...WAVE, answers: a18 }, waveResponder(over), sdd);
  assert.equal(two.res.stoppedTask, 19, two.logs.join(" | "));
  const both = { ...a18, 19: [{ at: "implementer", text: "a19" }] };
  const three = await run(wave, { ...WAVE, answers: both }, waveResponder(over), sdd);
  assert.equal(three.res.status, "complete", three.logs.join(" | "));
  assert.deepEqual(three.childArgs[0].args, two.childArgs[0].args);
  assert.deepEqual(three.childArgs[1].args, two.childArgs[1].args);
});

await test("sdd-wave: a child that throws stops the wave with a stop line; a cancel is rethrown", async () => {
  const tasks = [WAVE.tasks[0], { ...WAVE.tasks[1], criticFocus: " " }, WAVE.tasks[2]];
  const r = await run(wave, { ...WAVE, tasks }, waveResponder(), sdd);
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stoppedTask, 18);
  assert.match(r.res.stop.problem, /criticFocus/);
  assert.deepEqual(Object.keys(r.res.tasks[1]).sort(), [
    "base",
    "head",
    "problem",
    "status",
    "task",
  ]);
  assert.ok(r.res.ledgerLines.some((l) => /^- Task 18: stopped at sdd-task \(/.test(l)));
  assert.ok(r.res.carried.length === 0);
  const cancelling = {
    default: async () => {
      throw new Error("Workflow aborted by user");
    },
  };
  await assert.rejects(() => run(wave, WAVE, waveResponder(), cancelling), /aborted/);
});

await test("sdd-wave: carried seeds the flow of a follow-on run; the ruling block is capped", async () => {
  const carried = ["- Task 17 carry forward: keep the audit bound"];
  const r = await run(wave, { ...WAVE, tasks: WAVE.tasks.slice(1), carried }, waveResponder(), sdd);
  assert.ok(
    r.childArgs[0].args.carries.includes("keep the audit bound"),
    r.childArgs[0].args.carries,
  );
  const many = Array.from(
    { length: 45 },
    (_, i) => `- Task 1 ruling T1/x${i} (ruler): stands: r${i}`,
  );
  const c = await run(
    wave,
    { ...WAVE, tasks: [WAVE.tasks[0]], carried: many },
    waveResponder(),
    sdd,
  );
  const lines = c.childArgs[0].args.carries
    .split("\n")
    .filter((l) => l.startsWith("- Task 1 ruling"));
  assert.equal(lines.length, 30);
  assert.ok(lines.at(-1).includes("x44"), "the most recent rulings are kept");
  assert.ok(c.childArgs[0].args.carries.includes("15 earlier ruling line(s) omitted"));
  await assert.rejects(
    () => run(wave, { ...WAVE, carried: "x" }, waveResponder(), sdd),
    /carried must be a list of strings/,
  );
});

await test("append-ledger: the outermost ledgerLines wins over one nested in a string", async () => {
  const al = await import(new URL("./append-ledger.mjs", import.meta.url).href);
  const inner = JSON.stringify({ ledgerLines: ["- Task 1: inner"] });
  const outer = { ledgerLines: ["- Wave w: outer"], tasks: [{ problem: inner }] };
  assert.deepEqual(al.findLedgerLines(JSON.stringify(outer)), ["- Wave w: outer"]);
});

await test("sdd-wave: per-task options pass through; wave roles merge under task roles", async () => {
  const tasks = WAVE.tasks.map((t, i) =>
    i === 1
      ? {
          ...t,
          sensitive: true,
          criticFocus: "audit rows",
          roles: { implementer: { model: "opus", effort: "high" } },
        }
      : t,
  );
  const r = await run(
    wave,
    { ...WAVE, tasks, roles: { fixer: { model: "sonnet", effort: "high" } }, maxRounds: 3 },
    waveResponder(),
    sdd,
  );
  const a18 = r.childArgs[1].args;
  assert.equal(a18.sensitive, true);
  assert.equal(a18.criticFocus, "audit rows");
  assert.deepEqual(a18.roles, {
    fixer: { model: "sonnet", effort: "high" },
    implementer: { model: "opus", effort: "high" },
  });
  assert.equal(a18.maxRounds, 3);
  assert.ok(!("sensitive" in r.childArgs[0].args), "unset options are not passed");
  assert.ok(!r.labels.includes("critic-review"), r.labels.join(","));
  // #391: the sensitive task's one reviewer carries the critic lens with its focus
  const crit = r.calls.filter((c) => c.label === "combined-review")[1];
  assert.ok(crit.prompt.includes("sensitive-code risk") && crit.prompt.includes("audit rows"));
});

await test("sdd-wave: argument validation", async () => {
  const bad = async (args, re) => assert.rejects(() => run(wave, args, waveResponder(), sdd), re);
  const { tasks: _t, ...noTasks } = WAVE;
  await bad(noTasks, /tasks/);
  await bad({ ...WAVE, tasks: [] }, /tasks/);
  await bad({ ...WAVE, trailer: " " }, /trailer/);
  await bad({ ...WAVE, tasks: [WAVE.tasks[0], WAVE.tasks[0]] }, /duplicate task 17/);
  await bad({ ...WAVE, tasks: [{ ...WAVE.tasks[0], briefPath: "" }] }, /briefPath/);
  await bad(
    { ...WAVE, answers: { 99: [{ at: "implementer", text: "x" }] } },
    /answers for task 99/,
  );
  await bad({ ...WAVE, tasks: [{ ...WAVE.tasks[0], base: "x" }] }, /base/);
});

// ---------- review tiers (issue #78, ADR-0007, P0 review-roles retro) ----------
const tierOf = (c) => (c.effort ? `${c.model}/${c.effort}` : c.model);
const DIFF_SCOPE = "read outside the diff only files that call or are called by the changed code";
const COST_LIMIT = "only for a concrete risk you can name, one focused check per risk";
const specQ = (extra = {}) => ({
  "spec-review": { verdict: "fail", findings: [F("S1", "important", extra)], cannotVerify: [] },
});
// Round 1 and 2 NOT ADDRESSED, so round 3 runs the escalated fixer (a repeat).
const twiceNotAddressed = () => {
  let n = 0;
  return (p) => (++n <= 2 ? neverAddressed(p) : addressAll(p));
};

await test("tiers (#391): ordinary defaults, one Opus reviewer with the critic lens, no separate critic", async () => {
  const r = await run(
    sdd,
    { ...BASE, maxAgents: 40 },
    sddResponder({ ...specQ(), "re-review*": twiceNotAddressed() }),
  );
  assert.ok(!r.labels.includes("spec-review") && !r.labels.includes("quality-review"));
  assert.ok(!r.labels.includes("critic-review"), r.labels.join(","));
  assert.equal(r.labels.slice(0, 3).join(","), "implementer,combined-review,gate-0");
  const want = {
    implementer: "sonnet/medium",
    "combined-review": "opus/medium",
    "gate-0": "sonnet/low",
    "fixer-r1": "sonnet/medium",
    "progress-r1": "sonnet/low",
    "re-review-r1": "sonnet/medium",
    "fixer-r3": "sonnet/high",
    "gate-r3": "sonnet/low",
  };
  for (const [l, t] of Object.entries(want)) assert.equal(tierOf(r.find(l)), t, l);
  assert.equal(r.res.status, "complete", r.logs.join(" | "));
  const pm = await run(sdd, BASE, sddResponder(specQ({ planMandated: true })));
  assert.equal(tierOf(pm.find("ruler-review")), "opus/low");
  assert.ok(!pm.find("ruler-review").prompt.includes(SENSITIVE_RULE));
  const crit = await run(sdd, { ...BASE, critic: true }, sddResponder());
  assert.ok(!crit.labels.includes("critic-review"), crit.labels.join(","));
});

await test("tiers (#391): gate defaults (one Opus reviewer with the gate critic focus, sensitive ruler rule)", async () => {
  const r = await run(
    sdd,
    { ...BASE, tier: "gate", maxAgents: 40 },
    sddResponder({ ...specQ(), "re-review*": twiceNotAddressed() }),
  );
  assert.equal(
    r.labels.slice(0, 3).join(","),
    "implementer,combined-review,gate-0",
    r.labels.join(","),
  );
  const want = {
    implementer: "sonnet/medium",
    "combined-review": "opus/medium",
    "fixer-r1": "sonnet/medium",
    "re-review-r1": "sonnet/high",
    "fixer-r3": "opus/medium",
    "gate-0": "sonnet/low",
    "progress-r1": "sonnet/low",
  };
  for (const [l, t] of Object.entries(want)) assert.equal(tierOf(r.find(l)), t, l);
  assert.ok(r.find("combined-review").prompt.includes("gate-tier risk"), "gate critic focus");
  const pm = await run(
    sdd,
    { ...BASE, tier: "gate" },
    sddResponder({
      "spec-review": {
        verdict: "fail",
        findings: [F("S1", "critical", { planMandated: true })],
        cannotVerify: [],
      },
      "ruler-review": {
        rulings: [{ item: "spec:S1", decision: "stands", reason: "plan", costIfWrong: "c" }],
      },
    }),
  );
  assert.equal(tierOf(pm.find("ruler-review")), "opus/low");
  assert.ok(pm.find("ruler-review").prompt.includes(SENSITIVE_RULE));
  assert.equal(pm.res.stopped, "ruler-review", "a critical ruled stands escalates on gate");
  assert.equal(pm.res.escalated[0].item, "spec:S1");
});

await test("tiers (#391): critical keeps the sensitive roles; one Opus reviewer replaces the split reviewers and the critic", async () => {
  const r = await run(
    sdd,
    { ...BASE, tier: "critical", maxAgents: 40 },
    sddResponder({ ...specQ({ planMandated: true }), "re-review*": twiceNotAddressed() }),
  );
  for (const gone of ["spec-review", "quality-review", "critic-review"])
    assert.ok(!r.labels.includes(gone), r.labels.join(","));
  const want = {
    implementer: "opus/medium",
    "combined-review": "opus/medium",
    "ruler-review": "opus/medium",
    "fixer-r1": "opus/medium",
    "re-review-r1": "opus/medium",
    "fixer-r3": "opus/high",
    "gate-0": "sonnet/low",
  };
  for (const [l, t] of Object.entries(want)) assert.equal(tierOf(r.find(l)), t, l);
  assert.ok(r.find("ruler-review").prompt.includes(SENSITIVE_RULE));
  assert.ok(r.find("combined-review").prompt.includes("sensitive-code risk"));
  const ov = await run(
    sdd,
    { ...BASE, tier: "gate", roles: { reviewer: { model: "opus", effort: "low" } } },
    sddResponder(),
  );
  assert.equal(tierOf(ov.find("combined-review")), "opus/low", "a roles override still wins");
});

await test("tiers: the combined reviewer does spec and quality, writes task-<n>-review.md, keeps kinds", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "combined-review": {
        verdict: "fail",
        findings: [
          F("S1", "important", { kind: "spec", planMandated: true }),
          F("Q1", "important", { kind: "quality" }),
          F("M1", "minor", { kind: "quality" }),
        ],
        cannotVerify: [{ item: "i", check: "c", kind: "spec" }],
      },
    }),
  );
  const p = r.find("combined-review").prompt;
  assert.ok(p.includes("C:/w/task-7-review.md"), "review file");
  assert.ok(!/task-7-review-(spec|quality)\.md/.test(p), "no split review files");
  assert.ok(/cite each ID verbatim/.test(p), "requirement IDs verbatim");
  assert.ok(p.includes("BR-001") && /FR-, UX-, SEC-, BR-, NFR-/.test(p), "ID families");
  assert.ok(/fixture policy/.test(p) && /RED evidence/.test(p), "fixtures and RED evidence");
  assert.ok(/separation of concerns/.test(p), "quality review");
  assert.ok(/kind: spec/.test(p) && /kind: quality/.test(p), "finding kinds");
  assert.ok(ids(r.find("ruler-review").prompt).includes("spec:S1"));
  assert.ok(r.find("fixer-r1").prompt.includes("[quality:Q1]"));
  assert.ok(r.res.deferredMinors.some((m) => m.startsWith("quality:M1")));
  assert.ok(r.labels.includes("checker") && ids(r.find("checker").prompt).includes("spec:CV1"));
});

await test("tiers: sensitive is an alias for critical (logged); a conflict or an unknown tier throws", async () => {
  const s = await run(sdd, { ...BASE, sensitive: true }, sddResponder());
  assert.ok(
    s.logs.some((l) => /sensitive: true is an alias for tier "critical"/.test(l)),
    s.logs.join(" | "),
  );
  assert.ok(s.labels.includes("combined-review") && !s.labels.includes("spec-review"));
  const both = await run(sdd, { ...BASE, sensitive: true, tier: "critical" }, sddResponder());
  assert.equal(both.res.status, "complete");
  await assert.rejects(
    run(sdd, { ...BASE, sensitive: true, tier: "gate" }, sddResponder()),
    /sensitive.*tier/,
  );
  await assert.rejects(
    run(sdd, { ...BASE, sensitive: false, tier: "critical" }, sddResponder()),
    /sensitive.*tier/,
  );
  await assert.rejects(run(sdd, { ...BASE, tier: "high" }, sddResponder()), /tier/);
  const o = await run(sdd, BASE, sddResponder());
  assert.ok(
    o.logs.some((l) => /tier ordinary/.test(l)),
    o.logs.join(" | "),
  );
});

await test("tiers: reviewer, critic and re-reviewer prompts are diff-scoped", async () => {
  const g = await run(sdd, { ...BASE, tier: "gate" }, sddResponder(specQ()));
  const c = await run(sdd, { ...BASE, tier: "critical" }, sddResponder(specQ()));
  const calls = [...g.calls, ...c.calls].filter((x) =>
    /^(combined|spec|quality|critic)-review$|^re-review-r/.test(x.label),
  );
  const seen = new Set(calls.map((x) => x.label));
  for (const l of ["combined-review", "re-review-r1"]) assert.ok(seen.has(l), `no ${l} call`);
  for (const x of calls) {
    const rr = x.label.startsWith("re-review");
    if (rr) {
      assert.ok(x.prompt.includes("Re-review scope: the fix diff"), `${x.label} lacks its scope`);
      assert.ok(!x.prompt.includes(DIFF_SCOPE), `${x.label} carries the reviewer scope`);
      assert.ok(!/nothing else/.test(x.prompt), `${x.label} still says nothing else`);
    } else assert.ok(x.prompt.includes(DIFF_SCOPE), `${x.label} is not diff-scoped`);
    assert.ok(x.prompt.includes(COST_LIMIT), `${x.label} lacks the cost limit`);
    assert.ok(x.prompt.includes("do not read unrelated files"), `${x.label} lacks the limit`);
    assert.ok(x.prompt.includes("spec 4.1"), `${x.label} lacks the specRefs lines`);
  }
});

await test("fix pass C1: ruler and fixer prompts point at a review-file pattern that matches every tier", async () => {
  const r = await run(
    sdd,
    BASE,
    sddResponder({
      "spec-review": {
        verdict: "fail",
        findings: [F("S1", "important", { planMandated: true }), F("S2", "important")],
        cannotVerify: [],
      },
    }),
  );
  for (const l of ["ruler-review", "fixer-r1"]) {
    const globs = [...r.find(l).prompt.matchAll(/task-7-review[^\s,)]*\.md/g)].map((m) => m[0]);
    assert.ok(globs.length, `${l} names no review file pattern`);
    const escapedGlob = globs[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
    const re = new RegExp(`^${escapedGlob}$`);
    for (const f of ["task-7-review.md", "task-7-review-spec.md", "task-7-review-critic.md"])
      assert.ok(re.test(f), `${l} pattern ${globs[0]} misses ${f}`);
  }
});

await test("tiers: the agent budget stops the run at the next call past maxAgents", async () => {
  const resp = sddResponder({ ...specQ(), "re-review*": twiceNotAddressed() });
  const r = await run(sdd, { ...BASE, maxAgents: 8 }, resp);
  assert.equal(r.calls.length, 8, r.labels.join(","));
  assert.equal(r.res.status, "stopped");
  assert.equal(r.res.stopped, "budget");
  assert.equal(r.res.stopPoint, "budget");
  assert.ok(
    /9/.test(r.res.problem) && /8/.test(r.res.problem) && /fixer-r2/.test(r.res.problem),
    r.res.problem,
  );
  assert.equal(r.res.agents, 8);
  assert.ok(
    r.res.parked.some((f) => f.id === "spec:S1"),
    "open findings return as parked at a budget stop",
  );
  assert.ok(r.res.ledgerLines.at(-1).includes("stopped at budget"), r.res.ledgerLines.at(-1));
  // parallel reviewers are reserved up front: a cap of 2 stops before the review block
  const p = await run(sdd, { ...BASE, maxAgents: 2 }, sddResponder());
  assert.deepEqual(p.labels, ["implementer"]);
  assert.equal(p.res.stopped, "budget");
  assert.ok(/combined-review/.test(p.res.problem), p.res.problem);
});

await test("tiers: a budget answer raises the cap by the default once and replays from cache", async () => {
  const resp = () => sddResponder({ ...specQ(), "re-review*": twiceNotAddressed() });
  const r = await run(sdd, { ...BASE, maxAgents: 8 }, resp());
  const again = await run(
    sdd,
    { ...BASE, maxAgents: 8, answers: [{ at: "budget", text: "go on" }] },
    resp(),
  );
  for (let i = 0; i < r.calls.length; i++)
    assert.equal(
      again.calls[i].prompt,
      r.calls[i].prompt,
      `call ${i} (${r.calls[i].label}) changed`,
    );
  assert.ok(!again.calls.some((c) => c.prompt.includes("go on")), "budget text reaches no agent");
  assert.equal(again.res.status, "complete", again.logs.join(" | "));
  assert.equal(again.res.agents, again.calls.length);
  assert.ok(
    again.logs.some((l) => /maxAgents 8 raised to 26/.test(l)),
    again.logs.join(" | "),
  );
  assert.ok(
    again.res.ledgerLines.at(-1).endsWith(`gate green; ${again.calls.length} agents)`),
    again.res.ledgerLines.at(-1),
  );
  // default cap 24: the 33-agent worst case stops at budget
  const w = await run(
    sdd,
    { ...BASE, sensitive: true, ui: true },
    sddResponder({
      "critic-review": { verdict: "fail", findings: [F("C1", "important")], cannotVerify: [] },
      "gate*": { ok: false, head: "hg", problems: ["red"] },
    }),
  );
  assert.equal(w.calls.length, 24, "critical default is 24");
  assert.equal(w.res.stopped, "budget");
});

await test("tiers: maxAgents is coerced like maxRounds", async () => {
  const s = await run(sdd, { ...BASE, maxAgents: "2" }, sddResponder());
  assert.equal(s.res.stopped, "budget");
  assert.ok(
    s.logs.some((l) => /maxAgents "2" coerced to 2/.test(l)),
    s.logs.join(" | "),
  );
  const j = await run(sdd, { ...BASE, maxAgents: "lots" }, sddResponder());
  assert.ok(j.logs.some((l) => /maxAgents "lots" is not a number; using 18/.test(l)));
  assert.equal(j.res.status, "complete");
  const f = await run(sdd, { ...BASE, maxAgents: 2.9 }, sddResponder());
  assert.equal(f.res.stopped, "budget");
});

await test("tiers: sdd-wave passes tier and maxAgents through (task wins) and totals agents", async () => {
  const tasks = WAVE.tasks.map((t, i) =>
    i === 1 ? { ...t, tier: "critical", maxAgents: 30 } : i === 2 ? { ...t, sensitive: true } : t,
  );
  const r = await run(wave, { ...WAVE, tasks, tier: "gate", maxAgents: 20 }, waveResponder(), sdd);
  const [a17, a18, a19] = r.childArgs.map((c) => c.args);
  assert.equal(a17.tier, "gate");
  assert.equal(a17.maxAgents, 20);
  assert.equal(a18.tier, "critical");
  assert.equal(a18.maxAgents, 30);
  assert.ok(!("tier" in a19) && a19.sensitive === true, "sensitive task gets no wave tier");
  assert.equal(r.res.status, "complete", r.logs.join(" | "));
  assert.equal(r.res.totals.agents, r.calls.length);
  // the wave's own agents are the verifyHead reads between tasks (#222): two, none after the last task
  const waveVerifies = r.calls.filter((c) => /^verify-head-t\d+$/.test(c.label)).length;
  assert.equal(waveVerifies, 2);
  assert.equal(r.res.totals.agents, r.res.tasks.reduce((s, t) => s + t.agents, 0) + waveVerifies);
  const none = await run(wave, WAVE, waveResponder(), sdd);
  assert.ok(!("tier" in none.childArgs[0].args) && !("maxAgents" in none.childArgs[0].args));
});

await test("tiers: wave-review gate tier runs Opus medium; critical runs Opus high; ordinary throws", async () => {
  const worst = {
    reviewer: reviewWith([WF("C1", "critical"), WF("I1", "important", { planMandated: true })]),
  };
  const g = await run(wr, { ...WBASE, tier: "gate" }, wrResponder(worst));
  assert.equal(tierOf(g.find("reviewer")), "opus/medium");
  assert.equal(tierOf(g.find("re-reviewer")), "opus/medium");
  assert.ok(g.find("reviewer").prompt.includes('reviewer: "opus-5.5"\neffort: "medium"'));
  assert.ok(g.find("re-reviewer").prompt.includes('reviewer: "opus-5.5"\neffort: "medium"'));
  assert.equal(tierOf(g.find("ruler")), "opus/low");
  const c = await run(wr, WBASE, wrResponder(worst));
  assert.equal(tierOf(c.find("reviewer")), "opus/high");
  assert.equal(tierOf(c.find("re-reviewer")), "opus/high");
  const cx = await run(wr, { ...WBASE, tier: "critical" }, wrResponder(worst));
  assert.equal(tierOf(cx.find("reviewer")), "opus/high");
  await assert.rejects(
    run(wr, { ...WBASE, tier: "ordinary" }, wrResponder()),
    /no wave-review needed/,
  );
  await assert.rejects(run(wr, { ...WBASE, tier: "low" }, wrResponder()), /tier/);
  const ov = await run(
    wr,
    { ...WBASE, tier: "gate", roles: { reviewer: { model: "opus", effort: "max" } } },
    wrResponder(worst),
  );
  assert.equal(tierOf(ov.find("reviewer")), "opus/max", "a roles override still wins");
  assert.ok(
    ov.logs.some((l) => /"reviewer" overridden to effort "max"/.test(l)),
    "override to max is logged",
  );
});

await test("tiers: the wave-review reviewer prompt is diff-scoped", async () => {
  const r = await run(wr, WBASE, wrResponder({ reviewer: reviewWith([WF("I1", "important")]) }));
  const p = r.find("reviewer").prompt;
  assert.ok(p.includes(DIFF_SCOPE), p);
  assert.ok(p.includes("do not read unrelated files"));
  assert.ok(
    p.includes("* a.ts") && p.includes("1. q1"),
    "sensitive files and questions still steer it",
  );
});

await test("fix pass: maxAgents defaults per tier (ordinary 18, gate 20, critical 24); explicit wins", async () => {
  for (const [tier, n] of [
    ["ordinary", 18],
    ["gate", 20],
    ["critical", 24],
  ]) {
    const r = await run(sdd, { ...BASE, tier }, sddResponder());
    assert.ok(
      r.logs.some((l) => l.includes(`maxAgents ${n}`)),
      `${tier}: ${r.logs.join(" | ")}`,
    );
  }
  const e = await run(sdd, { ...BASE, tier: "critical", maxAgents: 9 }, sddResponder());
  assert.ok(e.logs.some((l) => l.includes("maxAgents 9")));
});

await test("fix pass C4: a task that sets sensitive gets no wave tier (sensitive: false under a critical wave)", async () => {
  const tasks = WAVE.tasks.map((t, i) => (i === 0 ? { ...t, sensitive: false } : t));
  const r = await run(wave, { ...WAVE, tasks, tier: "critical" }, waveResponder(), sdd);
  assert.equal(r.res.status, "complete", r.logs.join(" | "));
  const a17 = r.childArgs[0].args;
  assert.ok(!("tier" in a17) && a17.sensitive === false, JSON.stringify(a17));
  assert.equal(r.childArgs[1].args.tier, "critical");
  assert.ok(
    r.logs.some((l) => /task 17 .*tier ordinary/.test(l)),
    r.logs.join(" | "),
  );
});

// ================= #92: review caps, tier slices, fast path, branch-keyed artifact =================

// #92 C4: a scenario that only drives the happy path never touches ruler, checker, fixer,
// escalatedFixer, progressChecker or reReviewer, so a regression there (a default left at xhigh or
// max) would still pass. This responder drives the worst-case flow so every one of those roles
// actually runs, in every tier: an implementer concern (ruler-concerns, fixer-pre, progress-pre), a
// cannot-verify item the checker calls needsJudgment (ruler-review), and a repeated NOT ADDRESSED
// verdict (escalatedFixer by round 3).
function sddWorstResponder() {
  return sddResponder({
    implementer: work("h0", { concerns: [{ kind: "correctness", text: "unsure" }] }),
    "spec-review": {
      verdict: "fail",
      findings: [F("S1", "important")],
      cannotVerify: [{ item: "i", check: "c" }],
    },
    "quality-review": {
      verdict: "fail",
      findings: [F("Q1", "important", { planMandated: true })],
      cannotVerify: [],
    },
    checker: checkAll("needsJudgment"),
    "re-review*": (p) => ({
      verdicts: ids(p).map((id) => ({ id, verdict: "NOT ADDRESSED", evidence: "a.ts:1" })),
      newFindings: [],
      outOfScope: [],
    }),
  });
}

await test("#92 R1/C4: no sdd-task default role is xhigh or max, in any tier, across the worst-case flow (ruler-concerns, fixer-pre, checker, ruler-review, fixer, escalatedFixer, progress and re-review all run); the step-up ladder holds opus/high", async () => {
  for (const tierName of ["ordinary", "gate", "critical"]) {
    const r = await run(sdd, { ...BASE, tier: tierName, maxAgents: 60 }, sddWorstResponder());
    for (const label of [
      "ruler-concerns",
      "fixer-pre",
      "progress-pre",
      "checker",
      "ruler-review",
      "fixer-r1",
      "progress-r1",
      "re-review-r1",
      "fixer-r3",
    ]) {
      assert.ok(r.labels.includes(label), `${tierName}: missing ${label} (${r.labels.join(",")})`);
    }
    for (const c of r.calls) {
      assert.ok(
        !["xhigh", "max"].includes(c.effort),
        `${tierName} ${c.label} defaulted to ${c.effort}`,
      );
    }
  }
  // An escalatedFixer built (ordinary tier, no tier-specific entry) from a roles.fixer override at
  // opus/high must stay opus/high, never step to xhigh.
  const r = await run(
    sdd,
    { ...BASE, roles: { fixer: { model: "opus", effort: "high" } }, maxAgents: 40 },
    sddResponder({
      "spec-review": { verdict: "fail", findings: [F("S1", "important")], cannotVerify: [] },
      "re-review*": (p) => ({
        verdicts: ids(p).map((id) => ({ id, verdict: "NOT ADDRESSED", evidence: "a.ts:1" })),
        newFindings: [],
        outOfScope: [],
      }),
    }),
  );
  assert.equal(r.find("fixer-r3").model, "opus");
  assert.equal(r.find("fixer-r3").effort, "high", "opus/high must not step to xhigh");
});

await test("#92 R1/C4: no wave-review default role is xhigh or max, in either tier, across the full review-rule-fix-progress-re-review flow (fixer and progressChecker are checked too)", async () => {
  for (const t of ["critical", "gate"]) {
    const r = await run(
      wr,
      { ...WBASE, tier: t },
      wrResponder({
        reviewer: reviewWith([WF("C1", "critical"), WF("I1", "important", { planMandated: true })]),
      }),
    );
    assert.deepEqual(
      r.labels,
      ["reviewer", "ruler", "fixer", "progress", "re-reviewer"],
      `${t}: ${r.labels.join(",")}`,
    );
    for (const c of r.calls) {
      assert.ok(!["xhigh", "max"].includes(c.effort), `${t} ${c.label} defaulted to ${c.effort}`);
    }
  }
});

await test("#92 R1: a roles override to xhigh or max logs one warning line per role (sdd-task and wave-review)", async () => {
  const r = await run(
    sdd,
    { ...BASE, roles: { ruler: { model: "opus", effort: "xhigh" } } },
    sddResponder(),
  );
  const rulerWarnings = r.logs.filter((l) => /"ruler" overridden to effort "xhigh"/.test(l));
  assert.equal(rulerWarnings.length, 1, r.logs.join(" | "));

  const wrR = await run(
    wr,
    { ...WBASE, roles: { reviewer: { model: "opus", effort: "max" } } },
    wrResponder({ reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true } }),
  );
  assert.ok(
    wrR.logs.some((l) => /"reviewer" overridden to effort "max"/.test(l)),
    wrR.logs.join(" | "),
  );
});

await test("#92 R2: a branch-keyed artifact path replaces docs/reviews/pr-<n>.md; a bad branch throws; neither branch nor pr throws; a mismatched artifactPath throws", async () => {
  const { pr, ...noPr } = WBASE;
  const r = await run(
    wr,
    { ...noPr, branch: "feat/p0-wave-6" },
    wrResponder({ reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true } }),
  );
  assert.ok(r.find("reviewer").prompt.includes("docs/reviews/feat-p0-wave-6.md"));
  assert.ok(!r.find("reviewer").prompt.includes("PR #"), "no PR number when pr is not given");

  await assert.rejects(
    run(wr, { ...noPr, branch: "feat/../evil" }, wrResponder()),
    /not a plain branch name/,
  );
  await assert.rejects(run(wr, { ...noPr }, wrResponder()), /at least one of "branch" or "pr"/);
  await assert.rejects(
    run(
      wr,
      { ...noPr, branch: "feat/p0-wave-6", artifactPath: "docs/reviews/pr-1.md" },
      wrResponder(),
    ),
    /must be docs\/reviews\/feat-p0-wave-6\.md/,
  );

  const both = await run(
    wr,
    { ...WBASE, branch: "feat/p0-wave-6" },
    wrResponder({ reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true } }),
  );
  assert.ok(both.find("reviewer").prompt.includes("PR #32"), "pr still names the PR number");
  assert.ok(both.find("reviewer").prompt.includes("docs/reviews/feat-p0-wave-6.md"));
});

await test("#92 R3: slices run gate then critical, in order; each prompt lists only its own files; ids are prefixed; the merged findings reach the ruler and fixer", async () => {
  const r = await run(
    wr,
    { ...WBASE, gateFiles: ["g.ts"], criticalFiles: ["c.ts"] },
    wrResponder({
      "reviewer-gate": {
        verdict: "fixes",
        reviewedSha: hex40("h0full"),
        preconditionFailed: "",
        findings: [WF("G1", "important", { file: "g.ts", planMandated: true })],
        answers: [],
        declined: [],
        artifactWritten: false,
      },
      "reviewer-critical": {
        verdict: "approve",
        reviewedSha: hex40("h0full"),
        preconditionFailed: "",
        findings: [],
        answers: [],
        declined: [],
        artifactWritten: false,
      },
      ruler: {
        rulings: [
          { item: "G-G1", decision: "fix", reason: "r", costIfWrong: "c", fixInstruction: "fi" },
        ],
      },
    }),
  );
  assert.deepEqual(
    r.labels.filter((l) => l.startsWith("reviewer")),
    ["reviewer-gate", "reviewer-critical"],
  );
  assert.ok(
    r.find("reviewer-gate").prompt.includes("* g.ts") &&
      !r.find("reviewer-gate").prompt.includes("* c.ts"),
  );
  assert.ok(
    r.find("reviewer-critical").prompt.includes("* c.ts") &&
      !r.find("reviewer-critical").prompt.includes("* g.ts"),
  );
  assert.equal(tierOf(r.find("reviewer-gate")), "opus/medium");
  assert.equal(tierOf(r.find("reviewer-critical")), "opus/high");
  assert.ok(r.find("ruler").prompt.includes("G-G1"));
  assert.ok(r.find("fixer").prompt.includes("G-G1"));
  assert.equal(r.res.verdict, "approve");
});

await test("#92 R3: a tier that disagrees with the derived tier throws; both slice lists empty throws", async () => {
  await assert.rejects(
    run(wr, { ...WBASE, gateFiles: ["g.ts"], tier: "critical" }, wrResponder()),
    /disagrees with the derived tier "gate"/,
  );
  await assert.rejects(
    run(wr, { ...WBASE, criticalFiles: [], gateFiles: [] }, wrResponder()),
    /criticalFiles and gateFiles are both empty/,
  );
});

await test("#92 R3: only the last slice's prompt can write the artifact; it carries the earlier slice's verdict and open-finding count; a slice reviewer returning nothing names the slice", async () => {
  const clean = {
    verdict: "approve",
    reviewedSha: hex40("h0full"),
    preconditionFailed: "",
    findings: [],
    answers: [],
    declined: [],
    artifactWritten: false,
  };
  const r = await run(
    wr,
    { ...WBASE, gateFiles: ["g.ts"], criticalFiles: ["c.ts"] },
    wrResponder({
      "reviewer-gate": clean,
      "reviewer-critical": { ...clean, artifactWritten: true },
    }),
  );
  assert.ok(!r.find("reviewer-gate").prompt.includes("Write the artifact"));
  assert.ok(r.find("reviewer-critical").prompt.includes("Write the artifact"));
  assert.ok(
    r
      .find("reviewer-critical")
      .prompt.includes("The gate slice already ran: verdict approve, 0 open"),
  );
  assert.equal(r.res.verdict, "approve");
  assert.equal(r.res.artifactWritten, true);

  const dead = await run(
    wr,
    { ...WBASE, gateFiles: ["g.ts"] },
    wrResponder({ "reviewer-gate": null }),
  );
  assert.equal(dead.res.stopped, "reviewer");
  assert.ok(/gate slice reviewer returned no result/.test(dead.res.problem), dead.res.problem);
});

await test("#92 R3 C1: a critical slice that writes the artifact while the gate slice found a blocking finding is reported as strayArtifact, never swallowed by the merge", async () => {
  const r = await run(
    wr,
    { ...WBASE, gateFiles: ["g.ts"], criticalFiles: ["c.ts"] },
    wrResponder({
      "reviewer-gate": {
        verdict: "fixes",
        reviewedSha: hex40("h0full"),
        preconditionFailed: "",
        findings: [WF("G1", "important", { file: "g.ts" })],
        answers: [],
        declined: [],
        artifactWritten: false,
      },
      "reviewer-critical": {
        verdict: "approve",
        reviewedSha: hex40("h0full"),
        preconditionFailed: "",
        findings: [],
        answers: [],
        declined: [],
        artifactWritten: true, // wrote the artifact despite the gate slice not approving
      },
      "re-reviewer": {
        verdict: "fixes",
        reviewedSha: hex40("h1full"),
        verdicts: [{ id: "G-G1", verdict: "NOT ADDRESSED", evidence: "e" }],
        acceptedStands: [],
        newFindings: [],
        artifactWritten: false,
      },
    }),
  );
  assert.equal(r.res.verdict, "fixes");
  assert.equal(r.res.strayArtifact, "docs/reviews/pr-32.md", JSON.stringify(r.res));
});

await test("#92 R3 C2: a slice with more than 200 files diffs every file, not just the 200 the prompt lists", async () => {
  const files = Array.from({ length: 201 }, (_, i) => `f${i}.ts`);
  const r = await run(
    wr,
    { ...WBASE, criticalFiles: files },
    wrResponder({
      "reviewer-critical": { ...reviewWith([]), verdict: "approve", artifactWritten: true },
    }),
  );
  const p = r.find("reviewer-critical").prompt;
  assert.ok(p.includes('"f200.ts"'), "the 201st file is missing from the diff pathspec");
  assert.ok(p.includes("* f0.ts"), "the prompt file list is missing an early file");
  assert.ok(!p.includes("* f200.ts"), "the listed-files section should still cap at 200 entries");
  assert.ok(
    /sensitive-paths/.test(p),
    "a capped slice must tell the reviewer to derive the rest from .github/sensitive-paths",
  );
});

await test("#92 R3 C3: a non-array criticalFiles or gateFiles throws instead of silently downgrading the tier", async () => {
  await assert.rejects(
    run(
      wr,
      {
        ...WBASE,
        criticalFiles: "packages/core/src/contracts/audit.ts",
        gateFiles: ["package.json"],
      },
      wrResponder(),
    ),
    /"criticalFiles" must be an array of non-empty strings/,
  );
  await assert.rejects(
    run(wr, { ...WBASE, gateFiles: "package.json" }, wrResponder()),
    /"gateFiles" must be an array of non-empty strings/,
  );
  await assert.rejects(
    run(wr, { ...WBASE, criticalFiles: ["ok.ts", ""] }, wrResponder()),
    /"criticalFiles" must be an array of non-empty strings/,
  );
});

await test("#92 R4: fast-path approve is one agent whose prompt carries mode: fast; above the limit or a bad reviewedLines takes no fast path", async () => {
  const r = await run(
    wr,
    { ...WBASE, reviewedLines: 12 },
    wrResponder({ reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true } }),
  );
  assert.deepEqual(r.labels, ["reviewer"]);
  assert.ok(r.find("reviewer").prompt.includes('mode: "fast"'));
  assert.equal(r.res.verdict, "approve");
  assert.equal(r.res.artifactWritten, true);

  const over = await run(
    wr,
    { ...WBASE, reviewedLines: 51 },
    wrResponder({ reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true } }),
  );
  assert.ok(!over.find("reviewer").prompt.includes('mode: "fast"'));

  await assert.rejects(run(wr, { ...WBASE, reviewedLines: -1 }, wrResponder()), /reviewedLines/);
  await assert.rejects(run(wr, { ...WBASE, reviewedLines: 1.5 }, wrResponder()), /reviewedLines/);
  await assert.rejects(run(wr, { ...WBASE, reviewedLines: "12" }, wrResponder()), /reviewedLines/);
});

await test("#92 R4: a fast-path finding runs the normal flow; the re-reviewer's artifact carries no mode line", async () => {
  const r = await run(
    wr,
    { ...WBASE, reviewedLines: 12 },
    wrResponder({ reviewer: reviewWith([WF("I1", "important")]) }),
  );
  assert.deepEqual(r.labels, ["reviewer", "fixer", "progress", "re-reviewer"]);
  assert.ok(r.find("reviewer").prompt.includes('mode: "fast"'));
  assert.ok(!r.find("re-reviewer").prompt.includes("mode:"));
  assert.equal(r.res.verdict, "approve");
});

await test("#92 R4: the fast-path constant in wave-review.js equals FAST_PATH_MAX_LINES in scripts/ci/sensitive-review.ts", async () => {
  const wrSrc = fs.readFileSync(path.join(WF_DIR, "wave-review.js"), "utf8");
  const wrM = /FAST_PATH_MAX_LINES = (\d+)/.exec(wrSrc);
  const ciSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts/ci/sensitive-review.ts"), "utf8");
  const ciM = /FAST_PATH_MAX_LINES = (\d+)/.exec(ciSrc);
  assert.ok(wrM && ciM, "constant not found in one of the files");
  assert.equal(Number(wrM[1]), Number(ciM[1]));
});

await test("#92 R5: contextPath replaces the whole plan and ledger in the reviewer, ruler and re-reviewer prompts; planPath becomes optional", async () => {
  const { planPath, ...noPlan } = WBASE;
  const r = await run(
    wr,
    { ...noPlan, contextPath: "C:/w/w6-context.md" },
    wrResponder({
      reviewer: reviewWith([WF("I1", "important", { planMandated: true })]),
      ruler: {
        rulings: [
          { item: "I1", decision: "fix", reason: "r", costIfWrong: "c", fixInstruction: "fi" },
        ],
      },
    }),
  );
  for (const l of ["reviewer", "ruler", "re-reviewer"]) {
    const p = r.find(l).prompt;
    assert.ok(p.includes("C:/w/w6-context.md"), `${l} lacks the context excerpt`);
    assert.ok(!p.includes("p.md"), `${l} still references the plan path`);
    assert.ok(!p.includes("l.md"), `${l} still references the ledger path`);
  }
});

await test("#92 R6: the cross-cutting budget line is in every reviewer prompt (single, slices, fast path) and the re-reviewer", async () => {
  const single = await run(
    wr,
    WBASE,
    wrResponder({ reviewer: reviewWith([WF("I1", "important")]) }),
  );
  assert.ok(single.find("reviewer").prompt.includes("Cross-cutting budget: at most 3 checks"));
  assert.ok(single.find("re-reviewer").prompt.includes("Cross-cutting budget: at most 3 checks"));

  const fast = await run(
    wr,
    { ...WBASE, reviewedLines: 10 },
    wrResponder({ reviewer: { ...reviewWith([]), verdict: "approve", artifactWritten: true } }),
  );
  assert.ok(fast.find("reviewer").prompt.includes("Cross-cutting budget: at most 3 checks"));

  const clean = {
    verdict: "approve",
    reviewedSha: hex40("h0full"),
    preconditionFailed: "",
    findings: [],
    answers: [],
    declined: [],
  };
  const slices = await run(
    wr,
    { ...WBASE, gateFiles: ["g.ts"], criticalFiles: ["c.ts"] },
    wrResponder({
      "reviewer-gate": { ...clean, artifactWritten: false },
      "reviewer-critical": { ...clean, artifactWritten: true },
    }),
  );
  assert.ok(slices.find("reviewer-gate").prompt.includes("Cross-cutting budget: at most 3 checks"));
  assert.ok(
    slices.find("reviewer-critical").prompt.includes("Cross-cutting budget: at most 3 checks"),
  );
});

// ---------- report ----------
let failed = 0;
for (const [ok, name, err] of results) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n     ${err}`}`);
  if (!ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
