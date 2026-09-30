import { describe, expect, it, vi } from "vitest";
import { testServices } from "../test/render-routes.js";
import { leaveGuards } from "./leave-guard.js";

// The seam sign-out asks before it wipes the device: screens that hold unsaved work register a guard.

describe("leave guards (sign-out seam)", () => {
  it("with no guard, leaving is allowed", async () => {
    expect(await leaveGuards(testServices()).confirm()).toBe(true);
  });

  it("every guard is asked, in order, and one refusal stops the sign-out", async () => {
    const guards = leaveGuards(testServices());
    const calls: string[] = [];
    guards.register(() => {
      calls.push("a");
      return true;
    });
    guards.register(async () => {
      calls.push("b");
      return false;
    });
    guards.register(() => {
      calls.push("c");
      return true;
    });
    expect(await guards.confirm()).toBe(false);
    expect(calls).toEqual(["a", "b"]);
  });

  it("a guard that is unregistered is not asked again", async () => {
    const guards = leaveGuards(testServices());
    const refuse = vi.fn(() => false);
    const off = guards.register(refuse);
    expect(await guards.confirm()).toBe(false);
    off();
    expect(await guards.confirm()).toBe(true);
    expect(refuse).toHaveBeenCalledTimes(1);
  });

  it("a guard that throws or rejects never blocks a sign-out", async () => {
    const guards = leaveGuards(testServices());
    guards.register(() => {
      throw new Error("broken");
    });
    guards.register(() => Promise.reject(new Error("broken too")));
    expect(await guards.confirm()).toBe(true);
  });

  it("each app instance has its own guards", async () => {
    const a = testServices();
    const b = testServices();
    leaveGuards(a).register(() => false);
    expect(await leaveGuards(a).confirm()).toBe(false);
    expect(await leaveGuards(b).confirm()).toBe(true);
    expect(leaveGuards(a)).toBe(leaveGuards(a));
  });
});
