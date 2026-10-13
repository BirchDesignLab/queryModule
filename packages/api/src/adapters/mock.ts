import { checkFixturePolicy, type FixtureDiagnostic } from "@querymodule/core/config";
import type { MockFile, SourcePayload } from "@querymodule/core/contracts";
import { matchMockScenario } from "@querymodule/core/mock";
import type { LoadedConfig } from "../config/load";
import { abortError, type Timers } from "../dispatch/timers";
import type { Logger } from "../log/logger";
import { type AdapterFactory, type SourceAdapter, SourceError } from "./types";

/** Never settles on its own; rejects with an AbortError when signal aborts. Holds no timer. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

const failClosed: SourceAdapter = {
  query: async () => {
    throw new SourceError("failed");
  },
};

/**
 * The adapter over one already-checked mock (spec 5.4; FR-043, FR-044): the prototype's canned
 * responses, never real CJIS data. Latency `min + floor(random() * (max - min + 1))` ms through
 * timers.sleep, then the shared matcher's answer (matchMockScenario, #565): the matched scenario's
 * respond or behaviour, else the entry's default. An unknown source or query type fails closed.
 * Answers are copies, so a caller never changes the snapshot's mock. Errors carry the code only,
 * never request values (spec 5.9).
 */
function adapterOver(o: { mock: MockFile; timers: Timers; random: () => number }): SourceAdapter {
  return {
    async query(req, _creds, signal) {
      const match = matchMockScenario(o.mock, req.sourceId, {
        queryType: req.queryType,
        typeValues: req.types,
        values: req.values,
      });
      const source = match && o.mock.sources[req.sourceId];
      if (!match || !source) throw new SourceError("failed");
      const [min, max] = source.latencyMs;
      await o.timers.sleep(min + Math.floor(o.random() * (max - min + 1)), signal);
      if (match.outcome.kind === "respond") {
        return structuredClone<SourcePayload>(match.outcome.payload);
      }
      switch (match.outcome.behavior) {
        case "timeout":
          return untilAborted(signal);
        case "error":
          throw new SourceError("failed");
        case "credentialsRejected":
          throw new SourceError("credentialsRejected");
      }
    },
  };
}

/**
 * A private copy of the mock and its fixture policy findings (AW2 review C-m2). The adapter
 * serves only the copy that was checked, so a later change to the caller's or the snapshot's
 * mock is never served.
 */
function checkedCopy(mock: MockFile): { mock: MockFile; findings: FixtureDiagnostic[] } {
  const copy = structuredClone(mock);
  return { mock: copy, findings: checkFixturePolicy(copy) };
}

/**
 * The mock adapter over one mock (spec 5.4, 10.8): it runs the fixture policy itself, so no
 * caller can serve an unchecked mock (AW2 review C-m1), and serves its checked private copy
 * (C-m2). A mock that breaks the policy gives an adapter that fails every call closed,
 * SourceError("failed").
 */
export function createMockAdapter(o: {
  mock: MockFile;
  timers: Timers;
  random: () => number;
}): SourceAdapter {
  const { mock, findings } = checkedCopy(o.mock);
  return findings.length > 0 ? failClosed : adapterOver({ ...o, mock });
}

/** The snapshot's ids for a log line: configHash, and versionId when the snapshot is stored. */
function snapshotIds(snapshot: LoadedConfig): Record<string, string> {
  const versionId = (snapshot as { versionId?: unknown }).versionId;
  return typeof versionId === "string"
    ? { configHash: snapshot.configHash, versionId }
    : { configHash: snapshot.configHash };
}

/**
 * The built-in mock factory (spec 5.4): an adapter over a checked private copy of the snapshot's
 * stored mock (#493, never the image's file; C-m2). It fails closed, every call
 * SourceError("failed"), when the snapshot has no mock, or when the stored mock breaks the fixture
 * policy (it may predate it): one error log line per snapshot (the registry memoises) with the ids,
 * the count and the pointers, never a value (spec 5.9, 10.8).
 */
export function createMockFactory(logger: Logger): AdapterFactory {
  return {
    apiVersion: 1,
    kind: "mock",
    create({ snapshot, timers, random }) {
      if (snapshot.mock === null) {
        logger.error("mock adapter has no mock", snapshotIds(snapshot));
        return failClosed;
      }
      const { mock, findings } = checkedCopy(snapshot.mock);
      if (findings.length > 0) {
        logger.error("mock fixture policy failed", {
          ...snapshotIds(snapshot),
          count: findings.length,
          pointers: findings.map((f) => f.pointer),
        });
        return failClosed;
      }
      return adapterOver({ mock, timers, random });
    },
  };
}
