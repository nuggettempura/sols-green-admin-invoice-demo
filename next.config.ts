import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the headless-Chromium packages out of the server bundle. Bundlers
  // relocate JS and drop @sparticuz/chromium's binary assets (the Brotli
  // Chromium files under bin/), which makes it fail at runtime on Vercel with
  // "input directory ... does not exist". Externalizing preserves them.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
