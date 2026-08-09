import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN access during local network testing (phone / other devices).
  allowedDevOrigins: ["172.20.10.8", "localhost", "127.0.0.1"],
  experimental: {
    serverActions: {
      // Default is 1 MB; stock/sales Excel uploads can be much larger.
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
