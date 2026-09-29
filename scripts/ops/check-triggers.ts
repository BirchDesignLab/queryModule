// Usage: node scripts/ops/check-triggers.js   (CI boot smoke, spec 9.3 step 11). Exit 0 only when every audit_event and query table trigger exists unaltered.
import { runCheckTriggers } from "../../packages/api/src/ops/check-triggers";

process.exitCode = await runCheckTriggers(process.env, process.stdout, process.stderr);
