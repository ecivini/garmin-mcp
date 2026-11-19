import type { NextConfig } from "next";

const config: NextConfig = {
  // The native Node worker imports these at runtime outside the route bundle.
  outputFileTracingIncludes: {
    "/mcp": [
      "./src/archive/fit-worker.mjs",
      "./node_modules/@garmin/fitsdk/**/*",
      "./node_modules/yauzl/**/*",
      "./node_modules/pend/**/*",
    ],
  },
};

export default config;
