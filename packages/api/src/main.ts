import { startServer } from "./startup";

try {
  const s = await startServer(process.env);
  const stop = () => {
    s.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch (err) {
  // Error name and message only (spec 5.9): startup errors never carry key material, and a
  // stack is never printed.
  const e =
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { name: "unknown", message: "" };
  process.stderr.write(
    `${JSON.stringify({ level: "fatal", time: Date.now(), msg: "startup refused", error: e })}\n`,
  );
  process.exit(1);
}
