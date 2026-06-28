import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@nebula/core",
    "@nebula/evm-client",
    "@nebula/stellar-client",
  ],
};

export default nextConfig;
