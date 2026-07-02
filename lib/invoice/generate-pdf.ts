// lib/invoice/generate-pdf.ts
import puppeteer from "puppeteer";
import { buildInvoiceHtml } from "./invoice-html-template";
import type { BillingCalculation } from "./calculate-billing";

export interface InvoicePDFParams {
  subscriber: { plant_id: string; name: string; email: string };
  billing: BillingCalculation;
  paymentURL: string;
}

export async function generateInvoicePDF(params: InvoicePDFParams): Promise<Uint8Array> {
  const html = buildInvoiceHtml(params);

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
    });
    return new Uint8Array(pdfBuffer);
  } finally {
    await browser.close();
  }
}
