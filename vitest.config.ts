import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the same "@/*" → "./src/*" path alias the app uses (tsconfig paths),
// so tests can import route handlers and modules by their canonical alias.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
