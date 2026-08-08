import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal, self-contained server bundle for the Docker image (M1).
  output: "standalone",
};

export default nextConfig;
