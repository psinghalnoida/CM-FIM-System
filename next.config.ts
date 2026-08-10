import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal, self-contained server bundle for the Docker image (M1).
  output: "standalone",
  experimental: {
    // Enables the unauthorized()/forbidden() functions used by the M3 auth
    // DAL (lib/dal.ts) — this Next.js version's own recommended pattern
    // for 401/403 responses. See docs/AUTH.md.
    authInterrupts: true,
  },
};

export default nextConfig;
