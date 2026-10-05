import { writeSync } from "node:fs";
import { OutcomeWriteError } from "./dispatch/outcome";
import { errorFields } from "./log/error-fields";
import { type RunningServer, startServer, startupErrorFields } from "./startup";

/** Upper bound on the drain after a fatal error; the exit code is already 1 by then. */
const FATAL_DRAIN_MS = 10_000;

/**
 * One fatal JSON line on stderr (spec 5.9): the event and the error's class name only. A
 * message can carry request, query or DB values, so it is never written, and neither is a stack.
 * writeSync, so the line is not lost to an exit while stderr is a pipe.
 */
function writeFatal(msg: string, fields: Record<string, unknown>): void {
  writeSync(2, `${JSON.stringify({ level: "fatal", time: Date.now(), msg, ...fields })}\n`);
}

let server: RunningServer | undefined;
let failing = false;

/**
 * #224: an error that escapes the request path (a listener, a timer, a stream) fails closed
 * (spec 8.1): one fatal line, a bounded drain of the server and the DB, exit 1. A second fatal
 * event during the drain exits at once without another line. A failed outcome write (#536)
 * reaches here through AppDeps.fatal, after the dispatcher is aborted: its line names the
 * write's ids and the failing error's class, never the SIGTERM drain of in-flight jobs.
 */
function fail(event: "uncaughtException" | "unhandledRejection", err: unknown): void {
  if (failing) process.exit(1);
  failing = true;
  process.exitCode = 1;
  if (err instanceof OutcomeWriteError) {
    writeFatal("dispatch outcome write failed", {
      event: "dispatchOutcome",
      ...err.ids,
      error: { name: err.causeName },
    });
  } else {
    writeFatal("uncaught error, exiting", { event, error: { name: errorFields(err).name } });
  }
  setTimeout(() => process.exit(1), FATAL_DRAIN_MS).unref();
  const s = server;
  if (!s) process.exit(1);
  s.stop().then(
    () => process.exit(1),
    () => process.exit(1),
  );
}
process.on("uncaughtException", (err) => fail("uncaughtException", err));
process.on("unhandledRejection", (reason) => fail("unhandledRejection", reason));

try {
  const s = await startServer(process.env);
  server = s;
  const stop = () => {
    s.stop().then(
      () => process.exit(failing ? 1 : 0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch (err) {
  // LS-2 (spec 5.9): the name, plus the message only of a fixed-text startup error (a query
  // error's message quotes its params); a stack is never printed.
  const e = startupErrorFields(err);
  process.stderr.write(
    `${JSON.stringify({ level: "fatal", time: Date.now(), msg: "startup refused", error: e })}\n`,
  );
  process.exit(1);
}
