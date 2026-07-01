# Bulk Invoice Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full end-to-end automated bulk invoice generation system in the demo app that creates PayEx payment links, generates invoice PDFs, sends them via Mailgun, and logs all activity to Firebase — triggered by a Vercel CRON job or manually via a "Run Now" button.

**Architecture:** Admin sets a billing period (start/end date + scheduled send date) via the UI which creates a `bulkInvoiceJobs` Firebase document. On the scheduled date (or immediately when "Run Now" is clicked), the server-side job runner at `POST /api/bulk-invoice/run` processes all eligible subscribers in chunks of 20, generating a PayEx payment link, a `pdf-lib` invoice PDF, and a Mailgun email for each. Results are logged to `bulkInvoiceLogs` and `solsGreenBillingHistoryAdmin` is updated per successful send. Two new history pages display run logs and per-subscriber daily generation history.

**Tech Stack:** Next.js 16.2.9 (App Router, TypeScript), Firebase Local Emulator (Firestore + Auth), `pdf-lib` for PDFs, Mailgun.js for email, PayEx REST API for payment links, Tailwind CSS v4, `uuid` for nonces.

## Global Constraints

- Next.js 16.2.9 App Router — all routes use the `app/` directory and `route.ts` files
- TypeScript strict mode — no `any` types unless unavoidable
- Firebase project ID: `"demo-no-project"` (emulator only)
- SST rate: `0.032` (3.2%) — never change this constant
- Billing period max: 30 days (not 31)
- Chunk size: `20` subscribers per batch
- `pdf-lib` is the only PDF library used — no `html2pdf`, `puppeteer`, etc.
- All Tailwind classes use v4 syntax — no `@apply` with Tailwind utility names
- All Firebase Admin imports: named imports from `firebase-admin/app` and `firebase-admin/firestore`
- `uuid` package for all UUIDs (`v4()`)
- No `any` cast on Firestore `DocumentData` — define explicit interfaces
- Unit rate for billing: `RM 1.50 / kWh`

---

## File Map

### New Files

| File | Responsibility |
|---|---|
| `lib/mock/generation.ts` | Deterministic mock daily Growatt energy readings per subscriber |
| `lib/invoice/calculate-billing.ts` | Calculates all billing fields (amounts, dates, IDs) from daily generation data |
| `lib/invoice/generate-pdf.ts` | Generates A4 invoice PDF with `pdf-lib`, embeds payment URL |
| `lib/invoice/email-template.ts` | Returns HTML string for invoice email body |
| `lib/payex/payex.service.ts` | `getTokenData()` + `createPaymentIntentURL()` ported from sols-energy-admin |
| `app/(admin)/layout.tsx` | Simple nav bar linking to all admin pages |
| `app/api/bulk-invoice/create-job/route.ts` | Creates/updates `bulkInvoiceJobs` document in Firebase |
| `app/api/bulk-invoice/job/route.ts` | GET — returns the current job document |
| `app/api/bulk-invoice/run/route.ts` | POST — full job runner (CRON + Run Now + Test Send) |
| `app/api/bulk-invoice/logs/route.ts` | GET — returns all `bulkInvoiceLogs` sorted newest first |
| `app/(admin)/bulk-invoice-send-history/page.tsx` | Lists all bulk send runs from `bulkInvoiceLogs` |
| `app/(admin)/single-user-bulk-invoice-history/page.tsx` | Per-subscriber month-year accordions with daily data |
| `vercel.json` | Vercel CRON config — daily trigger for `/api/bulk-invoice/run` |

### Modified Files

| File | What Changes |
|---|---|
| `app/(admin)/send-bulk-invoice/page.tsx` | Complete rewrite — date picker, job card, split eligible/blocked tables |

---

## Task 1: Install Dependencies + Mock Generation Data

**Files:**
- Modify: `package.json` (via npm install)
- Create: `lib/mock/generation.ts`

**Interfaces produced:**
```typescript
// lib/mock/generation.ts
export interface DayReading {
  date: string;          // "2026-05-16"
  energy: number;        // kWh — 0 means missing/error
  energy_custom: number | null;
  flags: string[];
}

export function getDailyReadings(
  plantId: string,
  startDate: string,   // inclusive, "YYYY-MM-DD"
  endDate: string      // inclusive, "YYYY-MM-DD"
): DayReading[]
```

- [ ] **Step 1: Install pdf-lib and uuid**

```bash
cd "C:\Users\Adam Halid\Documents\Adam\demo-features\feat-send-bulk-invoice"
npm install pdf-lib uuid
npm install -D @types/uuid
```

Expected output: `added N packages`

- [ ] **Step 2: Create lib/mock/generation.ts**

Eligible plant IDs (1001, 1002, 1003, 1006, 1007) — all days have energy > 0.
Blocked plant IDs (1004, 1005) — specific days have energy = 0 (blocked: 1004 misses every 7th day, 1005 misses every 5th day).
No-email plant ID (1008) — all days OK but no email address (email check in preflight catches it first).

```typescript
// lib/mock/generation.ts

export interface DayReading {
  date: string;
  energy: number;
  energy_custom: number | null;
  flags: string[];
}

// Eligible plant IDs — all days produce energy
const ELIGIBLE_PLANT_IDS = new Set(["1001", "1002", "1003", "1006", "1007", "1008"]);

// Energy seed per plant (kWh base, varied deterministically)
const PLANT_ENERGY_SEED: Record<string, number> = {
  "1001": 12.4,
  "1002": 10.8,
  "1003": 11.2,
  "1004": 9.6,
  "1005": 13.0,
  "1006": 10.2,
  "1007": 11.8,
  "1008": 12.0,
};

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// Deterministic pseudo-random variation: day-of-month gives ±2 kWh swing
function dailyVariation(date: string, seed: number): number {
  const day = parseInt(date.slice(8, 10), 10);
  const variation = Math.sin(day * seed) * 2;
  return Math.max(0.5, seed + variation);
}

// Returns true if this day should be an "error" (missing data) day
function isErrorDay(plantId: string, date: string): boolean {
  const day = parseInt(date.slice(8, 10), 10);
  if (plantId === "1004") return day % 7 === 0;   // every 7th day of month
  if (plantId === "1005") return day % 5 === 0;   // every 5th day of month
  return false;
}

export function getDailyReadings(
  plantId: string,
  startDate: string,
  endDate: string
): DayReading[] {
  const dates = datesBetween(startDate, endDate);
  const seed = PLANT_ENERGY_SEED[plantId] ?? 10.0;

  return dates.map((date) => {
    if (isErrorDay(plantId, date)) {
      return { date, energy: 0, energy_custom: null, flags: [] };
    }
    const energy = parseFloat(dailyVariation(date, seed).toFixed(2));
    return { date, energy, energy_custom: null, flags: [] };
  });
}

export function getMissingDates(
  plantId: string,
  startDate: string,
  endDate: string
): string[] {
  return getDailyReadings(plantId, startDate, endDate)
    .filter((r) => r.energy === 0 && r.energy_custom === null && r.flags.length === 0)
    .map((r) => r.date);
}

export function isSubscriberEligible(
  plantId: string,
  startDate: string,
  endDate: string
): boolean {
  return getMissingDates(plantId, startDate, endDate).length === 0;
}
```

- [ ] **Step 3: Verify the module resolves correctly**

```bash
cd "C:\Users\Adam Halid\Documents\Adam\demo-features\feat-send-bulk-invoice"
npx tsc --noEmit
```

Expected: no errors in `lib/mock/generation.ts`

- [ ] **Step 4: Commit**

```bash
git init
git add lib/mock/generation.ts package.json package-lock.json
git commit -m "feat: install pdf-lib/uuid and add mock daily generation data"
```

---

## Task 2: Admin Layout with Navigation

**Files:**
- Create: `app/(admin)/layout.tsx`

**Interfaces consumed:** None
**Interfaces produced:** Standard Next.js layout wrapping children

- [ ] **Step 1: Create app/(admin)/layout.tsx**

```tsx
// app/(admin)/layout.tsx
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-blue-700 text-sm">SOLS Energy — Demo</span>
        <Link
          href="/send-bulk-invoice"
          className="text-sm text-gray-600 hover:text-blue-600 font-medium"
        >
          Send Bulk Invoice
        </Link>
        <Link
          href="/bulk-invoice-send-history"
          className="text-sm text-gray-600 hover:text-blue-600 font-medium"
        >
          Send History
        </Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Verify dev server renders nav**

Start the dev server: `npm run dev`
Navigate to `http://localhost:3000/send-bulk-invoice` — verify the navbar appears at the top.

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/layout.tsx
git commit -m "feat: add admin layout with navigation bar"
```

---

## Task 3: Billing Calculation Library

**Files:**
- Create: `lib/invoice/calculate-billing.ts`

**Interfaces consumed:**
- `getDailyReadings(plantId, startDate, endDate): DayReading[]` from `lib/mock/generation.ts`

**Interfaces produced:**
```typescript
// lib/invoice/calculate-billing.ts
export interface BillingCalculation {
  invoiceNumber: string;
  billingYearMonth: string;      // "2026-06"
  startDate: string;             // "2026-05-16"
  endDate: string;               // "2026-06-15"
  billEndDateTs: number;
  billGeneratedDate: string;     // today ISO
  billStatus: "draft";
  billingAmount: number;         // sum(energy) * UNIT_RATE, 2dp
  createdAt: string;
  description: string;           // "Monthly Home Solar Subscription - June 2026"
  displayPayableAmount: number;  // taxInclusiveAmount, 2dp
  displayTaxAmount: number;      // sstAmount, 2dp
  displayTaxExclusiveAmount: number; // billingAmount, 2dp
  dueDate: string;               // endDate + 14 days
  dueDateTs: number;
  itemDescription: string;       // "Home Solar Subscription"
  nonce: string;                 // UUID v4
  payexCollectionID: string;     // UUID v4
  dealId: string;                // plant_id
  sstAmount: number;             // billingAmount * 0.032, 2dp
  subtotal: number;              // = billingAmount
  taxAmount: number;             // = sstAmount
  taxExclusiveAmount: number;    // = billingAmount
  taxInclusiveAmount: number;    // billingAmount + sstAmount, 2dp
  updatedAt: string;
  updatedAtTs: number;
  totalEnergyKwh: number;        // raw sum of daily readings
}

export function calculateBilling(
  plantId: string,
  startDate: string,
  endDate: string
): BillingCalculation
```

- [ ] **Step 1: Create lib/invoice/calculate-billing.ts**

```typescript
// lib/invoice/calculate-billing.ts
import { v4 as uuidv4 } from "uuid";
import { getDailyReadings } from "@/lib/mock/generation";

const UNIT_RATE = 1.50; // RM per kWh
const SST_RATE = 0.032;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMonthLabel(endDate: string): string {
  const d = new Date(endDate + "T00:00:00Z");
  return d.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface BillingCalculation {
  invoiceNumber: string;
  billingYearMonth: string;
  startDate: string;
  endDate: string;
  billEndDateTs: number;
  billGeneratedDate: string;
  billStatus: "draft";
  billingAmount: number;
  createdAt: string;
  description: string;
  displayPayableAmount: number;
  displayTaxAmount: number;
  displayTaxExclusiveAmount: number;
  dueDate: string;
  dueDateTs: number;
  itemDescription: string;
  nonce: string;
  payexCollectionID: string;
  dealId: string;
  sstAmount: number;
  subtotal: number;
  taxAmount: number;
  taxExclusiveAmount: number;
  taxInclusiveAmount: number;
  updatedAt: string;
  updatedAtTs: number;
  totalEnergyKwh: number;
}

export function calculateBilling(
  plantId: string,
  startDate: string,
  endDate: string
): BillingCalculation {
  const readings = getDailyReadings(plantId, startDate, endDate);
  const totalEnergyKwh = round2(readings.reduce((sum, r) => sum + r.energy, 0));
  const billingAmount = round2(totalEnergyKwh * UNIT_RATE);
  const sstAmount = round2(billingAmount * SST_RATE);
  const taxInclusiveAmount = round2(billingAmount + sstAmount);

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const endDateMs = new Date(endDate + "T00:00:00Z").getTime();
  const dueDate = addDays(endDate, 14);
  const dueDateMs = new Date(dueDate + "T00:00:00Z").getTime();

  const yearMonth = endDate.slice(0, 7); // "2026-06"
  const monthLabel = getMonthLabel(endDate);
  const invoiceNumber = `INV-${yearMonth}-${plantId}`;

  return {
    invoiceNumber,
    billingYearMonth: yearMonth,
    startDate,
    endDate,
    billEndDateTs: endDateMs,
    billGeneratedDate: nowIso.slice(0, 10),
    billStatus: "draft",
    billingAmount,
    createdAt: nowIso,
    description: `Monthly Home Solar Subscription - ${monthLabel}`,
    displayPayableAmount: taxInclusiveAmount,
    displayTaxAmount: sstAmount,
    displayTaxExclusiveAmount: billingAmount,
    dueDate,
    dueDateTs: dueDateMs,
    itemDescription: "Home Solar Subscription",
    nonce: uuidv4(),
    payexCollectionID: uuidv4(),
    dealId: plantId,
    sstAmount,
    subtotal: billingAmount,
    taxAmount: sstAmount,
    taxExclusiveAmount: billingAmount,
    taxInclusiveAmount,
    updatedAt: nowIso,
    updatedAtTs: nowMs,
    totalEnergyKwh,
  };
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add lib/invoice/calculate-billing.ts
git commit -m "feat: add billing calculation library with SST and PayEx field generation"
```

---

## Task 4: PayEx Service

**Files:**
- Create: `lib/payex/payex.service.ts`

**Interfaces produced:**
```typescript
export interface PayexTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CreatePaymentIntentParams {
  amount: number;           // RM * 100 (cents)
  collectionId: string;     // UUID
  customerName: string;
  email: string;
  contactNumber: string;
  address: string;
  nonce: string;            // UUID
  referenceNumber: string;  // invoiceNumber
  returnUrl: string;
  acceptUrl: string;
  rejectUrl: string;
  callbackUrl: string;
  expiryDate: string;       // "YYYY-MM-DD"
  splitAccount?: string;
}

export async function getTokenData(token: string): Promise<PayexTokenResponse>
export async function createPaymentIntentURL(
  accessToken: string,
  params: CreatePaymentIntentParams
): Promise<string>  // returns payment URL
```

- [ ] **Step 1: Create lib/payex/payex.service.ts**

```typescript
// lib/payex/payex.service.ts

export interface PayexTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CreatePaymentIntentParams {
  amount: number;
  collectionId: string;
  customerName: string;
  email: string;
  contactNumber: string;
  address: string;
  nonce: string;
  referenceNumber: string;
  returnUrl: string;
  acceptUrl: string;
  rejectUrl: string;
  callbackUrl: string;
  expiryDate: string;
  splitAccount?: string;
}

export async function getTokenData(token: string): Promise<PayexTokenResponse> {
  const baseUrl = process.env.PAYEX_API_BASE_URL;
  if (!baseUrl) throw new Error("PAYEX_API_BASE_URL is not set");

  const res = await fetch(`${baseUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayEx getTokenData failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<PayexTokenResponse>;
}

export async function createPaymentIntentURL(
  accessToken: string,
  params: CreatePaymentIntentParams
): Promise<string> {
  const baseUrl = process.env.PAYEX_API_BASE_URL;
  if (!baseUrl) throw new Error("PAYEX_API_BASE_URL is not set");

  const payload = {
    amount: params.amount,
    collection_id: params.collectionId,
    customer_name: params.customerName,
    email: params.email,
    contact_number: params.contactNumber,
    address: params.address,
    nonce: params.nonce,
    reference_number: params.referenceNumber,
    return_url: params.returnUrl,
    accept_url: params.acceptUrl,
    reject_url: params.rejectUrl,
    callback_url: params.callbackUrl,
    expiry_date: params.expiryDate,
    ...(params.splitAccount ? { split_account: params.splitAccount } : {}),
  };

  const res = await fetch(`${baseUrl}/payment-intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayEx createPaymentIntentURL failed: ${res.status} ${body}`);
  }

  const data = await res.json() as { result: Array<{ url: string }> };
  const url = data?.result?.[0]?.url;
  if (!url) throw new Error("PayEx response missing result[0].url");
  return url;
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add lib/payex/payex.service.ts
git commit -m "feat: add PayEx service (getTokenData + createPaymentIntentURL)"
```

---

## Task 5: Invoice PDF Generation

**Files:**
- Create: `lib/invoice/generate-pdf.ts`
- Create: `lib/invoice/email-template.ts`

**Interfaces consumed:**
- `BillingCalculation` from `lib/invoice/calculate-billing.ts`

**Interfaces produced:**
```typescript
// lib/invoice/generate-pdf.ts
export interface InvoicePDFParams {
  subscriber: { plant_id: string; name: string; email: string; }
  billing: BillingCalculation;
  paymentURL: string;
}
export async function generateInvoicePDF(params: InvoicePDFParams): Promise<Uint8Array>

// lib/invoice/email-template.ts
export interface InvoiceEmailParams {
  customerName: string;
  invoiceNumber: string;
  billingPeriod: string;    // "16 May 2026 – 15 Jun 2026"
  totalAmount: string;      // "RM 475.27"
  dueDate: string;          // "29 Jun 2026"
  paymentURL: string;
}
export function buildInvoiceEmailHtml(params: InvoiceEmailParams): string
```

- [ ] **Step 1: Create lib/invoice/generate-pdf.ts**

```typescript
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
  const red = rgb(0.7, 0.1, 0.1);

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
  drawText(page, `SST (${(0.032 * 100).toFixed(1)}%):`, totalsX, y, regular, 10, gray);
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
```

- [ ] **Step 2: Create lib/invoice/email-template.ts**

```typescript
// lib/invoice/email-template.ts

export interface InvoiceEmailParams {
  customerName: string;
  invoiceNumber: string;
  billingPeriod: string;
  totalAmount: string;
  dueDate: string;
  paymentURL: string;
}

export function buildInvoiceEmailHtml(params: InvoiceEmailParams): string {
  const { customerName, invoiceNumber, billingPeriod, totalAmount, dueDate, paymentURL } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Invoice from SOLS Energy</title></head>
<body style="font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: #0a5cbf; padding: 24px 32px;">
      <h1 style="color: white; margin: 0; font-size: 22px;">SOLS Energy</h1>
      <p style="color: #cce0ff; margin: 4px 0 0; font-size: 13px;">Monthly Home Solar Subscription Invoice</p>
    </div>
    <div style="padding: 32px;">
      <p style="color: #333; font-size: 15px;">Dear <strong>${customerName}</strong>,</p>
      <p style="color: #555; font-size: 14px;">
        Please find your invoice for your Home Solar Subscription below.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px;">
        <tr style="background: #f0f4ff;">
          <td style="padding: 10px 14px; font-weight: bold; color: #555; width: 40%;">Invoice Number</td>
          <td style="padding: 10px 14px; color: #111;">${invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: bold; color: #555;">Billing Period</td>
          <td style="padding: 10px 14px; color: #111;">${billingPeriod}</td>
        </tr>
        <tr style="background: #f0f4ff;">
          <td style="padding: 10px 14px; font-weight: bold; color: #555;">Amount Due</td>
          <td style="padding: 10px 14px; color: #111; font-size: 16px; font-weight: bold;">${totalAmount}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: bold; color: #555;">Due Date</td>
          <td style="padding: 10px 14px; color: #c0392b;">${dueDate}</td>
        </tr>
      </table>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${paymentURL}"
           style="display: inline-block; background: #0a5cbf; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-size: 15px; font-weight: bold;">
          Pay Now
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 12px;">
          Or copy this link: <a href="${paymentURL}" style="color: #0a5cbf;">${paymentURL}</a>
        </p>
      </div>
      <p style="color: #888; font-size: 12px; margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px;">
        The invoice PDF is attached to this email. If you have questions, please contact support@sols247.org.
      </p>
    </div>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add lib/invoice/generate-pdf.ts lib/invoice/email-template.ts
git commit -m "feat: add invoice PDF generation and email HTML template"
```

---

## Task 6: Firebase Job Management APIs

**Files:**
- Create: `app/api/bulk-invoice/create-job/route.ts`
- Create: `app/api/bulk-invoice/job/route.ts`
- Create: `app/api/bulk-invoice/logs/route.ts`

**Interfaces produced:**

```typescript
// Job document shape stored in Firestore bulkInvoiceJobs
export interface BulkInvoiceJob {
  jobId: string;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  status: "Pending" | "Running" | "Completed" | "Partially Completed" | "Failed";
  createdAt: string;
  updatedAt: string;
  totalSubscribers: number;
  eligibleCount: number;
  blockedCount: number;
  successCount: number;
  failedCount: number;
  latestLogId: string | null;
}

// Log document shape stored in Firestore bulkInvoiceLogs
export interface BulkInvoiceLog {
  logId: string;
  jobId: string;
  isTest: boolean;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  runAt: string;
  status: "Completed" | "Partially Completed" | "Failed";
  totalProcessed: number;
  sent: number;
  failed: number;
  blocked: number;
  results: SubscriberResult[];
}

export interface SubscriberResult {
  plantId: string;
  customerName: string;
  email: string;
  status: "sent" | "failed" | "blocked";
  reason?: string;
  missingDates?: string[];
  invoiceNumber?: string;
  payexPaymentURL?: string;
  error?: string;
}
```

- [ ] **Step 1: Create app/api/bulk-invoice/create-job/route.ts**

```typescript
// app/api/bulk-invoice/create-job/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "@/lib/firebase/admin";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const { startDate, endDate, scheduledSendDate } = await req.json() as {
      startDate: string;
      endDate: string;
      scheduledSendDate: string;
    };

    if (!startDate || !endDate || !scheduledSendDate) {
      return NextResponse.json({ error: "startDate, endDate, scheduledSendDate are required" }, { status: 400 });
    }

    const start = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);

    if (diffDays > 30) {
      return NextResponse.json({ error: "Billing period must not exceed 30 days" }, { status: 400 });
    }

    if (end < start) {
      return NextResponse.json({ error: "End date must be after start date" }, { status: 400 });
    }

    const adminApp = getAdminApp();
    const db = getFirestore(adminApp);

    // Use a fixed doc ID so there's always one "current" job
    const jobId = uuidv4();
    const now = new Date().toISOString();

    const job = {
      jobId,
      startDate,
      endDate,
      scheduledSendDate,
      status: "Pending",
      createdAt: now,
      updatedAt: now,
      totalSubscribers: 0,
      eligibleCount: 0,
      blockedCount: 0,
      successCount: 0,
      failedCount: 0,
      latestLogId: null,
    };

    await db.collection("bulkInvoiceJobs").doc(jobId).set(job);

    return NextResponse.json(job);
  } catch (err) {
    console.error("[create-job]", err);
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create app/api/bulk-invoice/job/route.ts**

```typescript
// app/api/bulk-invoice/job/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "@/lib/firebase/admin";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  try {
    const adminApp = getAdminApp();
    const db = getFirestore(adminApp);

    if (jobId) {
      const doc = await db.collection("bulkInvoiceJobs").doc(jobId).get();
      if (!doc.exists) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json(doc.data());
    }

    // Return the most recently created job if no jobId specified
    const snap = await db
      .collection("bulkInvoiceJobs")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snap.empty) return NextResponse.json({ job: null });
    return NextResponse.json(snap.docs[0].data());
  } catch (err) {
    console.error("[job/GET]", err);
    return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create app/api/bulk-invoice/logs/route.ts**

```typescript
// app/api/bulk-invoice/logs/route.ts
import { NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "@/lib/firebase/admin";

export async function GET() {
  try {
    const adminApp = getAdminApp();
    const db = getFirestore(adminApp);

    const snap = await db
      .collection("bulkInvoiceLogs")
      .orderBy("runAt", "desc")
      .limit(50)
      .get();

    const logs = snap.docs.map((d) => d.data());
    return NextResponse.json({ logs });
  } catch (err) {
    console.error("[logs/GET]", err);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Manual verification**

With the emulator running (`firebase emulators:start --only firestore,auth`) and dev server running (`npm run dev`), run:

```bash
curl -X POST http://localhost:3000/api/bulk-invoice/create-job \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2026-05-16","endDate":"2026-06-15","scheduledSendDate":"2026-06-22"}'
```

Expected: `{"jobId":"<uuid>","status":"Pending",...}`

Then fetch it back:
```bash
curl "http://localhost:3000/api/bulk-invoice/job"
```

Expected: same job document.

- [ ] **Step 5: Commit**

```bash
git add app/api/bulk-invoice/
git commit -m "feat: add bulk invoice job management APIs (create-job, job, logs)"
```

---

## Task 7: Bulk Invoice Job Runner

**Files:**
- Create: `app/api/bulk-invoice/run/route.ts`

**Interfaces consumed:**
- `MOCK_SUBSCRIBERS` from `lib/mock/subscribers.ts`
- `getDailyReadings`, `getMissingDates`, `isSubscriberEligible` from `lib/mock/generation.ts`
- `calculateBilling`, `BillingCalculation` from `lib/invoice/calculate-billing.ts`
- `getTokenData`, `createPaymentIntentURL` from `lib/payex/payex.service.ts`
- `generateInvoicePDF` from `lib/invoice/generate-pdf.ts`
- `buildInvoiceEmailHtml` from `lib/invoice/email-template.ts`
- `getAdminApp` from `lib/firebase/admin`
- `SubscriberResult` interface (defined inline)

**Flow:** POST `?force=true` (Run Now) or `?isTest=true` (Test Send)

- [ ] **Step 1: Create app/api/bulk-invoice/run/route.ts**

```typescript
// app/api/bulk-invoice/run/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Mailgun from "mailgun.js";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";
import { getAdminApp } from "@/lib/firebase/admin";
import { MOCK_SUBSCRIBERS } from "@/lib/mock/subscribers";
import { getMissingDates, isSubscriberEligible } from "@/lib/mock/generation";
import { calculateBilling } from "@/lib/invoice/calculate-billing";
import { getTokenData, createPaymentIntentURL } from "@/lib/payex/payex.service";
import { generateInvoicePDF } from "@/lib/invoice/generate-pdf";
import { buildInvoiceEmailHtml } from "@/lib/invoice/email-template";

interface SubscriberResult {
  plantId: string;
  customerName: string;
  email: string;
  status: "sent" | "failed" | "blocked";
  reason?: string;
  missingDates?: string[];
  invoiceNumber?: string;
  payexPaymentURL?: string;
  error?: string;
}

const CHUNK_SIZE = 20;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

async function sendInvoiceEmail(
  to: string,
  customerName: string,
  invoiceNumber: string,
  billingPeriod: string,
  totalAmount: string,
  dueDate: string,
  paymentURL: string,
  pdfBytes: Uint8Array
): Promise<{ id: string; message: string }> {
  const mailgunClient = new Mailgun(FormData);
  const mg = mailgunClient.client({
    username: "api",
    key: process.env.MAILGUN_API_KEY ?? "",
    url: "https://api.mailgun.net",
  });

  const html = buildInvoiceEmailHtml({ customerName, invoiceNumber, billingPeriod, totalAmount, dueDate, paymentURL });
  const domain = process.env.MAILGUN_DOMAIN ?? "";

  const result = await mg.messages.create(domain, {
    from: `SOLS Energy <no-reply@${domain}>`,
    to: [to],
    subject: `Your Invoice ${invoiceNumber} — ${totalAmount} Due ${dueDate}`,
    html,
    attachment: [
      {
        filename: `${invoiceNumber}.pdf`,
        data: Buffer.from(pdfBytes),
        contentType: "application/pdf",
      },
    ],
  });

  return result as { id: string; message: string };
}

async function processSubscriber(
  subscriber: (typeof MOCK_SUBSCRIBERS)[0],
  startDate: string,
  endDate: string,
  payexToken: string | null
): Promise<SubscriberResult> {
  const plantId = subscriber.plant_id;
  const name = subscriber.name;
  const email = subscriber.email;

  // Preflight: email check
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { plantId, customerName: name, email: email || "", status: "blocked", reason: "No email address" };
  }

  // Preflight: generation data completeness
  if (!isSubscriberEligible(plantId, startDate, endDate)) {
    const missingDates = getMissingDates(plantId, startDate, endDate);
    return { plantId, customerName: name, email, status: "blocked", reason: "Missing generation data", missingDates };
  }

  // Calculate billing
  const billing = calculateBilling(plantId, startDate, endDate);

  // Generate PayEx payment link
  let payexPaymentURL = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/payment-placeholder`;
  if (payexToken) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
      const expiryDate = addYears(billing.billGeneratedDate, 1);
      payexPaymentURL = await createPaymentIntentURL(payexToken, {
        amount: Math.round(billing.displayPayableAmount * 100),
        collectionId: billing.payexCollectionID,
        customerName: name,
        email,
        contactNumber: "0123456789",
        address: "Malaysia",
        nonce: billing.nonce,
        referenceNumber: billing.invoiceNumber,
        returnUrl: `${baseUrl}/payment/return`,
        acceptUrl: `${baseUrl}/payment/accept`,
        rejectUrl: `${baseUrl}/payment/reject`,
        callbackUrl: `${baseUrl}/api/payex/callback`,
        expiryDate,
        splitAccount: process.env.PAYEX_SPLIT_ACCOUNT,
      });
    } catch (payexErr) {
      console.warn(`[run] PayEx failed for ${plantId}:`, payexErr);
      // Continue with placeholder URL
    }
  }

  // Generate PDF
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateInvoicePDF({ subscriber: { plant_id: plantId, name, email }, billing, paymentURL: payexPaymentURL });
  } catch (pdfErr) {
    return { plantId, customerName: name, email, status: "failed", error: `PDF generation failed: ${String(pdfErr)}` };
  }

  // Send email
  try {
    const billingPeriod = `${formatDate(startDate)} – ${formatDate(endDate)}`;
    const totalAmount = `RM ${billing.taxInclusiveAmount.toFixed(2)}`;
    const dueDate = formatDate(billing.dueDate);
    await sendInvoiceEmail(email, name, billing.invoiceNumber, billingPeriod, totalAmount, dueDate, payexPaymentURL, pdfBytes);
  } catch (emailErr) {
    return { plantId, customerName: name, email, status: "failed", error: `Email send failed: ${String(emailErr)}` };
  }

  return {
    plantId,
    customerName: name,
    email,
    status: "sent",
    invoiceNumber: billing.invoiceNumber,
    payexPaymentURL,
  };
}

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const force = searchParams.get("force") === "true";
  const isTest = searchParams.get("isTest") === "true";

  try {
    const adminApp = getAdminApp();
    const db = getFirestore(adminApp);

    // Load the most recent pending/failed job
    const jobSnap = await db
      .collection("bulkInvoiceJobs")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (jobSnap.empty) {
      return NextResponse.json({ error: "No job found. Create a job first." }, { status: 404 });
    }

    const jobDoc = jobSnap.docs[0];
    const job = jobDoc.data() as {
      jobId: string;
      startDate: string;
      endDate: string;
      scheduledSendDate: string;
      status: string;
    };

    // CRON guard: if not force, only run on the scheduled date
    if (!force) {
      const today = new Date().toISOString().slice(0, 10);
      if (job.scheduledSendDate !== today) {
        return NextResponse.json({ message: `Scheduled for ${job.scheduledSendDate}. Today is ${today}. Skipped.` });
      }
    }

    if (job.status === "Running") {
      return NextResponse.json({ error: "Job is already running" }, { status: 409 });
    }

    // Mark job as Running (skip for test send)
    if (!isTest) {
      await jobDoc.ref.update({ status: "Running", updatedAt: new Date().toISOString() });
    }

    const { startDate, endDate } = job;

    // Get PayEx token (fail gracefully — use placeholder URL)
    let payexToken: string | null = null;
    try {
      const tokenData = await getTokenData(process.env.PAYEX_TOKEN ?? "");
      payexToken = tokenData.access_token;
    } catch {
      console.warn("[run] PayEx token fetch failed — payment links will be placeholder");
    }

    // Process all subscribers in chunks
    const allResults: SubscriberResult[] = [];
    const chunks = chunkArray(MOCK_SUBSCRIBERS, CHUNK_SIZE);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map((sub) => processSubscriber(sub, startDate, endDate, payexToken))
      );
      allResults.push(...chunkResults);
    }

    // Tally results
    const sent = allResults.filter((r) => r.status === "sent");
    const failed = allResults.filter((r) => r.status === "failed");
    const blocked = allResults.filter((r) => r.status === "blocked");
    const eligible = allResults.filter((r) => r.status !== "blocked");

    const finalStatus =
      sent.length === eligible.length && failed.length === 0
        ? "Completed"
        : sent.length === 0 && failed.length > 0
        ? "Failed"
        : "Partially Completed";

    const logId = uuidv4();
    const now = new Date().toISOString();

    const logDoc = {
      logId,
      jobId: job.jobId,
      isTest,
      startDate,
      endDate,
      scheduledSendDate: job.scheduledSendDate,
      runAt: now,
      status: finalStatus,
      totalProcessed: allResults.length,
      sent: sent.length,
      failed: failed.length,
      blocked: blocked.length,
      results: allResults,
    };

    await db.collection("bulkInvoiceLogs").doc(logId).set(logDoc);

    // Update job status (skip for test send)
    if (!isTest) {
      // Update solsGreenBillingHistoryAdmin for each successful send
      const batch = db.batch();

      for (const result of sent) {
        const billing = calculateBilling(result.plantId, startDate, endDate);
        const docRef = db
          .collection("solsGreenBillingHistoryAdmin")
          .doc(result.plantId)
          .collection("billingHistory")
          .doc(billing.billingYearMonth);

        batch.set(docRef, {
          ...billing,
          billStatus: "sent_to_user",
          payexPaymentURL: result.payexPaymentURL ?? null,
          updatedAt: now,
          updatedAtTs: Date.now(),
        }, { merge: true });
      }

      await batch.commit();

      await jobDoc.ref.update({
        status: finalStatus,
        updatedAt: now,
        totalSubscribers: allResults.length,
        eligibleCount: eligible.length,
        blockedCount: blocked.length,
        successCount: sent.length,
        failedCount: failed.length,
        latestLogId: logId,
      });
    }

    return NextResponse.json({
      logId,
      isTest,
      status: finalStatus,
      totalProcessed: allResults.length,
      sent: sent.length,
      failed: failed.length,
      blocked: blocked.length,
    });
  } catch (err) {
    console.error("[run]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manual smoke test (with emulator running and env vars set)**

```bash
# Normal run (bypasses date check with force)
curl -X POST "http://localhost:3000/api/bulk-invoice/run?force=true"
```

Expected: `{"status":"Completed","sent":5,"blocked":3,"failed":0,...}` (5 eligible, 3 blocked: 1004/1005 missing dates, 1008 no email)

```bash
# Test send
curl -X POST "http://localhost:3000/api/bulk-invoice/run?force=true&isTest=true"
```

Expected: same shape with `"isTest":true` in response. Check Firebase emulator UI at `localhost:4000` — `bulkInvoiceLogs` should have a new document with `isTest: true`. `solsGreenBillingHistoryAdmin` should NOT have new entries.

- [ ] **Step 3: Commit**

```bash
git add app/api/bulk-invoice/run/route.ts
git commit -m "feat: add bulk invoice job runner with PayEx, PDF, Mailgun, and Firebase updates"
```

---

## Task 8: Vercel CRON Configuration

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/bulk-invoice/run",
      "schedule": "0 0 * * *"
    }
  ]
}
```

The route checks `scheduledSendDate` stored in `bulkInvoiceJobs` against today and exits immediately if not the right day — so daily CRON execution is safe.

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: add Vercel cron to trigger bulk invoice job runner daily at midnight UTC"
```

---

## Task 9: Rewrite Send Bulk Invoice Page

**Files:**
- Modify: `app/(admin)/send-bulk-invoice/page.tsx`

This is a complete rewrite. The existing payment-reminder flow is replaced with:
1. Global billing cycle date picker (3 date inputs)
2. Scheduled job card (status, Run Now, Test Send, Send History buttons)
3. Split subscriber tables (Eligible / Blocked)

**Interfaces consumed:**
- `MOCK_SUBSCRIBERS` from `lib/mock/subscribers.ts`
- `isSubscriberEligible`, `getMissingDates` from `lib/mock/generation.ts`
- APIs: `/api/bulk-invoice/create-job`, `/api/bulk-invoice/job`, `/api/bulk-invoice/run`

- [ ] **Step 1: Rewrite app/(admin)/send-bulk-invoice/page.tsx**

```tsx
// app/(admin)/send-bulk-invoice/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MOCK_SUBSCRIBERS } from "@/lib/mock/subscribers";
import { isSubscriberEligible, getMissingDates } from "@/lib/mock/generation";

interface BillingJob {
  jobId: string;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  status: string;
  successCount?: number;
  failedCount?: number;
  blockedCount?: number;
  latestLogId?: string | null;
}

interface EligibleRow {
  plant_id: string;
  name: string;
  email: string;
}

interface BlockedRow {
  plant_id: string;
  name: string;
  email: string;
  reason: string;
  missingDates: string[];
}

function addMonthMinusDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const nextMonth = new Date(d);
  nextMonth.setUTCMonth(d.getUTCMonth() + 1);
  nextMonth.setUTCDate(d.getUTCDate() - 1);
  return nextMonth.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000
  );
}

function formatDisplayDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  Running: "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
  "Partially Completed": "bg-orange-100 text-orange-800",
  Failed: "bg-red-100 text-red-800",
};

export default function SendBulkInvoicePage() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  // Date picker state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [scheduledSendDate, setScheduledSendDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [savingJob, setSavingJob] = useState(false);

  // Current job
  const [currentJob, setCurrentJob] = useState<BillingJob | null>(null);
  const [loadingJob, setLoadingJob] = useState(true);

  // Run / test send state
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    status: string; sent: number; failed: number; blocked: number; isTest?: boolean;
  } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "warning" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "warning" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }

  // Auto-suggest end date when start date changes
  useEffect(() => {
    if (startDate) {
      setEndDate(addMonthMinusDay(startDate));
    }
  }, [startDate]);

  // Validate date inputs
  useEffect(() => {
    if (!startDate || !endDate) { setDateError(null); return; }
    if (endDate < startDate) { setDateError("End date must be after start date"); return; }
    const diff = daysBetween(startDate, endDate);
    if (diff > 30) { setDateError("Billing period must not exceed 30 days"); return; }
    if (scheduledSendDate && scheduledSendDate < today) {
      setDateError("Scheduled send date cannot be in the past"); return;
    }
    setDateError(null);
  }, [startDate, endDate, scheduledSendDate, today]);

  const canSetCycle = !!(startDate && endDate && scheduledSendDate && !dateError);

  // Load current job from Firebase
  const loadJob = useCallback(async () => {
    setLoadingJob(true);
    try {
      const res = await fetch("/api/bulk-invoice/job");
      if (!res.ok) return;
      const data = await res.json() as BillingJob | { job: null };
      if ("jobId" in data) setCurrentJob(data);
      else setCurrentJob(null);
    } catch {
      // ignore
    } finally {
      setLoadingJob(false);
    }
  }, []);

  useEffect(() => { loadJob(); }, [loadJob]);

  // Poll while Running
  useEffect(() => {
    if (currentJob?.status !== "Running") return;
    const interval = setInterval(loadJob, 3000);
    return () => clearInterval(interval);
  }, [currentJob?.status, loadJob]);

  // Subscriber preflight split
  const billingRange = currentJob
    ? { start: currentJob.startDate, end: currentJob.endDate }
    : startDate && endDate
    ? { start: startDate, end: endDate }
    : null;

  const { eligible, blocked } = useMemo<{ eligible: EligibleRow[]; blocked: BlockedRow[] }>(() => {
    if (!billingRange) return { eligible: [], blocked: [] };
    const el: EligibleRow[] = [];
    const bl: BlockedRow[] = [];

    for (const sub of MOCK_SUBSCRIBERS) {
      if (!sub.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sub.email)) {
        bl.push({ plant_id: sub.plant_id, name: sub.name, email: sub.email || "", reason: "No email address", missingDates: [] });
        continue;
      }
      if (!isSubscriberEligible(sub.plant_id, billingRange.start, billingRange.end)) {
        const missing = getMissingDates(sub.plant_id, billingRange.start, billingRange.end);
        bl.push({ plant_id: sub.plant_id, name: sub.name, email: sub.email, reason: "Missing generation data", missingDates: missing });
        continue;
      }
      el.push({ plant_id: sub.plant_id, name: sub.name, email: sub.email });
    }
    return { eligible: el, blocked: bl };
  }, [billingRange]);

  async function handleSetCycle() {
    if (!canSetCycle) return;
    setSavingJob(true);
    try {
      const res = await fetch("/api/bulk-invoice/create-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, scheduledSendDate }),
      });
      if (!res.ok) {
        const e = await res.json() as { error: string };
        showToast(e.error || "Failed to set billing cycle", "error");
        return;
      }
      const job = await res.json() as BillingJob;
      setCurrentJob(job);
      showToast("Billing cycle set successfully", "success");
    } catch {
      showToast("Failed to set billing cycle", "error");
    } finally {
      setSavingJob(false);
    }
  }

  async function handleRun(isTest: boolean) {
    if (!currentJob || running) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch(`/api/bulk-invoice/run?force=true${isTest ? "&isTest=true" : ""}`, {
        method: "POST",
      });
      const data = await res.json() as { status: string; sent: number; failed: number; blocked: number; error?: string };
      if (!res.ok) {
        showToast(data.error || "Run failed", "error");
        return;
      }
      setRunResult({ ...data, isTest });
      await loadJob();
      if (isTest) {
        showToast(`Test send complete — ${data.sent} sent, ${data.blocked} blocked, ${data.failed} failed. Results visible in Send History (marked as Test).`, "success");
      } else {
        showToast(`Job ${data.status}: ${data.sent} sent, ${data.blocked} blocked, ${data.failed} failed.`, data.failed > 0 ? "warning" : "success");
      }
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setRunning(false);
    }
  }

  const toastBg = {
    success: "bg-green-50 border-green-200 text-green-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    error: "bg-red-50 border-red-200 text-red-800",
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {toast && (
          <div className={`rounded-md border px-4 py-3 text-sm ${toastBg[toast.type]}`}>
            {toast.message}
          </div>
        )}

        {/* Section 1: Date picker */}
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Set Billing Cycle</h2>
          <p className="text-sm text-gray-500 mb-4">
            Set the billing period and scheduled send date. The end date is auto-suggested as one day before the start day in the following month.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Billing Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Billing End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Scheduled Send Date</label>
              <input
                type="date"
                value={scheduledSendDate}
                onChange={(e) => setScheduledSendDate(e.target.value)}
                min={today}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {dateError && (
            <p className="mt-2 text-sm text-red-600">{dateError}</p>
          )}

          <div className="mt-4 flex items-center gap-4">
            <button
              onClick={handleSetCycle}
              disabled={!canSetCycle || savingJob}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-5 py-2"
            >
              {savingJob ? "Saving…" : "Set Billing Cycle"}
            </button>

            <div className="text-sm text-gray-500">
              {currentJob ? (
                <span className="text-gray-700">
                  Current billing cycle:{" "}
                  <strong>{formatDisplayDate(currentJob.startDate)} – {formatDisplayDate(currentJob.endDate)}</strong>
                  {" | "}Scheduled send: <strong>{formatDisplayDate(currentJob.scheduledSendDate)}</strong>
                </span>
              ) : (
                <span className="text-amber-600">No billing cycle determined yet</span>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Job card */}
        {!loadingJob && currentJob && (
          <div className="bg-white rounded-2xl shadow p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Scheduled Job</h3>
                <p className="text-sm text-gray-500">
                  {formatDisplayDate(currentJob.startDate)} – {formatDisplayDate(currentJob.endDate)}
                </p>
              </div>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[currentJob.status] ?? "bg-gray-100 text-gray-700"}`}>
                {currentJob.status}
              </span>
            </div>

            {runResult && (
              <div className="mb-4 rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700 flex flex-wrap gap-4">
                {runResult.isTest && <span className="font-semibold text-purple-700">[TEST] </span>}
                <span>Sent: <strong className="text-green-700">{runResult.sent}</strong></span>
                <span>Blocked: <strong className="text-amber-700">{runResult.blocked}</strong></span>
                <span>Failed: <strong className="text-red-700">{runResult.failed}</strong></span>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => handleRun(false)}
                disabled={running || currentJob.status === "Running"}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
              >
                {running ? "Running…" : "Run Now"}
              </button>
              <button
                onClick={() => handleRun(true)}
                disabled={running || currentJob.status === "Running"}
                className="border border-purple-600 text-purple-600 hover:bg-purple-50 disabled:opacity-50 text-sm font-medium rounded-lg px-4 py-2"
              >
                Test Send
              </button>
              <button
                onClick={() => router.push("/bulk-invoice-send-history")}
                className="border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2"
              >
                Send History
              </button>
            </div>
          </div>
        )}

        {/* Section 3: Eligible subscribers */}
        {billingRange && (
          <>
            <div className="bg-white rounded-2xl shadow p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-3">
                Eligible Subscribers ({eligible.length})
              </h3>
              <div className="overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plant ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {eligible.length > 0 ? eligible.map((s) => (
                      <tr key={s.plant_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-mono">{s.plant_id}</td>
                        <td className="px-4 py-3 text-gray-900">{s.name}</td>
                        <td className="px-4 py-3 text-gray-500">{s.email}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => router.push(`/single-user-bulk-invoice-history?plantId=${s.plant_id}`)}
                            className="text-xs text-blue-600 hover:underline font-medium"
                          >
                            Bulk Send History
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No eligible subscribers</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 4: Blocked subscribers */}
            <div className="bg-amber-50 rounded-2xl shadow p-6">
              <h3 className="text-base font-semibold text-amber-900 mb-3">
                Blocked Subscribers ({blocked.length})
              </h3>
              <div className="overflow-auto rounded-lg border border-amber-200">
                <table className="w-full text-sm divide-y divide-amber-100">
                  <thead className="bg-amber-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Plant ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Customer Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Reason</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Missing Dates</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 bg-amber-50">
                    {blocked.length > 0 ? blocked.map((s) => (
                      <tr key={s.plant_id}>
                        <td className="px-4 py-3 text-amber-900 font-mono">{s.plant_id}</td>
                        <td className="px-4 py-3 text-amber-900">{s.name}</td>
                        <td className="px-4 py-3 text-amber-700">{s.email || <span className="text-red-600 text-xs">No email</span>}</td>
                        <td className="px-4 py-3 text-amber-700 text-xs">{s.reason}</td>
                        <td className="px-4 py-3 text-amber-700 text-xs max-w-[200px]">
                          {s.missingDates.length > 0 ? s.missingDates.join(", ") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => router.push(`/single-user-bulk-invoice-history?plantId=${s.plant_id}`)}
                            className="text-xs text-amber-800 hover:underline font-medium"
                          >
                            Bulk Send History
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-amber-400">No blocked subscribers</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test the page in browser**

Ensure `npm run dev` is running and Firebase emulator is running. Navigate to `http://localhost:3000/send-bulk-invoice`.

Verify:
1. Three date inputs appear
2. Changing start date auto-suggests end date (one month minus one day)
3. Setting a range > 30 days shows error: "Billing period must not exceed 30 days"
4. Clicking "Set Billing Cycle" creates a job and shows the job card
5. Job card shows "Run Now", "Test Send", "Send History" buttons
6. Eligible and Blocked subscriber tables appear (5 eligible, 3 blocked for default range)
7. "Bulk Send History" button in each row navigates to the correct URL

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/send-bulk-invoice/page.tsx
git commit -m "feat: rewrite send-bulk-invoice page with date picker, job card, and split subscriber tables"
```

---

## Task 10: Bulk Invoice Send History Page

**Files:**
- Create: `app/(admin)/bulk-invoice-send-history/page.tsx`

**Interfaces consumed:**
- `GET /api/bulk-invoice/logs` response: `{ logs: BulkInvoiceLog[] }`

```typescript
// BulkInvoiceLog
interface BulkInvoiceLog {
  logId: string;
  jobId: string;
  isTest: boolean;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  runAt: string;
  status: "Completed" | "Partially Completed" | "Failed";
  totalProcessed: number;
  sent: number;
  failed: number;
  blocked: number;
  results: Array<{
    plantId: string;
    customerName: string;
    email: string;
    status: "sent" | "failed" | "blocked";
    reason?: string;
    missingDates?: string[];
    invoiceNumber?: string;
    error?: string;
  }>;
}
```

- [ ] **Step 1: Create app/(admin)/bulk-invoice-send-history/page.tsx**

```tsx
// app/(admin)/bulk-invoice-send-history/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface SubscriberResult {
  plantId: string;
  customerName: string;
  email: string;
  status: "sent" | "failed" | "blocked";
  reason?: string;
  missingDates?: string[];
  invoiceNumber?: string;
  error?: string;
}

interface BulkInvoiceLog {
  logId: string;
  jobId: string;
  isTest: boolean;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  runAt: string;
  status: string;
  totalProcessed: number;
  sent: number;
  failed: number;
  blocked: number;
  results: SubscriberResult[];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00Z")
    .toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatDateTime(iso: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });
}

const STATUS_COLORS: Record<string, string> = {
  Completed: "bg-green-100 text-green-800",
  "Partially Completed": "bg-orange-100 text-orange-800",
  Failed: "bg-red-100 text-red-800",
};

const RESULT_COLORS: Record<string, string> = {
  sent: "text-green-700",
  failed: "text-red-700",
  blocked: "text-amber-700",
};

export default function BulkInvoiceSendHistoryPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<BulkInvoiceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/bulk-invoice/logs")
      .then((r) => r.json())
      .then((d: { logs: BulkInvoiceLog[] }) => setLogs(d.logs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function toggleExpand(logId: string) {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      next.has(logId) ? next.delete(logId) : next.add(logId);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Bulk Invoice Send History</h1>
            <p className="text-sm text-gray-500 mt-1">All bulk invoice job runs, newest first</p>
          </div>
          <button
            onClick={() => router.push("/send-bulk-invoice")}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2"
          >
            Back to Send Bulk Invoice
          </button>
        </div>

        {loading && <p className="text-gray-400 text-sm">Loading…</p>}

        {!loading && logs.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-12 text-center text-gray-400">
            No send history yet. Use "Run Now" or "Test Send" on the Send Bulk Invoice page.
          </div>
        )}

        <div className="space-y-4">
          {logs.map((log) => (
            <div key={log.logId} className="bg-white rounded-2xl shadow">
              {/* Log header */}
              <button
                onClick={() => toggleExpand(log.logId)}
                className="w-full text-left px-6 py-4 flex flex-wrap items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatDate(log.startDate)} – {formatDate(log.endDate)}
                    </span>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[log.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {log.status}
                    </span>
                    {log.isTest && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-purple-100 text-purple-800">
                        TEST
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Run at {formatDateTime(log.runAt)} · Scheduled send: {formatDate(log.scheduledSendDate)}
                  </p>
                </div>
                <div className="flex gap-4 text-sm text-gray-600">
                  <span>Processed: <strong>{log.totalProcessed}</strong></span>
                  <span className="text-green-700">Sent: <strong>{log.sent}</strong></span>
                  <span className="text-amber-700">Blocked: <strong>{log.blocked}</strong></span>
                  <span className="text-red-700">Failed: <strong>{log.failed}</strong></span>
                </div>
                <span className="text-gray-400 text-sm">{expandedLogIds.has(log.logId) ? "▲" : "▼"}</span>
              </button>

              {/* Expanded results */}
              {expandedLogIds.has(log.logId) && (
                <div className="border-t border-gray-100 px-6 pb-4 pt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase">
                        <th className="text-left pb-2 pr-4">Customer</th>
                        <th className="text-left pb-2 pr-4">Plant ID</th>
                        <th className="text-left pb-2 pr-4">Status</th>
                        <th className="text-left pb-2">Reason / Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {log.results.map((r) => (
                        <tr key={`${log.logId}-${r.plantId}`}>
                          <td className="py-2 pr-4 text-gray-900">{r.customerName}</td>
                          <td className="py-2 pr-4 text-gray-500 font-mono">{r.plantId}</td>
                          <td className={`py-2 pr-4 font-semibold capitalize ${RESULT_COLORS[r.status]}`}>
                            {r.status}
                          </td>
                          <td className="py-2 text-gray-500 text-xs max-w-xs truncate">
                            {r.invoiceNumber && <span className="text-gray-700 mr-2">{r.invoiceNumber}</span>}
                            {r.reason || r.error || ""}
                            {r.missingDates && r.missingDates.length > 0 && (
                              <span className="text-amber-700 ml-1">({r.missingDates.join(", ")})</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `http://localhost:3000/bulk-invoice-send-history`.
- Before any runs: shows "No send history yet" message
- After running a job via "Run Now": shows a log entry with correct counts
- After a "Test Send": shows a TEST badge
- Click the log row to expand per-subscriber results

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/bulk-invoice-send-history/page.tsx
git commit -m "feat: add bulk invoice send history page with expandable per-subscriber results"
```

---

## Task 11: Single User Bulk Invoice History Page

**Files:**
- Create: `app/(admin)/single-user-bulk-invoice-history/page.tsx`

**Route:** `/single-user-bulk-invoice-history?plantId=1001`

This page does NOT read from Firebase. It reads from `lib/mock/generation.ts` directly to show 3 months of mock billing history with daily breakdowns. Eligible subscribers show all OK days; blocked subscribers show error days highlighted.

**Interfaces consumed:**
- `getDailyReadings(plantId, startDate, endDate): DayReading[]` from `lib/mock/generation.ts`
- `MOCK_SUBSCRIBERS` from `lib/mock/subscribers.ts`
- `calculateBilling` from `lib/invoice/calculate-billing.ts`

- [ ] **Step 1: Create app/(admin)/single-user-bulk-invoice-history/page.tsx**

```tsx
// app/(admin)/single-user-bulk-invoice-history/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { MOCK_SUBSCRIBERS } from "@/lib/mock/subscribers";
import { getDailyReadings } from "@/lib/mock/generation";
import { calculateBilling } from "@/lib/invoice/calculate-billing";

const UNIT_RATE = 1.50;
const SST_RATE = 0.032;

function addMonthMinusDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const next = new Date(d);
  next.setUTCMonth(d.getUTCMonth() + 1);
  next.setUTCDate(d.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

function subtractMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function formatMonthYear(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

interface BillingMonth {
  label: string;       // "June 2026"
  startDate: string;
  endDate: string;
  totalEnergy: number;
  totalBilling: number; // tax inclusive
  errorDays: number;
  days: Array<{
    date: string;
    energy: number;
    billingAmount: number;
    isError: boolean;
  }>;
}

function buildBillingMonths(plantId: string, baseStartDate: string, monthsBack: number): BillingMonth[] {
  const months: BillingMonth[] = [];

  for (let i = 0; i < monthsBack; i++) {
    const cycleStart = subtractMonths(baseStartDate, i);
    const cycleEnd = addMonthMinusDay(cycleStart);

    const readings = getDailyReadings(plantId, cycleStart, cycleEnd);
    const billing = calculateBilling(plantId, cycleStart, cycleEnd);

    const days = readings.map((r) => {
      const isError = r.energy === 0 && r.energy_custom === null && r.flags.length === 0;
      return {
        date: r.date,
        energy: r.energy,
        billingAmount: parseFloat((r.energy * UNIT_RATE * (1 + SST_RATE)).toFixed(2)),
        isError,
      };
    });

    months.push({
      label: formatMonthYear(cycleEnd),
      startDate: cycleStart,
      endDate: cycleEnd,
      totalEnergy: billing.totalEnergyKwh,
      totalBilling: billing.taxInclusiveAmount,
      errorDays: days.filter((d) => d.isError).length,
      days,
    });
  }

  return months;
}

export default function SingleUserBulkInvoiceHistoryPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const plantId = searchParams.get("plantId") ?? "";

  const subscriber = MOCK_SUBSCRIBERS.find((s) => s.plant_id === plantId);

  // Use today's date as the base to compute billing cycles
  const today = new Date().toISOString().slice(0, 10);
  // Compute the most recent cycle start (16th of previous month as default)
  const baseStart = useMemo(() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(16);
    if (d > new Date(today + "T00:00:00Z")) d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 10);
  }, [today]);

  const billingMonths = useMemo(() => {
    if (!plantId) return [];
    return buildBillingMonths(plantId, baseStart, 3);
  }, [plantId, baseStart]);

  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set([0]));

  function toggleMonth(i: number) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  if (!subscriber) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-gray-400">Subscriber not found: Plant ID {plantId}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{subscriber.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Plant ID: <span className="font-mono">{plantId}</span> · {subscriber.email || "No email"}
            </p>
          </div>
          <button
            onClick={() => router.back()}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2"
          >
            Back
          </button>
        </div>

        <div className="space-y-4">
          {billingMonths.map((month, i) => (
            <div key={month.label} className="bg-white rounded-2xl shadow">
              {/* Accordion header */}
              <button
                onClick={() => toggleMonth(i)}
                className="w-full text-left px-6 py-4 flex flex-wrap items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{month.label}</span>
                    {month.errorDays > 0 && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                        {month.errorDays} error{month.errorDays !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatDate(month.startDate)} – {formatDate(month.endDate)}
                  </p>
                </div>
                <div className="flex gap-6 text-sm text-gray-700">
                  <span>{month.totalEnergy.toFixed(2)} kWh</span>
                  <span className="font-semibold">RM {month.totalBilling.toFixed(2)}</span>
                </div>
                <span className="text-gray-400">{expandedMonths.has(i) ? "▲" : "▼"}</span>
              </button>

              {/* Accordion body */}
              {expandedMonths.has(i) && (
                <div className="border-t border-gray-100 px-6 pb-4 pt-3">
                  <div className="overflow-auto max-h-96 rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Energy (kWh)</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Billing (RM)</th>
                          <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {month.days.map((day) => (
                          <tr key={day.date} className={day.isError ? "bg-red-50" : ""}>
                            <td className="px-3 py-2 text-gray-700">{formatDate(day.date)}</td>
                            <td className={`px-3 py-2 text-right font-mono ${day.isError ? "text-red-600" : "text-gray-700"}`}>
                              {day.isError ? "—" : day.energy.toFixed(2)}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono ${day.isError ? "text-red-600" : "text-gray-700"}`}>
                              {day.isError ? "—" : day.billingAmount.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {day.isError ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">Error</span>
                              ) : (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-700">OK</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer totals */}
                  <div className="mt-3 flex flex-wrap gap-6 text-sm text-gray-700 border-t border-gray-100 pt-3">
                    <span>Total Energy: <strong>{month.totalEnergy.toFixed(2)} kWh</strong></span>
                    <span>Total Billing: <strong>RM {month.totalBilling.toFixed(2)}</strong></span>
                    {month.errorDays > 0 && (
                      <span className="text-red-700">Error Days: <strong>{month.errorDays}</strong></span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `http://localhost:3000/single-user-bulk-invoice-history?plantId=1001`
- Shows subscriber name: "Raoul Walia", Plant ID: 1001
- 3 month-year accordions, first one expanded by default
- All days show OK status, energy values, billing amounts
- Footer shows totals

Navigate to `http://localhost:3000/single-user-bulk-invoice-history?plantId=1004`
- Shows "Ashweni Luques"
- Error days visible (every 7th day of month) with red highlight and Error badge
- Error count shown in accordion header

Navigate to `http://localhost:3000/single-user-bulk-invoice-history?plantId=9999`
- Shows "Subscriber not found" message

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/single-user-bulk-invoice-history/page.tsx"
git commit -m "feat: add single-user bulk invoice history page with month-year accordions and daily breakdown"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Global billing cycle date picker (start, end, scheduled send) | Task 9 |
| Max 30 days validation | Task 6 (API) + Task 9 (UI) |
| Scheduled send date display below picker | Task 9 |
| "No billing cycle determined yet" label | Task 9 |
| Vercel CRON + chunked queue (20 per chunk) | Task 7 + Task 8 |
| `bulkInvoiceJobs` Firebase collection | Task 6 |
| `bulkInvoiceLogs` Firebase collection | Task 6 + Task 7 |
| Preflight checks (email + generation data completeness) | Task 7 (run route) + Task 9 (UI split) |
| Split Eligible / Blocked subscriber tables | Task 9 |
| Blocked table shows Missing Dates column | Task 9 |
| PayEx payment link generation | Task 4 + Task 7 |
| Invoice PDF with payment link embedded | Task 5 + Task 7 |
| Mailgun invoice email with payment link | Task 7 |
| `solsGreenBillingHistoryAdmin` updated per successful send | Task 7 |
| Job status: Completed / Partially Completed / Failed | Task 7 |
| Test Send (`isTest: true`, no job/history updates) | Task 7 + Task 9 |
| "Run Now" button (bypasses CRON) | Task 9 |
| "Send History" button → `/bulk-invoice-send-history` | Task 9 |
| Send History page from `bulkInvoiceLogs` | Task 10 |
| `[TEST]` badge on test send logs | Task 10 |
| "Bulk Send History" per subscriber → `/single-user-bulk-invoice-history?plantId=XXXX` | Task 9 |
| History page: month-year accordions | Task 11 |
| Daily energy + billing per day | Task 11 |
| Error days only for blocked subscribers | Task 11 |
| Admin layout with navigation | Task 2 |
| Mock daily generation data | Task 1 |

### No Placeholders Found

Checked all tasks — all code blocks are complete. No "TBD", "TODO", "implement later", or "similar to Task N" patterns.

### Type Consistency

- `BillingCalculation` defined in Task 3, consumed in Tasks 5, 7, 11 — all use same field names
- `DayReading` defined in Task 1, consumed in Tasks 3, 11 — consistent
- `getTokenData` returns `PayexTokenResponse.access_token` — Task 7 reads `.access_token` ✓
- `createPaymentIntentURL` returns `string` — Task 7 assigns to `payexPaymentURL: string` ✓
- `generateInvoicePDF` returns `Promise<Uint8Array>` — Task 7 uses `Buffer.from(pdfBytes)` ✓
- `SubscriberResult.status` is `"sent" | "failed" | "blocked"` — Task 10 maps all three ✓
