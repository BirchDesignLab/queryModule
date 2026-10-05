import { ADAPTER_ERROR_CODES, type AdapterErrorCode } from "@querymodule/core/contracts";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { BUILTIN_ADAPTER_KINDS } from "../../src/adapters/kinds";
import { createAdapterRegistry } from "../../src/adapters/registry";
import { type AdapterFactory, type SourceAdapter, SourceError } from "../../src/adapters/types";
import { BUILTIN_ADAPTER_KINDS as LOAD_KINDS, type LoadedConfig } from "../../src/config/load";
import { systemTimers } from "../../src/dispatch/timers";
import { captureLogger } from "../helpers/fixture";

// Spec 5.4 (FR-043): adapters are created per config snapshot and memoised per snapshot, so a
// publish never swaps an adapter under a running job; mock is refused unless allowed.
function snapshot(): LoadedConfig {
  return { configHash: "h" } as unknown as LoadedConfig;
}

function fakeFactory(kind = "mock") {
  const create = vi.fn((): SourceAdapter => ({ query: async () => ({}) }));
  const factory: AdapterFactory = { apiVersion: 1, kind, create };
  return { factory, create };
}

const base = { timers: systemTimers, random: () => 0.5, logger: captureLogger() };

describe("BUILTIN_ADAPTER_KINDS", () => {
  it("is exactly mock, and config/load re-exports the same definition", () => {
    expect(BUILTIN_ADAPTER_KINDS).toEqual(["mock"]);
    expect(LOAD_KINDS).toBe(BUILTIN_ADAPTER_KINDS);
  });
});

describe("createAdapterRegistry", () => {
  it("returns the same adapter for the same snapshot and a new one for a new snapshot", () => {
    const f = fakeFactory();
    const reg = createAdapterRegistry({ ...base, allowMockSources: true, factories: [f.factory] });
    const s1 = snapshot();
    const a1 = reg.get("mock", s1);
    expect(reg.get("mock", s1)).toBe(a1);
    const a2 = reg.get("mock", snapshot());
    expect(a2).not.toBe(a1);
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("passes the snapshot, timers and random to the factory", () => {
    const f = fakeFactory();
    const random = () => 0.25;
    const reg = createAdapterRegistry({
      allowMockSources: true,
      timers: systemTimers,
      random,
      logger: captureLogger(),
      factories: [f.factory],
    });
    const s = snapshot();
    reg.get("mock", s);
    expect(f.create).toHaveBeenCalledWith({ snapshot: s, timers: systemTimers, random });
  });

  it("memoises per kind within one snapshot", () => {
    const m = fakeFactory("mock");
    const o = fakeFactory("other");
    const reg = createAdapterRegistry({
      ...base,
      allowMockSources: true,
      factories: [m.factory, o.factory],
    });
    const s = snapshot();
    const am = reg.get("mock", s);
    const ao = reg.get("other", s);
    expect(am).not.toBe(ao);
    expect(reg.get("other", s)).toBe(ao);
    expect(reg.get("mock", s)).toBe(am);
    expect(o.create).toHaveBeenCalledTimes(1);
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it("throws on mock when allowMockSources is false, without calling the factory", () => {
    const f = fakeFactory();
    const reg = createAdapterRegistry({ ...base, allowMockSources: false, factories: [f.factory] });
    expect(() => reg.get("mock", snapshot())).toThrow("mock adapter disabled");
    expect(f.create).not.toHaveBeenCalled();
  });

  it("throws on mock when allowMockSources is false with the default factories", () => {
    const reg = createAdapterRegistry({ ...base, allowMockSources: false });
    expect(() => reg.get("mock", snapshot())).toThrow("mock adapter disabled");
  });

  it("throws on an unknown kind, and the message does not echo the kind", () => {
    const reg = createAdapterRegistry({ ...base, allowMockSources: true, factories: [] });
    let caught: unknown;
    try {
      reg.get("SMITH", snapshot());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain("unknown adapter kind");
    expect(String(caught)).not.toContain("SMITH");
  });

  it("refuses two factories for one kind", () => {
    expect(() =>
      createAdapterRegistry({
        ...base,
        allowMockSources: true,
        factories: [fakeFactory().factory, fakeFactory().factory],
      }),
    ).toThrow("duplicate adapter kind");
  });
});

describe("SourceError", () => {
  it("carries exactly the ADAPTER_ERROR_CODES codes, with no adapter text", () => {
    expectTypeOf<ConstructorParameters<typeof SourceError>[0]>().toEqualTypeOf<AdapterErrorCode>();
    expect(ADAPTER_ERROR_CODES).toEqual(["credentialsRejected", "failed"]);
    for (const code of ADAPTER_ERROR_CODES) {
      const e = new SourceError(code);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe("SourceError");
      expect(e.code).toBe(code);
      expect(e.message).toBe(code);
    }
  });
});
