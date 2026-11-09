import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack does not pick up a lockfile outside
  // this project when the repository is nested in a larger folder.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
