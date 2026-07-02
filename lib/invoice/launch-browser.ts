// lib/invoice/launch-browser.ts
import puppeteerCore, { Browser } from "puppeteer-core";

/**
 * Launches a headless Chromium instance suitable for the current runtime.
 *
 * On Vercel, the full `puppeteer` package (which bundles ~300MB of Chromium)
 * exceeds serverless function size limits, so we use `puppeteer-core` with
 * `@sparticuz/chromium`'s slim, Lambda/Vercel-compatible binary instead.
 *
 * Locally, `@sparticuz/chromium`'s binary targets Amazon Linux and won't run
 * on Windows/macOS dev machines, so we point `puppeteer-core` at the
 * developer's already-installed Google Chrome via the `channel` option.
 */
export async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  return puppeteerCore.launch({ channel: "chrome", headless: true });
}
