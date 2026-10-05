// Preloaded (node --import) into a child main.ts by main-fatal.test.ts only (#224, #231). Once the
// test writes QM_FATAL_TRIGGER, this raises QM_FATAL_KIND outside any request path, with
// QM_FATAL_MESSAGE as the error message:
//   exception  one uncaught exception
//   rejection  one unhandled rejection
//   double     two uncaught exceptions, the second mid-drain
//   sigterm    one uncaught exception, then SIGTERM emitted in-process during the drain
//   outcome    what AppDeps.fatal raises for a failed outcome write (#536): an OutcomeWriteError
import { existsSync } from "node:fs";

const file = process.env.QM_FATAL_TRIGGER;
const kind = process.env.QM_FATAL_KIND;
const message = process.env.QM_FATAL_MESSAGE ?? "fatal-trigger";
// The same module instance main.ts imports, so its instanceof check holds.
const outcome = kind === "outcome" ? await import("../../src/dispatch/outcome.ts") : undefined;
if (file) {
  const poll = setInterval(() => {
    if (!existsSync(file)) return;
    clearInterval(poll);
    if (kind === "rejection") void Promise.reject(new Error(message));
    else if (kind === "double") {
      // A microtask queued before the throw runs right after the first fatal handler, mid-drain.
      queueMicrotask(() => {
        throw new Error(`${message} (second)`);
      });
      throw new Error(message);
    } else if (kind === "sigterm") {
      queueMicrotask(() => process.emit("SIGTERM"));
      throw new Error(message);
    } else if (outcome) {
      throw new outcome.OutcomeWriteError(
        {
          correlationId: "0190a000-0000-7000-8000-000000000001",
          resultId: "0190a000-0000-7000-8000-000000000002",
          sourceId: "stateSource",
          partId: 0,
        },
        "Error",
      );
    } else throw new Error(message);
  }, 50);
  poll.unref();
}
