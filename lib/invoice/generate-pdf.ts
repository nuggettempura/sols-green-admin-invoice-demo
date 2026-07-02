// lib/invoice/generate-pdf.ts
import type { Browser } from "puppeteer-core";
import { buildInvoiceHtml } from "./invoice-html-template";
import type { BillingCalculation } from "./calculate-billing";
import { launchBrowser } from "./launch-browser";

export interface InvoicePDFParams {
  subscriber: { plant_id: string; name: string; email: string };
  billing: BillingCalculation;
  paymentURL: string;
}

async function renderPdf(browser: Browser, html: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
    });
    return new Uint8Array(pdfBuffer);
  } finally {
    await page.close();
  }
}

/**
 * Generates an invoice PDF. Pass an existing `browser` (e.g. shared across a
 * batch run) to avoid the cost of launching a new Chromium process per call;
 * otherwise a temporary browser is launched and closed for this call alone.
 */
export async function generateInvoicePDF(
  params: InvoicePDFParams,
  browser?: Browser
): Promise<Uint8Array> {
  const html = buildInvoiceHtml(params);

  if (browser) {
    return renderPdf(browser, html);
  }

  const ownBrowser = await launchBrowser();
  try {
    return await renderPdf(ownBrowser, html);
  } finally {
    await ownBrowser.close();
  }
}
