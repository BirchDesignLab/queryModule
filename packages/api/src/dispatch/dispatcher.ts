import type { AdapterErrorCode, AuditActor, SourcePayload } from "@querymodule/core/contracts";
import type { CanonicalValue } from "@querymodule/core/rules";
import { SourceError } from "../adapters/types";
import type { LoadedConfig } from "../config/load";
import type { AppDeps } from "../deps";
import { errorFields } from "../log/error-fields";
import type { Logger } from "../log/logger";

/** Spec 5.2 defaults; constants, not config (D-A15). */
export const DISPATCH_CAPS = { perSource: 4, global: 32 } as const;

/** One (part, source) adapter call, built from T1's rows and prepare's in-memory plan. */
export interface DispatchJob {
  correlationId: string;
  partId: number;
  sourceId: string;
  resultId: string;
  userId: string;
  /** The requester's audit envelope from T1, so sourceResponded is findable per user (spec 4.7, SEC-010). */
  actor: AuditActor;
  identitySource: "local" | "host";
  hostSubject?: string;
  queryType: string;
  types: Readonly<Record<string, string>>;
  /** The part's visible effective values, in memory from prepare (D-A13); never logged. */
  values: Readonly<Record<string, CanonicalValue>>;
  /** The config snapshot pinned at prepare, never the live one at dispatch time. */
  snapshot: LoadedConfig;
  adapterKind: string;
  credentialUserId: string | null;
  delegationId: string | null;
  /** From the snapshot's source config (DispatchPair lacks it). */
  requiresCredentials: boolean;
  /** Epoch ms: acknowledgedAt + the source's timeoutMs from the snapshot. */
  deadline: number;
}

export type Outcome =
  | { status: "returned"; payload: SourcePayload }
  | { status: "failed" | "credentialsRejected"; errorCode: AdapterErrorCode }
  | { status: "timedOut" }
  | { status: "credentialsMissing" };

export interface Dispatcher {
  /** After stopIntake() or abortAll() it refuses: the rows stay pending and the next start sweeps them. */
  enqueue(jobs: readonly DispatchJob[]): void;
  /** Queued, running, and reported but with onOutcome not yet resolved. */
  inFlight(): number;
  /** The latest deadline among in-flight jobs (the drain bound); null when idle. */
  maxDeadline(): number | null;
  stopIntake(): void;
  /** Resolves when inFlight() is 0, or at the bound. */
  drain(boundMs: number): Promise<void>;
  /** Fatal path: aborts every running signal, drops the queue and refuses further adapter calls. */
  abortAll(): void;
}

/** AppDeps' fields the dispatcher reads; any Logger will do, the root one not required. */
type DispatcherDeps = Pick<AppDeps, "adapters" | "clock" | "monotonic" | "timers"> & {
  logger: Logger;
};
type OnOutcome = (job: DispatchJob, outcome: Outcome, latencyMs: number) => Promise<void>;

interface Running {
  controller: AbortController;
  deadlineTimer: unknown;
  /** True once an outcome is reported or abortAll dropped the job; later settlements change nothing. */
  done: boolean;
}

/**
 * The in-process dispatcher (spec 5.2 step 5; FR-040, FR-041, FR-043, FR-044, NFR-002). Jobs run
 * FIFO under DISPATCH_CAPS, a job blocked on its source's cap never holding back a free source.
 * Each job gets exactly one outcome: credentialsMissing without an adapter call when the source
 * requires credentials and none is set; timedOut without a call, at its deadline, when still
 * queued then (its own queue timer fires even while its source stays full; FR-044, spec 5.4);
 * otherwise the adapter's answer raced against the deadline, where the signal aborts and the
 * outcome is timedOut. No retries. Log lines carry ids and error classes only (spec 5.9).
 */
export function createDispatcher(d: DispatcherDeps, onOutcome: OnOutcome): Dispatcher {
  const queue: DispatchJob[] = [];
  /** One deadline timer per queued job, so a deadline passing in the queue is reported on time. */
  const queueTimers = new Map<DispatchJob, unknown>();
  const running = new Map<DispatchJob, Running>();
  /** Every job not yet finished: queued, running, or waiting on onOutcome. */
  const tracked = new Set<DispatchJob>();
  const idleWaiters = new Set<() => void>();
  let intake = true;
  let aborted = false;

  function untrack(job: DispatchJob): void {
    tracked.delete(job);
    if (tracked.size > 0) return;
    for (const wake of idleWaiters) wake();
  }

  function report(job: DispatchJob, outcome: Outcome, latencyMs: number): void {
    new Promise<void>((resolve) => resolve(onOutcome(job, outcome, latencyMs)))
      .catch((e: unknown) => {
        d.logger.error("dispatch outcome failed", {
          resultId: job.resultId,
          sourceId: job.sourceId,
          error: { name: errorFields(e).name },
        });
      })
      .finally(() => untrack(job));
  }

  function release(job: DispatchJob, r: Running): void {
    r.done = true;
    d.timers.clearTimeout(r.deadlineTimer);
    running.delete(job);
  }

  function start(job: DispatchJob): void {
    const startedMs = d.monotonic.nowMs();
    const controller = new AbortController();
    const r: Running = { controller, deadlineTimer: undefined, done: false };
    running.set(job, r);
    const finish = (outcome: Outcome) => {
      release(job, r);
      report(job, outcome, d.monotonic.nowMs() - startedMs);
      pump();
    };
    r.deadlineTimer = d.timers.setTimeout(() => {
      controller.abort();
      finish({ status: "timedOut" });
    }, job.deadline - d.clock.now());
    const settled = (outcome: Outcome, abortAck = false) => {
      if (!r.done) {
        finish(outcome);
        return;
      }
      // abortAll dropped the job: the process is failing closed, so nothing more is said.
      if (aborted) return;
      // An AbortError after our own abort is the adapter honouring it, not a late answer (AW3 critic c).
      if (abortAck) return;
      d.logger.warn("dispatch late settlement", { resultId: job.resultId, sourceId: job.sourceId });
    };
    // The executor runs now, so the adapter call starts synchronously; a throw from the registry
    // or the adapter becomes a rejection.
    new Promise<SourcePayload>((resolve) =>
      resolve(
        d.adapters.get(job.adapterKind, job.snapshot).query(
          {
            correlationId: job.correlationId,
            partId: job.partId,
            sourceId: job.sourceId,
            queryType: job.queryType,
            values: job.values,
            types: job.types,
          },
          null,
          controller.signal,
        ),
      ),
    ).then(
      (payload) => settled({ status: "returned", payload }),
      (e: unknown) =>
        settled(
          e instanceof SourceError
            ? { status: e.code, errorCode: e.code }
            : { status: "failed", errorCode: "failed" },
          controller.signal.aborted && e instanceof DOMException && e.name === "AbortError",
        ),
    );
  }

  /** Running jobs on one source; at most DISPATCH_CAPS.global to count. */
  function runningOn(sourceId: string): number {
    let n = 0;
    for (const job of running.keys()) if (job.sourceId === sourceId) n += 1;
    return n;
  }

  /** Takes the job at i out of the queue and clears its queue deadline timer, if armed. */
  function dequeue(i: number, job: DispatchJob): void {
    queue.splice(i, 1);
    d.timers.clearTimeout(queueTimers.get(job));
    queueTimers.delete(job);
  }

  /** Starts or settles every queued job it can, in FIFO order. */
  function pump(): void {
    let i = 0;
    while (i < queue.length) {
      const job = queue[i] as DispatchJob;
      if (job.requiresCredentials && job.credentialUserId === null) {
        dequeue(i, job);
        report(job, { status: "credentialsMissing" }, 0);
        continue;
      }
      if (d.clock.now() >= job.deadline) {
        dequeue(i, job);
        report(job, { status: "timedOut" }, 0);
        continue;
      }
      if (
        running.size >= DISPATCH_CAPS.global ||
        runningOn(job.sourceId) >= DISPATCH_CAPS.perSource
      ) {
        // Still waiting for a slot: its deadline fires pump, which reports it timedOut on time.
        if (!queueTimers.has(job)) {
          queueTimers.set(job, d.timers.setTimeout(pump, job.deadline - d.clock.now()));
        }
        i += 1;
        continue;
      }
      dequeue(i, job);
      start(job);
    }
  }

  return {
    enqueue(jobs) {
      if (!intake || aborted) {
        d.logger.warn("dispatch enqueue refused", { count: jobs.length });
        return;
      }
      for (const job of jobs) {
        queue.push(job);
        tracked.add(job);
      }
      pump();
    },
    inFlight: () => tracked.size,
    maxDeadline() {
      let max: number | null = null;
      for (const job of tracked) if (max === null || job.deadline > max) max = job.deadline;
      return max;
    },
    stopIntake() {
      intake = false;
    },
    drain(boundMs) {
      if (tracked.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const wake = () => {
          idleWaiters.delete(wake);
          d.timers.clearTimeout(bound);
          resolve();
        };
        const bound = d.timers.setTimeout(wake, boundMs);
        idleWaiters.add(wake);
      });
    },
    abortAll() {
      aborted = true;
      for (const job of queue.splice(0)) {
        d.timers.clearTimeout(queueTimers.get(job));
        queueTimers.delete(job);
        untrack(job);
      }
      for (const [job, r] of [...running]) {
        release(job, r);
        r.controller.abort();
        untrack(job);
      }
    },
  };
}
