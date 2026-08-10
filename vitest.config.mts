import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // "server-only" always throws when required outside Next's own
      // webpack build (it relies on Next aliasing it to a no-op for server
      // bundles) — tests run in a trusted server-side Node context, so
      // that guard is irrelevant here and would otherwise break every test
      // that imports a file marked server-only.
      "server-only": path.resolve(
        import.meta.dirname,
        "./lib/test/server-only-stub.ts",
      ),
    },
  },
});
