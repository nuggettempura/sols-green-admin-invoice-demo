import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the headless-Chromium packages out of the server bundle. Bundlers
  // relocate JS and drop @sparticuz/chromium's binary assets (the Brotli
  // Chromium files under bin/), which makes it fail at runtime on Vercel with
  // "input directory ... does not exist". Externalizing preserves them.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],

  // Externalizing alone doesn't guarantee Vercel's file tracer copies the
  // Chromium binary (loaded dynamically at runtime) into the function bundle.
  // Force-include the bin/ assets for the cron run route so they exist on disk.
  outputFileTracingIncludes: {
    "/api/bulk-invoice/run": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
