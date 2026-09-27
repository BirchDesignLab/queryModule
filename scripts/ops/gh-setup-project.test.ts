import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// gh-setup-project.mjs is network glue and stays out of coverage, but the
// specific shape of its wave-parent ensureIssue call is a static fact we can
// check without hitting GitHub.
const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "gh-setup-project.mjs");
const source = readFileSync(scriptPath, "utf8");

describe("gh-setup-project: wave parent close (#79 item 1, critic:I1)", () => {
  it("never plans a close of a wave parent issue", () => {
    // Closing a wave parent is project-sync's job (docs/project-board.md, "a
    // wave parent closes when all of its tasks are closed"). The setup
    // script's ensureIssue call for a wave issue must never pass a `closed`
    // key at all, so a rerun never forces a wave parent issue closed itself.
    const start = source.indexOf("const waveIssue = new Map();");
    const end = source.indexOf("const followUps = new Map();");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const waveSetupBlock = source.slice(start, end);
    expect(waveSetupBlock).not.toMatch(/closed\s*:/);
  });
});
