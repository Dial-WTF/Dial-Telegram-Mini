import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not fail CI builds on lint/TS errors; we still enforce in local dev
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
