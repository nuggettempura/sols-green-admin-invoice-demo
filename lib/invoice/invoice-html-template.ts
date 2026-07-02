// lib/invoice/invoice-html-template.ts
import type { BillingCalculation } from "./calculate-billing";

export interface InvoiceHtmlParams {
  subscriber: { plant_id: string; name: string; email: string };
  billing: BillingCalculation;
  paymentURL: string;
}

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInvoiceHtml(params: InvoiceHtmlParams): string {
  const { subscriber, billing, paymentURL } = params;
  const { name, email } = subscriber;

  const nameUpper = escapeHtml(name.toUpperCase());
  const nameSafe = escapeHtml(name);
  const emailSafe = escapeHtml(email);

  const today = todayStr();
  const dueDate30 = addDays(billing.endDate, 30);

  const energyP0 = Math.min(billing.totalEnergyKwh, 600);
  const energyPB = Math.max(0, billing.totalEnergyKwh - 600);
  const amountP0 = round2(energyP0 * 1.5);
  const amountPB = round2(energyPB * 1.5);
  const taxAmountPB = round2(amountPB * 0.032);
  const totalNoSst = round2(amountP0 + amountPB);
  const grandTotal = round2(totalNoSst + taxAmountPB);
  const wordsStr = amountToWords(billing.taxInclusiveAmount);

  const rowP0 = energyP0 > 0 ? `
    <div class="grid grid-cols-[80px_1.5fr_100px_60px_60px_80px_80px_80px] border-b border-black pb-1">
      <div class="p-1">000010</div>
      <div class="p-1">Renewable Energy (First 600 kWh)</div>
      <div class="p-1 text-right">${energyP0.toFixed(3)}</div>
      <div class="p-1 text-right">0</div>
      <div class="p-1 text-center">P0</div>
      <div class="p-1 text-right">0.00</div>
      <div class="p-1 text-right">1.500</div>
      <div class="p-1 text-right">${amountP0.toFixed(2)}</div>
    </div>` : "";

  const rowPB = energyPB > 0 ? `
    <div class="grid grid-cols-[80px_1.5fr_100px_60px_60px_80px_80px_80px] border-b border-black pb-1">
      <div class="p-1">000020</div>
      <div class="p-1">Renewable Energy (Remaining kWh)</div>
      <div class="p-1 text-right">${energyPB.toFixed(3)}</div>
      <div class="p-1 text-right">3.2</div>
      <div class="p-1 text-center">PB</div>
      <div class="p-1 text-right">${taxAmountPB.toFixed(2)}</div>
      <div class="p-1 text-right">1.500</div>
      <div class="p-1 text-right">${amountPB.toFixed(2)}</div>
    </div>` : "";

  const paymentBlock = paymentURL ? `
      <div class="grid grid-cols-[1fr_1.4fr] items-center gap-2">
        <div>
          <a href="${escapeHtml(paymentURL)}" target="_blank" rel="noopener noreferrer" class="text-blue-500">Pay Online</a>
        </div>
      </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<script src="https://cdn.tailwindcss.com"></script>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; }
</style>
</head>
<body>
<div class="invoice-container flex min-h-[297mm] w-[210mm] max-w-[210mm] flex-col gap-10 overflow-x-hidden bg-white p-8 font-sans text-[13px] leading-5">

  <!-- Header -->
  <div class="grid grid-cols-[1.6fr_1fr] items-start gap-8">
    <div class="grid p-1">
      <p class="font-bold">SOLS GREEN FINTECH SDN. BHD.</p>
      <p>Level 5, Menara SOLS, Kuala Lumpur City Centre, 50088 Kuala Lumpur, Malaysia.</p>
      <p>Service Tax Registration No.: W10-2507-32000940</p>
    </div>
    <div class="flex items-start justify-end gap-8 p-1">
      <p class="text-base font-bold">Invoice</p>
    </div>
  </div>

  <!-- Invoice Details Section -->
  <div class="grid grid-cols-[1.6fr_1fr] items-start gap-8">
    <div class="grid border border-black">
      <div class="grid p-1 pb-1">
        <p class="font-bold">Invoice To</p>
        <p class="uppercase">${nameUpper}</p>
        <p>${emailSafe}</p>
      </div>
      <div class="grid border-t border-black p-1 pb-1">
        <p class="font-bold">Delivery To</p>
        <p class="uppercase">${nameUpper}</p>
        <p>${emailSafe}</p>
      </div>
    </div>

    <div class="grid grid-cols-[1fr_1.4fr]">
      <div>Invoice No.</div>
      <div>: ${escapeHtml(billing.nonce)}</div>

      <div>Invoice Date</div>
      <div>: ${formatDDMMYYYY(today)}</div>

      <div>Delivery Period</div>
      <div>: ${formatDDMMYYYY(billing.startDate)} - ${formatDDMMYYYY(billing.endDate)}</div>

      <div>Payment Terms</div>
      <div>: Within 30 days</div>

      <div>Due Date</div>
      <div>: ${formatDDMMYYYY(dueDate30)}</div>

      <div>Attention to</div>
      <div class="uppercase">: ${nameSafe}</div>
    </div>
  </div>

  ${paymentBlock}

  <!-- Item Table -->
  <div class="grid text-[11px] leading-3">
    <div class="grid grid-cols-[80px_1.5fr_100px_60px_60px_80px_80px_80px] border-y border-black text-left font-semibold">
      <div class="p-1 pb-1">Item No</div>
      <div class="p-1 pb-1">Description of Goods</div>
      <div class="p-1 pb-1 text-right">Quantity</div>
      <div class="p-1 pb-1 text-right">Service Tax (%)</div>
      <div class="p-1 pb-1 text-center">Tax Code</div>
      <div class="p-1 pb-1 text-right">Tax Amount (MYR)</div>
      <div class="p-1 pb-1 text-right">Unit Price (MYR)</div>
      <div class="p-1 pb-1 text-right">Amount (MYR)</div>
    </div>

    ${rowP0}
    ${rowPB}

    <div class="grid grid-cols-[80px_1.5fr_100px_60px_60px_80px_80px_80px]">
      <div class="col-span-7 p-1">Tax Amount without Service Tax</div>
      <div class="p-1 text-right">${totalNoSst.toFixed(2)}</div>
    </div>

    <div class="grid grid-cols-[80px_1.5fr_100px_60px_60px_80px_80px_80px]">
      <div class="col-span-7 p-1">Total Service Tax</div>
      <div class="p-1 text-right">${taxAmountPB.toFixed(2)}</div>
    </div>

    <div class="grid grid-cols-[80px_1.5fr_100px_60px_60px_80px_80px_80px] border-b border-black">
      <div class="col-span-7 p-1 pb-1 font-bold">Total Amount with Service Tax</div>
      <div class="p-1 pb-1 text-right font-bold">${grandTotal.toFixed(2)}</div>
    </div>

    <div class="grid grid-cols-[80px_1.5fr_100px_60px_60px_80px_80px_80px]">
      <div class="col-span-8 p-1">Total amount payable: ${wordsStr}</div>
    </div>
  </div>

  <!-- Tax Summary Table -->
  <div class="text-[11px] leading-3">
    <div class="grid border border-black">
      <div class="grid grid-cols-[2fr_1fr_1fr_1fr] border-b border-black font-semibold">
        <div class="border-e border-black p-1 pb-1">Tax Summary</div>
        <div class="border-e border-black p-1 pb-1 text-center">Service Tax</div>
        <div class="border-e border-black p-1 pb-1 text-center">Sales Amount (MYR)</div>
        <div class="p-1 pb-1 text-center">Tax Amount (MYR)</div>
      </div>
      <div class="grid grid-cols-[2fr_1fr_1fr_1fr] border-b border-black">
        <div class="border-e border-black p-1 pb-1">P0-Service Tax O2C: Non-Taxable</div>
        <div class="border-e border-black p-1 pb-1 text-center">0%</div>
        <div class="border-e border-black p-1 pb-1 text-center">${amountP0.toFixed(2)}</div>
        <div class="p-1 pb-1 text-center">0.00</div>
      </div>
      <div class="grid grid-cols-[2fr_1fr_1fr_1fr]">
        <div class="border-e border-black p-1 pb-1">PB-Service Tax O2C: 3.2%</div>
        <div class="border-e border-black p-1 pb-1 text-center">3.2%</div>
        <div class="border-e border-black p-1 pb-1 text-center">${amountPB.toFixed(2)}</div>
        <div class="p-1 pb-1 text-center">${taxAmountPB.toFixed(2)}</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="mt-auto border-t border-gray-300 pt-3 text-center text-[9px] text-gray-500">
    <p>This is a computer-generated invoice and does not require a signature.</p>
    <p>SOLS Green Fintech Sdn. Bhd. — support@solsenergy.com — +60183555247</p>
  </div>

</div>
</body>
</html>`;
}
