import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1 MB; stock/sales Excel uploads can be much larger.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
