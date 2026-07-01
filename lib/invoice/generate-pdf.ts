// lib/invoice/generate-pdf.ts
import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import type { BillingCalculation } from "./calculate-billing";

export interface InvoicePDFParams {
  subscriber: { plant_id: string; name: string; email: string };
  billing: BillingCalculation;
  paymentURL: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function drawText(
  page: ReturnType<PDFDocument["addPage"]>,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0, 0, 0)
) {
  page.drawText(text, { x, y, font, size, color });
}

export async function generateInvoicePDF(params: InvoicePDFParams): Promise<Uint8Array> {
  const { subscriber, billing, paymentURL } = params;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const blue = rgb(0.05, 0.35, 0.75);
  const gray = rgb(0.45, 0.45, 0.45);
  const black = rgb(0, 0, 0);

  let y = 800;
  const LEFT = 50;
  const RIGHT = 545;

  // Header — company name
  drawText(page, "SOLS Energy", LEFT, y, bold, 20, blue);
  y -= 16;
  drawText(page, "Monthly Home Solar Subscription Invoice", LEFT, y, regular, 11, gray);
  y -= 30;

  // Divider
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 20;

  // Invoice meta
  drawText(page, `Invoice Number:`, LEFT, y, bold, 10, gray);
  drawText(page, billing.invoiceNumber, 160, y, regular, 10, black);
  drawText(page, `Invoice Date:`, 320, y, bold, 10, gray);
  drawText(page, formatDate(billing.billGeneratedDate), 430, y, regular, 10, black);
  y -= 16;

  drawText(page, `Billing Period:`, LEFT, y, bold, 10, gray);
  drawText(page, `${formatDate(billing.startDate)} – ${formatDate(billing.endDate)}`, 160, y, regular, 10, black);
  drawText(page, `Due Date:`, 320, y, bold, 10, gray);
  drawText(page, formatDate(billing.dueDate), 430, y, regular, 10, black);
  y -= 30;

  // Customer details
  drawText(page, "Bill To:", LEFT, y, bold, 11, black);
  y -= 14;
  drawText(page, subscriber.name, LEFT, y, regular, 10, black);
  y -= 13;
  drawText(page, `Plant ID: ${subscriber.plant_id}`, LEFT, y, regular, 10, gray);
  y -= 13;
  drawText(page, subscriber.email, LEFT, y, regular, 10, gray);
  y -= 30;

  // Line items header
  page.drawRectangle({ x: LEFT, y: y - 4, width: RIGHT - LEFT, height: 18, color: rgb(0.93, 0.95, 0.98) });
  drawText(page, "Description", LEFT + 5, y, bold, 9, gray);
  drawText(page, "Energy (kWh)", 320, y, bold, 9, gray);
  drawText(page, "Amount (RM)", 460, y, bold, 9, gray);
  y -= 20;

  // Single line item
  drawText(page, billing.itemDescription, LEFT + 5, y, regular, 10, black);
  drawText(page, billing.totalEnergyKwh.toFixed(2), 320, y, regular, 10, black);
  drawText(page, billing.billingAmount.toFixed(2), 460, y, regular, 10, black);
  y -= 30;

  // Divider
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 15;

  // Totals
  const totalsX = 380;
  drawText(page, "Subtotal:", totalsX, y, regular, 10, gray);
  drawText(page, `RM ${billing.subtotal.toFixed(2)}`, 490, y, regular, 10, black);
  y -= 14;
  const sstPercent = billing.sstAmount > 0 && billing.subtotal > 0
    ? ((billing.sstAmount / billing.subtotal) * 100).toFixed(1)
    : "3.2";
  drawText(page, `SST (${sstPercent}%):`, totalsX, y, regular, 10, gray);
  drawText(page, `RM ${billing.sstAmount.toFixed(2)}`, 490, y, regular, 10, black);
  y -= 14;

  page.drawLine({ start: { x: totalsX, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;
  drawText(page, "Total Payable:", totalsX, y, bold, 11, black);
  drawText(page, `RM ${billing.taxInclusiveAmount.toFixed(2)}`, 490, y, bold, 11, blue);
  y -= 35;

  // Payment link section
  page.drawRectangle({ x: LEFT, y: y - 30, width: RIGHT - LEFT, height: 48, color: rgb(0.95, 0.97, 1.0) });
  drawText(page, "Pay Online:", LEFT + 10, y, bold, 10, blue);
  y -= 15;

  // Truncate URL if too long for display
  const displayUrl = paymentURL.length > 80 ? paymentURL.slice(0, 77) + "..." : paymentURL;
  drawText(page, displayUrl, LEFT + 10, y, regular, 8, blue);
  y -= 30;

  // Footer
  y = 60;
  page.drawLine({ start: { x: LEFT, y: y + 15 }, end: { x: RIGHT, y: y + 15 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  drawText(page, "This is a computer-generated invoice. No signature required.", LEFT, y, regular, 8, gray);
  drawText(page, "SOLS Energy Sdn Bhd", LEFT, y - 12, regular, 8, gray);

  return pdfDoc.save();
}
