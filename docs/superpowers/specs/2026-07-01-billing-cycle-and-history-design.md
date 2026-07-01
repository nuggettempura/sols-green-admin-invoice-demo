# Design: Automated Bulk Invoice Generation System

**Date:** 2026-07-01
**Project:** feat-send-bulk-invoice (demo app)
**Reference:** Acceptance Criteria — Bulk Invoice Issuance

---

## Overview

A full end-to-end automated bulk invoice generation system. Admin sets a billing period and a scheduled send date. On that date, a Vercel Cron job triggers the server-side job which:
- Checks each subscriber's generation data completeness (mocked Growatt data)
- Generates invoice PDFs for eligible subscribers
- Sends invoices via Mailgun
- Updates `solsGreenBillingHistoryAdmin` in Firebase
- Logs results to `bulkInvoiceLogs` in Firebase

All data (subscribers, generation readings) is mocked. The infrastructure (CRON, PDF, email, Firebase writes) is real.

---

## Architecture

### Approach: Vercel Cron + Chunked Queue

- Vercel Cron triggers `POST /api/bulk-invoice/run` on the scheduled send date
- The job runner processes subscribers in chunks of 20
- Progress and results are written to Firebase after each chunk
- A "Run Now" button in the UI manually triggers the same route for local testing
- Final job status: `Completed`, `Partially Completed`, or `Failed`

### Firebase Collections

| Collection | Purpose |
|---|---|
| `bulkInvoiceJobs` | One document per scheduled job — stores dates, status, progress |
| `bulkInvoiceLogs` | One document per run attempt — stores full results per subscriber |
| `solsGreenBillingHistoryAdmin` | Updated per subscriber after successful invoice send |

---

## Section 1: Send Bulk Invoice Page (`/send-bulk-invoice`)

### 1a. Global Billing Cycle Date Picker

Three inputs at the top of the page:
- **Billing Start Date** (`<input type="date">`)
- **Billing End Date** (`<input type="date">`)
- **Scheduled Send Date** (`<input type="date">`) — when the CRON job fires

**"Set Billing Cycle" button:**
- Disabled with error span if:
  - End date is before start date
  - Date range exceeds 30 days
  - Scheduled send date is before today
- On confirm: writes a job document to `bulkInvoiceJobs` in Firebase (create or update)

**Auto-suggestion for End Date:**
- Calculated as the day before the start date's day-of-month in the following month
- e.g. start = May 16 → suggested end = June 15
- User can override freely

**Status label below the inputs:**
- Before set: `No billing cycle determined yet`
- After set: `Current billing cycle: 16 May 2026 – 15 June 2026 | Scheduled send: 22 June 2026`

### 1b. Scheduled Job Display

After a job is created, a card appears below the date picker showing:
- Billing Start Date
- Billing End Date
- Scheduled Send Date
- Job Status badge (`Pending` / `Running` / `Completed` / `Partially Completed` / `Failed`)
- **"Run Now"** button — manually triggers the CRON route immediately (for local testing)
- **"Test Send"** button — runs the full flow but marks logs as `isTest: true`
- **"Send History"** button — navigates to `/bulk-invoice-send-history`

### 1c. Split Subscriber Tables

**Table 1 — Eligible (N)**
- Columns: Checkbox | Plant ID | Customer Name | Email | Last Sent | Actions
- Actions: **"Bulk Send History"** button → `/single-user-bulk-invoice-history?plantId=XXXX`
- Checkboxes for individual/select-all selection
- Eligible = has valid email + complete mock generation data for full billing period

**Table 2 — Blocked (N)**
- Columns: Plant ID | Customer Name | Email | Reason | Missing Dates | Actions
- Reason: human-readable (e.g. "Missing generation data", "No email address", "Invoice overdue")
- Missing Dates: comma-separated list of dates where generation data is 0 or null
- Actions: **"Bulk Send History"** button → same navigation
- Amber background, no checkboxes
- Blocked subscribers have error days in their history

### 1d. Preflight Check (per subscriber, mirrors subscriber-management)

Before classifying a subscriber as Eligible or Blocked, the system checks:
1. Does subscriber have a valid email? If not → Blocked (No email)
2. Does the subscriber have generation data for every day in the billing period?
   - A day is **handled** if: `energy > 0` OR `energy_custom` is set OR `flags` exist
   - A day is **missing** if: `energy = 0` AND `energy_custom` is null AND no flags
3. If any missing days → Blocked with list of missing dates
4. If all days handled → Eligible

For the POC, generation data is mocked in `lib/mock/generation.ts`.

---

## Section 2: Bulk Invoice Job Runner (Server-side)

**Route:** `POST /api/bulk-invoice/run`
**Triggered by:** Vercel Cron OR "Run Now" button

### Flow

1. Read job document from `bulkInvoiceJobs` — get billing start/end dates
2. Update job status to `Running`
3. Load all mock subscribers
4. Run preflight check on each subscriber (generation data completeness)
5. Split into eligible and blocked
6. Process eligible subscribers in chunks of 20:
   - For each subscriber in chunk:
     - Calculate billing amount from mock daily energy data
     - Generate PayEx payment link via `POST /api/payex/create-one-off-payment-intent`
     - Generate invoice PDF (using `pdf-lib`) — embed payment link in PDF
     - Send invoice email via Mailgun — embed payment link in email body
     - On success: update `solsGreenBillingHistoryAdmin` with all required fields + `payexPaymentURL`
     - On failure: record error
   - Write chunk results to `bulkInvoiceLogs`
7. After all chunks complete:
   - Determine final job status:
     - All sent → `Completed`
     - Some sent, some failed → `Partially Completed`
     - None sent → `Failed`
   - Update `bulkInvoiceJobs` document with final status and summary

### Firebase Update per Successful Send (`solsGreenBillingHistoryAdmin`)

Fields written/updated:
```
billEndDateTs, endDate, billGeneratedDate, startDate, billStatus,
billingAmount, createdAt, billingYearMonth, description,
displayPayableAmount, displayTaxAmount, displayTaxExclusiveAmount,
dueDate, dueDateTs, invoiceNumber, itemDescription,
nonce, payexCollectionID, dealId,
sstAmount, subtotal, taxAmount, taxExclusiveAmount, taxInclusiveAmount,
updatedAt, updatedAtTs
```

Only these fields are updated — no collections overwritten.

---

## Section 2b: Payment Link Generation (PayEx)

For each eligible subscriber, before generating the PDF:

1. Call PayEx to get a bearer token via `getTokenData(PAYEX_TOKEN)`
2. Call `createPaymentIntentURL(token, paymentDetails)` with:
   - `amount` — `displayPayableAmount` in cents (× 100)
   - `collection_id` — `payexCollectionID` (UUID)
   - `customer_name`, `email`, `contact_number`, `address` from mock subscriber data
   - `nonce` — UUID generated per invoice
   - `reference_number` — `invoiceNumber`
   - `return_url` / `accept_url` / `reject_url` / `callback_url` — set to demo app base URL
   - `expiry_date` — 1 year from invoice date
3. Extract `payexPaymentURL` from response (`result[0].url`)
4. Embed this URL in both the invoice PDF and the Mailgun email body
5. Store `payexPaymentURL` in `solsGreenBillingHistoryAdmin` and `solsGreenBillingHistoryClient`

**Required env vars:**
```
PAYEX_TOKEN
PAYEX_SPLIT_ACCOUNT
PAYEX_API_BASE_URL
NEXT_PUBLIC_BASE_URL     ← used for return/accept/reject URLs
```

**Ported files from sols-energy-admin:**
- `app/services/payex/payex.service.ts` — `getTokenData` + `createPaymentIntentURL`

---

## Section 3: Test Send (AC #10)

**Triggered by:** "Test Send" button on the job card

- Runs the same full flow as the real job
- Logs are written to `bulkInvoiceLogs` with `isTest: true`
- Does NOT update `bulkInvoiceJobs` status
- Does NOT update `solsGreenBillingHistoryAdmin`
- Toast shows: `Test send complete — results visible in Send History (marked as Test)`

---

## Section 4: Send History Page (`/bulk-invoice-send-history`)

**Route:** `app/(admin)/bulk-invoice-send-history/page.tsx`

Fetches all documents from `bulkInvoiceLogs` sorted newest first.

**Each log entry shows:**
- Billing period (start → end)
- Scheduled send date
- Total processed / sent / failed
- Job status badge
- `[TEST]` badge if `isTest: true`
- Expandable row showing per-subscriber results:
  - Customer Name | Plant ID | Status | Missing Dates (if failed)

---

## Section 5: Single User Bulk Invoice History Page (`/single-user-bulk-invoice-history`)

**Route:** `app/(admin)/single-user-bulk-invoice-history/page.tsx?plantId=XXXX`

**Page header:** Subscriber name + Plant ID

**Accordions — one per billing month-year, newest first:**

**Accordion header (collapsed):**
- Month-Year (e.g. `June 2026`)
- Billing cycle (e.g. `16 May – 15 Jun 2026`)
- Total energy (e.g. `142.5 kWh`)
- Total billing amount (e.g. `RM 474.87`)
- Error badge (e.g. `2 errors`) — only for blocked subscribers

**Accordion body (expanded) — daily table:**
- Date | Energy (kWh) | Billing Amount (RM) | Status (`OK` / `Error`)
- Error rows highlighted red — only appear for blocked subscribers

**Accordion footer:**
- Total Energy: `XXX kWh`
- Total Billing: `RM XXX.XX`
- Error Days: `N days` (only if errors exist)

**Mock data:** 3 months per subscriber, ~30 daily rows each.
- Eligible subscribers: all days OK, no errors
- Blocked subscribers: 2–3 error days per month

---

## Section 6: Vercel Cron Configuration

`vercel.json`:
```json
{
  "crons": [{
    "path": "/api/bulk-invoice/run",
    "schedule": "0 0 * * *"
  }]
}
```

The job runner checks if today matches the scheduled send date stored in `bulkInvoiceJobs` before processing. If not the right day, it exits immediately.

---

## New Files

### API Routes
- `app/api/bulk-invoice/create-job/route.ts` — create/update `bulkInvoiceJobs`
- `app/api/bulk-invoice/run/route.ts` — job runner (CRON + Run Now)
- `app/api/bulk-invoice/job/route.ts` — get current job status
- `app/api/bulk-invoice/logs/route.ts` — get `bulkInvoiceLogs`

### Pages
- `app/(admin)/send-bulk-invoice/page.tsx` — updated with date picker, job card, split tables
- `app/(admin)/bulk-invoice-send-history/page.tsx` — send history from `bulkInvoiceLogs`
- `app/(admin)/single-user-bulk-invoice-history/page.tsx` — per-subscriber history

### Libraries
- `lib/mock/generation.ts` — mock daily Growatt generation data per subscriber
- `lib/invoice/generate-pdf.ts` — invoice PDF generation using `pdf-lib`, embeds payment link
- `lib/invoice/calculate-billing.ts` — billing amount calculation (SST, subtotal, etc.)
- `lib/payex/payex.service.ts` — ported from sols-energy-admin: `getTokenData` + `createPaymentIntentURL`

### Modified
- `app/(admin)/send-bulk-invoice/page.tsx`
- `vercel.json` — add cron config

---

## Out of Scope
- Real Growatt API integration
- Energy sync flow (Sync Energy Data button shown but navigates to placeholder)
- IRBM e-invoice submission

## Environment Variables Required
```
# Firebase
NEXT_PUBLIC_API_KEY
NEXT_PUBLIC_AUTH_DOMAIN
NEXT_PUBLIC_PROJECT_ID
NEXT_PUBLIC_STORAGE_BUCKET
NEXT_PUBLIC_MESSAGING_SENDER_ID
NEXT_PUBLIC_APP_ID
SERVICE_ACCOUNT
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
FIRESTORE_EMULATOR_HOST=localhost:8080
NEXT_PUBLIC_USE_EMULATOR=true

# Mailgun
MAILGUN_API_KEY
MAILGUN_DOMAIN

# PayEx
PAYEX_TOKEN
PAYEX_SPLIT_ACCOUNT
PAYEX_API_BASE_URL

# App
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```
