import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Vite >=5.1 stamps this literal onto every script/style/link tag it emits into dist/index.html,
  // including the entry script tag (spec 5.9, CSP 'strict-dynamic'; F7). Without it the entry script
  // has no nonce attribute and the browser refuses to run it once strict-dynamic is enforced, even
  // though the response header carries a valid nonce. The API's static-file server replaces the
  // literal "__CSP_NONCE__" with the same fresh per-request value it puts in the
  // Content-Security-Policy header before serving index.html (Track A, Task 27 dependency).
  html: { cspNonce: "__CSP_NONCE__" },
  build: {
    // No inline polyfill script: the API serves index.html with a nonce CSP (spec 5.9).
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:3000", ws: true } },
  },
});
