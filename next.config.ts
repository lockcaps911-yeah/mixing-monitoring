import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/dataReceiver/insert/*/*': [
      './Data Monitoring Mixing - PAGE 1 LINE 4 (1).csv',
      './Data Monitoring Mixing - PAGE 2 LINE 4 (1).csv',
      './Data Monitoring Mixing - PAGE 3 LINE 4 (1).csv',
      './Data Monitoring Mixing - PAGE 4 LINE 4 (1).csv',
    ],
  },
};

export default nextConfig;
