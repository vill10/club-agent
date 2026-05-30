import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Resolve the "@/*" path alias (mirrors tsconfig.json) so tests can import
// modules that pull in components via the alias.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
