// Require hook for standalone tsx scripts (currently just prisma/seed.ts)
// that import service-layer modules carrying the "server-only" guard.
// The "server-only" package's fallback implementation throws whenever it's
// loaded outside Next's own build — see docs/OCR.md's "server-only" bug
// for the same issue hitting workers/index.ts, and vitest.config.mts's
// identical alias for tests. Wired in via package.json's db:seed script
// (`NODE_OPTIONS="--require ./scripts/server-only-shim.cjs"`), not by
// stripping the guard from the service layer itself — those files are
// still genuinely server-only from the app's perspective; only this one
// script needs to reach through it to seed realistic demo data via the
// real service functions (audit logging, TAT auto-instantiation, ID
// generation) instead of duplicating that logic with raw db.* calls.
// A Node --require hook has to be CommonJS; it runs before any ESM loader
// (including tsx's own) is registered, so `require`/`require.resolve` are
// intentional here, not an import-style slip.
/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") {
    return require.resolve("../lib/test/server-only-stub.ts");
  }
  return originalResolve.call(this, request, ...rest);
};
