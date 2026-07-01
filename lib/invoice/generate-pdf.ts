// lib/invoice/generate-pdf.ts
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import type { BillingCalculation } from "./calculate-billing";

export interface InvoicePDFParams {
  subscriber: { plant_id: string; name: string; email: string };
  billing: BillingCalculation;
  paymentURL: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDateUTC(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00Z");
}

function formatDDMMYYYY(dateStr: string): string {
  return parseDateUTC(dateStr)
    .toLocaleDateString("en-MY", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    .replace(/\//g, ".");
}

function addDays(dateStr: string, days: number): string {
  const d = parseDateUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Amount to words (handles 0–9999.99 RM)
// ---------------------------------------------------------------------------

const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
  "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
  "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o > 0 ? "-" + ONES[o] : "");
}

function threeDigitWords(n: number): string {
  if (n === 0) return "";
  if (n < 100) return twoDigitWords(n);
  const h = Math.floor(n / 100);
  const rem = n % 100;
  return ONES[h] + " HUNDRED" + (rem > 0 ? " " + twoDigitWords(rem) : "");
}

function amountToWords(amount: number): string {
  const ringgit = Math.floor(amount);
  const cents = Math.round((amount - ringgit) * 100);

  let words = "RINGGIT MALAYSIA ";

  if (ringgit === 0) {
    words += "ZERO";
  } else if (ringgit < 1000) {
    words += threeDigitWords(ringgit);
  } else {
    const thousands = Math.floor(ringgit / 1000);
    const rem = ringgit % 1000;
    words += threeDigitWords(thousands) + " THOUSAND";
    if (rem > 0) words += " " + threeDigitWords(rem);
  }

  if (cents > 0) {
    words += " AND CENTS " + twoDigitWords(cents);
  }

  return words + " ONLY";
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function dt(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0, 0, 0)
) {
  page.drawText(text, { x, y, font, size, color });
}

function drawHLine(page: PDFPage, x1: number, x2: number, y: number, thickness = 0.5) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: rgb(0.5, 0.5, 0.5) });
}

function drawRect(page: PDFPage, x: number, y: number, w: number, h: number) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.5, color: rgb(1, 1, 1) });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateInvoicePDF(params: InvoicePDFParams): Promise<Uint8Array> {
  const { subscriber, billing, paymentURL } = params;
  const { name, email } = subscriber;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const blue = rgb(0.0, 0.37, 0.75);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  // -------------------------------------------------------------------------
  // Section 1 — Header
  // -------------------------------------------------------------------------
  let y = 790;
  const LEFT = 40;
  const RIGHT = 555;

  dt(page, "SOLS GREEN FINTECH SDN. BHD.", LEFT, y, bold, 12, black);
  y -= 14;
  dt(page, "Level 5, Menara SOLS, Kuala Lumpur City Centre, 50088 Kuala Lumpur, Malaysia.", LEFT, y, regular, 9, gray);
  y -= 13;
  dt(page, "Service Tax Registration No.: W10-2507-32000940", LEFT, y, regular, 9, gray);

  // Right column
  dt(page, "INVOICE", 430, 790, bold, 18, black);

  y -= 18;
  drawHLine(page, LEFT, RIGHT, y);
  y -= 16;

  // -------------------------------------------------------------------------
  // Section 2 — Customer & Invoice Details
  // -------------------------------------------------------------------------

  // Left box: Invoice To / Delivery To
  const boxTop = y;
  const boxH = 110;
  const boxW = 250;
  drawRect(page, LEFT, boxTop - boxH, boxW, boxH);

  let lx = LEFT + 6;
  let ly = boxTop - 14;
  dt(page, "Invoice To", lx, ly, bold, 9, black);
  ly -= 13;
  dt(page, name.toUpperCase(), lx, ly, regular, 9, black);
  ly -= 12;
  dt(page, email, lx, ly, regular, 8, gray);
  ly -= 12;
  drawHLine(page, LEFT + 4, LEFT + boxW - 4, ly + 4, 0.3);
  ly -= 8;
  dt(page, "Delivery To", lx, ly, bold, 9, black);
  ly -= 13;
  dt(page, name.toUpperCase(), lx, ly, regular, 9, black);
  ly -= 12;
  dt(page, email, lx, ly, regular, 8, gray);

  // Right grid: label-value pairs
  const rx = 305;
  const rvx = 430;
  let ry = boxTop - 12;
  const rowGap = 16;

  const today = todayStr();
  const dueDate30 = addDays(billing.endDate, 30);

  const metaRows: [string, string][] = [
    ["Invoice No.", billing.nonce],
    ["Invoice Date", formatDDMMYYYY(today)],
    ["Delivery Period", `${formatDDMMYYYY(billing.startDate)} - ${formatDDMMYYYY(billing.endDate)}`],
    ["Payment Terms", "Within 30 days"],
    ["Due Date", formatDDMMYYYY(dueDate30)],
    ["Attention to", name.toUpperCase()],
  ];

  for (const [label, value] of metaRows) {
    dt(page, label, rx, ry, bold, 9, black);
    dt(page, value, rvx, ry, regular, 9, black);
    ry -= rowGap;
  }

  y = boxTop - boxH - 14;

  // -------------------------------------------------------------------------
  // Section 3 — Payment URL
  // -------------------------------------------------------------------------
  if (paymentURL) {
    dt(page, `Pay Online: ${paymentURL}`, LEFT, y, regular, 9, blue);
    y -= 18;
  }

  // -------------------------------------------------------------------------
  // Section 4 — Item Table
  // -------------------------------------------------------------------------

  // Derived values
  const energyP0 = Math.min(billing.totalEnergyKwh, 600);
  const energyPB = Math.max(0, billing.totalEnergyKwh - 600);
  const amountP0 = round2(energyP0 * 1.5);
  const amountPB = round2(energyPB * 1.5);
  const taxAmountPB = round2(amountPB * 0.032);

  // Table header
  const colX = [40, 100, 255, 310, 355, 400, 465, 520];
  const headers = ["Item", "Description", "Qty (kWh)", "Tax (%)", "Code", "Tax Amt", "Unit Price", "Amount"];

  y -= 4;
  page.drawRectangle({ x: LEFT, y: y - 4, width: RIGHT - LEFT, height: 16, color: rgb(0.88, 0.88, 0.88) });
  for (let i = 0; i < headers.length; i++) {
    dt(page, headers[i], colX[i], y, bold, 8, black);
  }
  y -= 6;
  drawHLine(page, LEFT, RIGHT, y);
  y -= 14;

  // Row 1 — P0 (first 600 kWh, no SST)
  if (energyP0 > 0) {
    dt(page, "000010", colX[0], y, regular, 8, black);
    dt(page, "Renewable Energy (First 600 kWh)", colX[1], y, regular, 8, black);
    dt(page, energyP0.toFixed(3), colX[2], y, regular, 8, black);
    dt(page, "0", colX[3], y, regular, 8, black);
    dt(page, "P0", colX[4], y, regular, 8, black);
    dt(page, "0.00", colX[5], y, regular, 8, black);
    dt(page, "1.500", colX[6], y, regular, 8, black);
    dt(page, amountP0.toFixed(2), colX[7], y, regular, 8, black);
    y -= 14;
  }

  // Row 2 — PB (remaining kWh, 3.2% SST)
  if (energyPB > 0) {
    dt(page, "000020", colX[0], y, regular, 8, black);
    dt(page, "Renewable Energy (Remaining kWh)", colX[1], y, regular, 8, black);
    dt(page, energyPB.toFixed(3), colX[2], y, regular, 8, black);
    dt(page, "3.2", colX[3], y, regular, 8, black);
    dt(page, "PB", colX[4], y, regular, 8, black);
    dt(page, taxAmountPB.toFixed(2), colX[5], y, regular, 8, black);
    dt(page, "1.500", colX[6], y, regular, 8, black);
    dt(page, amountPB.toFixed(2), colX[7], y, regular, 8, black);
    y -= 14;
  }

  drawHLine(page, LEFT, RIGHT, y);
  y -= 14;

  // Footer rows
  const totalNoSst = round2(amountP0 + amountPB);
  const grandTotal = round2(totalNoSst + taxAmountPB);
  const totLabelX = 310;
  const totValX = 500;

  dt(page, "Tax Amount without Service Tax", totLabelX, y, regular, 8, black);
  dt(page, totalNoSst.toFixed(2), totValX, y, regular, 8, black);
  y -= 13;
  dt(page, "Total Service Tax", totLabelX, y, regular, 8, black);
  dt(page, taxAmountPB.toFixed(2), totValX, y, regular, 8, black);
  y -= 13;
  dt(page, "Total Amount with Service Tax", totLabelX, y, bold, 8, black);
  dt(page, grandTotal.toFixed(2), totValX, y, bold, 8, black);
  y -= 14;

  const wordsStr = amountToWords(billing.taxInclusiveAmount);
  dt(page, `Total amount payable: ${wordsStr}`, LEFT, y, regular, 8, black);
  y -= 20;

  // -------------------------------------------------------------------------
  // Section 5 — Tax Summary Table
  // -------------------------------------------------------------------------
  drawHLine(page, LEFT, RIGHT, y);
  y -= 2;

  const taxBoxTop = y;
  const taxBoxH = 56;
  drawRect(page, LEFT, taxBoxTop - taxBoxH, RIGHT - LEFT, taxBoxH);

  const tc = [40, 220, 360, 460];
  const taxHeaders = ["Tax Summary", "Service Tax", "Sales Amount (MYR)", "Tax Amount (MYR)"];
  let ty = taxBoxTop - 12;
  for (let i = 0; i < taxHeaders.length; i++) {
    dt(page, taxHeaders[i], tc[i], ty, bold, 8, black);
  }
  ty -= 14;
  drawHLine(page, LEFT + 2, RIGHT - 2, ty + 4, 0.3);
  ty -= 4;

  dt(page, "P0-Service Tax O2C: Non-Taxable", tc[0], ty, regular, 8, black);
  dt(page, "0%", tc[1], ty, regular, 8, black);
  dt(page, amountP0.toFixed(2), tc[2], ty, regular, 8, black);
  dt(page, "0.00", tc[3], ty, regular, 8, black);
  ty -= 14;

  dt(page, "PB-Service Tax O2C: 3.2%", tc[0], ty, regular, 8, black);
  dt(page, "3.2%", tc[1], ty, regular, 8, black);
  dt(page, amountPB.toFixed(2), tc[2], ty, regular, 8, black);
  dt(page, taxAmountPB.toFixed(2), tc[3], ty, regular, 8, black);

  // -------------------------------------------------------------------------
  // Section 6 — Footer
  // -------------------------------------------------------------------------
  const footerY = 50;
  drawHLine(page, LEFT, RIGHT, footerY + 20);
  const line1 = "This is a computer-generated invoice and does not require a signature.";
  const line2 = "SOLS Green Fintech Sdn. Bhd. — support@solsenergy.com — +60183555247";
  const w1 = regular.widthOfTextAtSize(line1, 8);
  const w2 = regular.widthOfTextAtSize(line2, 8);
  const pageW = 595.28;
  dt(page, line1, (pageW - w1) / 2, footerY + 8, regular, 8, gray);
  dt(page, line2, (pageW - w2) / 2, footerY - 4, regular, 8, gray);

  return pdfDoc.save();
}
