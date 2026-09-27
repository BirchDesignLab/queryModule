import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // No source maps in the production build: nothing extra to serve from a CJIS-facing app.
  build: { outDir: "dist", sourcemap: false },
  server: { port: 5173, strictPort: true },
});
