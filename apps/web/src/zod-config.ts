// Imported first by main.tsx (#132 step 12). zod 4 otherwise probes eval with new Function("")
// on first parse; the nonce CSP (spec 5.9) blocks it and reports a script-src eval violation.
// jitless parses without generated code. Web only: the api server keeps zod's JIT.
import { z } from "zod";

z.config({ jitless: true });
