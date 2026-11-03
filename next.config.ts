import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* Keep the standalone bundle lean: these folders live in the project
     root (the server's cwd at runtime), so there is no need to duplicate
     them inside .next/standalone. Saves ~200MB+ of build-time disk. */
  outputFileTracingExcludes: {
    "*": [
      "scripts/**",
      "skills/**",
      "mini-services/**",
      "download/**",
      "screenshots/**",
      "upload/**",
      "node_modules/typescript/**",
    ],
  },
};

export default nextConfig;
