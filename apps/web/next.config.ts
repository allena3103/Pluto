import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pluto/core", "@pluto/mcp"],
};

export default nextConfig;
