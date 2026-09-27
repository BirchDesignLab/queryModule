import { describe, expect, it } from "vitest";

// Vitest imports jsdom from its own package, so the jsdom that runs the web tests is the one
// the root importer resolves for vitest's peer, not the one in this package's devDependencies.
// The Node floor (engines >=24.15) was raised for jsdom 30; this pins the runtime to it.
describe("jsdom test runtime", () => {
  it("runs the web tests on jsdom 30", () => {
    expect(navigator.userAgent).toMatch(/\bjsdom\/30\./);
  });
});
