import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pluto/core", "@pluto/mcp"],
  // The demo MCP URL carries its secret in the path; keep it out of dev request logs.
  logging: {
    incomingRequests: {
      ignore: [/\/api\/mcp\/demo\//],
    },
  },
};

export default nextConfig;
