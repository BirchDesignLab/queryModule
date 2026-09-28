// Usage: node scripts/ops/check-triggers.js   (CI boot smoke, spec 9.3 step 11). Exit 0 only when both audit_event triggers exist.
import { runCheckTriggers } from "../../packages/api/src/ops/check-triggers";

process.exitCode = await runCheckTriggers(process.env, process.stdout, process.stderr);
