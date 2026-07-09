// app/api/bulk-invoice/run/route.ts
//
// Self-invoking cursor pattern:
// Vercel Cron (or the admin UI) triggers the FIRST invocation, which processes
// only CHUNK_SIZE subscribers and then fires an HTTP request to this same
// route with an advanced cursor. Each chunk therefore runs in its own
// serverless invocation with a fresh timeout, so total subscriber count is not
// bounded by a single function's maxDuration. Progress (cursor, tallies,
// per-subscriber results) is persisted on the bulkInvoiceLogs doc between
// invocations; the final chunk writes the terminal status.
import { NextRequest, NextResponse } from "next/server";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { waitUntil } from "@vercel/functions";
import { v4 as uuidv4 } from "uuid";
import type { Browser } from "puppeteer-core";
import { launchBrowser } from "@/lib/invoice/launch-browser";
import { adminApp } from "@/lib/firebase/admin";
import { MOCK_SUBSCRIBERS, MockSubscriber } from "@/lib/mock/subscribers";
import { getMissingDates, isSubscriberEligible } from "@/lib/mock/generation";
import { calculateBilling } from "@/lib/invoice/calculate-billing";
import type { BillingCalculation } from "@/lib/invoice/calculate-billing";
import { generateInvoicePDF } from "@/lib/invoice/generate-pdf";
import { buildInvoiceEmailHtml } from "@/lib/invoice/email-template";
import { createMailTransport, sendInvoiceEmail, MailTransport } from "@/lib/invoice/mailer";

// Headless-Chromium PDF generation needs far more than Vercel's default 10s.
// 60s is the Hobby-plan ceiling (Pro allows up to 300s). Each chunk gets its
// own fresh window of this duration.
export const maxDuration = 60;

interface SubscriberResult {
  plantId: string;
  customerName: string;
  email: string;
  status: "sent" | "failed" | "blocked";
  reason?: string;
  missingDates?: string[];
  invoiceNumber?: string;
  payexPaymentURL?: string;
  previewUrl?: string | null;
  error?: string;
  billing?: BillingCalculation;
}

interface JobDocument {
  jobId: string;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  status: string;
}

interface RunLogDocument {
  logId: string;
  jobId: string;
  isTest: boolean;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  runAt: string;
  status: "Running" | "Completed" | "Partially Completed" | "Failed";
  cursor: number;
  totalSubscribers: number;
  totalProcessed: number;
  sent: number;
  failed: number;
  blocked: number;
  results: SubscriberResult[];
  error?: string;
}

// 10 concurrent headless-Chromium renders per invocation keeps memory well
// under the serverless ceiling; more chunks is cheap since each chunk is its
// own invocation.
const CHUNK_SIZE = 10;

// Safety valve: a single run may not target more recipients than this. Protects
// live email/payment quotas from a misconfigured or abusive run. Override via
// MAX_RECIPIENTS_PER_RUN (raise it for production subscriber volumes).
const MAX_RECIPIENTS_PER_RUN = parseInt(process.env.MAX_RECIPIENTS_PER_RUN ?? "100", 10);

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function processSubscriber(
  subscriber: MockSubscriber,
  startDate: string,
  endDate: string,
  browser: Browser,
  mail: MailTransport
): Promise<SubscriberResult> {
  const plantId = subscriber.plant_id;
  const name = subscriber.name;
  const email = subscriber.email;

  // Preflight: email check
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      plantId,
      customerName: name,
      email: email || "",
      status: "blocked",
      reason: "No email address",
    };
  }

  // Preflight: generation data completeness
  if (!isSubscriberEligible(plantId, startDate, endDate)) {
    const missingDates = getMissingDates(plantId, startDate, endDate);
    return {
      plantId,
      customerName: name,
      email,
      status: "blocked",
      reason: "Missing generation data",
      missingDates,
    };
  }

  // Calculate billing
  const billing: BillingCalculation = calculateBilling(plantId, startDate, endDate);

  // Demo payment link. In production this is where the payment gateway's
  // per-invoice payment intent URL is created (using the gateway's credentials
  // and billing.nonce / billing.payexCollectionID as references).
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const payexPaymentURL = `${baseUrl}/payment-placeholder?ref=${encodeURIComponent(billing.invoiceNumber)}`;

  // Generate PDF
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateInvoicePDF(
      {
        subscriber: { plant_id: plantId, name, email },
        billing,
        paymentURL: payexPaymentURL,
      },
      browser
    );
  } catch (pdfErr) {
    return {
      plantId,
      customerName: name,
      email,
      status: "failed",
      error: `PDF generation failed: ${String(pdfErr)}`,
    };
  }

  // Send email
  let previewUrl: string | null = null;
  try {
    const billingPeriod = `${formatDate(startDate)} – ${formatDate(endDate)}`;
    const totalAmount = `RM ${billing.taxInclusiveAmount.toFixed(2)}`;
    const dueDateFormatted = formatDate(billing.dueDate);
    const html = buildInvoiceEmailHtml({
      customerName: name,
      invoiceNumber: billing.invoiceNumber,
      billingPeriod,
      totalAmount,
      dueDate: dueDateFormatted,
      paymentURL: payexPaymentURL,
    });
    const sendResult = await sendInvoiceEmail(mail, {
      to: email,
      subject: `Your Invoice ${billing.invoiceNumber} — ${totalAmount} Due ${dueDateFormatted}`,
      html,
      attachmentFilename: `${billing.invoiceNumber}.pdf`,
      pdfBytes,
    });
    previewUrl = sendResult.previewUrl;
  } catch (emailErr) {
    return {
      plantId,
      customerName: name,
      email,
      status: "failed",
      error: `Email send failed: ${String(emailErr)}`,
    };
  }

  return {
    plantId,
    customerName: name,
    email,
    status: "sent",
    invoiceNumber: billing.invoiceNumber,
    payexPaymentURL,
    previewUrl,
    billing,
  };
}

/**
 * Keeps a background promise alive after the response is sent. On Vercel this
 * uses waitUntil; in local dev (where the request context may be missing) the
 * promise simply continues running on the shared Node process.
 */
function runInBackground(promise: Promise<unknown>): void {
  const guarded = promise.catch((err) => console.error("[run] background task failed:", err));
  try {
    waitUntil(guarded);
  } catch {
    void guarded;
  }
}

/** Resolve the deployment's own base URL for self-triggering the next chunk. */
function selfBaseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? req.nextUrl.origin;
}

/** Fire the next chunk's invocation. Authenticated with CRON_SECRET. */
async function triggerNextChunk(
  baseUrl: string,
  cursor: number,
  logId: string,
  isTest: boolean
): Promise<void> {
  const url = `${baseUrl}/api/bulk-invoice/run?cursor=${cursor}&logId=${encodeURIComponent(
    logId
  )}${isTest ? "&isTest=true" : ""}`;

  const headers: Record<string, string> = {};
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) headers["authorization"] = `Bearer ${cronSecret}`;

  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok) {
    throw new Error(`Failed to trigger next chunk (cursor=${cursor}): HTTP ${res.status}`);
  }
}

/**
 * Processes one chunk of subscribers, persists progress on the log doc, then
 * either triggers the next chunk or finalizes the run.
 */
async function processChunk(
  db: Firestore,
  baseUrl: string,
  logId: string,
  cursor: number,
  isTest: boolean
): Promise<void> {
  const logRef = db.collection("bulkInvoiceLogs").doc(logId);
  const jobsRef = db.collection("bulkInvoiceJobs");

  const logSnap = await logRef.get();
  if (!logSnap.exists) {
    console.error(`[run] Log ${logId} not found; dropping chunk cursor=${cursor}`);
    return;
  }
  const log = logSnap.data() as RunLogDocument;

  // Idempotency guard: only the invocation matching the persisted cursor may
  // process. A stale/duplicate trigger (retry, double fire) exits silently.
  if (log.status !== "Running" || log.cursor !== cursor) {
    console.warn(
      `[run] Skipping stale chunk: incoming cursor=${cursor}, log cursor=${log.cursor}, status=${log.status}`
    );
    return;
  }

  const { startDate, endDate, jobId } = log;

  try {
    const chunk = MOCK_SUBSCRIBERS.slice(cursor, cursor + CHUNK_SIZE);

    // One browser and one mail transporter per invocation, shared across this
    // chunk's subscribers.
    const browser = await launchBrowser();
    const mail = await createMailTransport();
    let chunkResults: SubscriberResult[];
    try {
      chunkResults = await Promise.all(
        chunk.map((sub) => processSubscriber(sub, startDate, endDate, browser, mail))
      );
    } finally {
      await browser.close();
      mail.transporter.close();
    }

    const now = new Date().toISOString();
    const sent = chunkResults.filter((r) => r.status === "sent");
    const failed = chunkResults.filter((r) => r.status === "failed");
    const blocked = chunkResults.filter((r) => r.status === "blocked");

    // Billing history for this chunk's sent invoices (non-test only)
    if (!isTest && sent.length > 0) {
      const batch = db.batch();
      for (const result of sent) {
        const billing = result.billing!;
        const docRef = db
          .collection("solsGreenBillingHistoryAdmin")
          .doc(result.plantId)
          .collection("billingHistory")
          .doc(billing.billingYearMonth);

        batch.set(
          docRef,
          {
            ...billing,
            billStatus: "sent_to_user",
            payexPaymentURL: result.payexPaymentURL ?? null,
            updatedAt: now,
            updatedAtTs: Date.now(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    }

    // Persist progress. Strip the heavyweight billing object from stored
    // results — the send-history UI doesn't need it.
    const storedResults = chunkResults.map(({ billing: _billing, ...rest }) => rest);
    const newCursor = cursor + chunk.length;
    const done = newCursor >= log.totalSubscribers;

    const newTallies = {
      sent: log.sent + sent.length,
      failed: log.failed + failed.length,
      blocked: log.blocked + blocked.length,
    };
    const totalProcessed = log.totalProcessed + chunkResults.length;

    if (!done) {
      await logRef.update({
        cursor: newCursor,
        totalProcessed,
        ...newTallies,
        results: [...log.results, ...storedResults],
      });

      await triggerNextChunk(baseUrl, newCursor, logId, isTest);
      return;
    }

    // Final chunk: compute terminal status from accumulated tallies.
    const eligibleCount = newTallies.sent + newTallies.failed;
    const finalStatus: RunLogDocument["status"] =
      newTallies.failed === 0
        ? "Completed"
        : newTallies.sent === 0
        ? "Failed"
        : "Partially Completed";

    await logRef.update({
      cursor: newCursor,
      totalProcessed,
      ...newTallies,
      results: [...log.results, ...storedResults],
      status: finalStatus,
    });

    if (!isTest) {
      await jobsRef.doc(jobId).update({
        status: finalStatus,
        updatedAt: now,
        totalSubscribers: log.totalSubscribers,
        eligibleCount,
        blockedCount: newTallies.blocked,
        successCount: newTallies.sent,
        failedCount: newTallies.failed,
        latestLogId: logId,
      });
    }
  } catch (err) {
    console.error(`[run] Chunk failed (cursor=${cursor}):`, err);
    try {
      await logRef.update({ status: "Failed", error: String(err) });
      if (!isTest) {
        await jobsRef
          .doc(jobId)
          .update({ status: "Failed", updatedAt: new Date().toISOString() });
      }
    } catch (persistErr) {
      console.error("[run] Failed to persist chunk failure:", persistErr);
    }
  }
}

/**
 * Verifies the caller presents a Firebase ID token whose custom claims include
 * admin === true. Used to authenticate manual (force=true) runs from the admin
 * UI so an anonymous caller cannot trigger a real send.
 */
async function isAuthenticatedAdmin(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const idToken = authHeader.slice("Bearer ".length);
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(idToken);
    return decoded.admin === true;
  } catch {
    return false;
  }
}

async function handleRun(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const force = searchParams.get("force") === "true";
  const isTest = searchParams.get("isTest") === "true";
  const cursorParam = searchParams.get("cursor");
  const logIdParam = searchParams.get("logId");

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const hasValidSecret = !cronSecret || authHeader === `Bearer ${cronSecret}`;

  try {
    const db = getFirestore(adminApp);
    const baseUrl = selfBaseUrl(req);

    // ── Continuation invocation (self-triggered chunk) ──────────────────────
    if (cursorParam !== null) {
      if (!hasValidSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const cursor = parseInt(cursorParam, 10);
      if (!logIdParam || Number.isNaN(cursor) || cursor < 0) {
        return NextResponse.json({ error: "Invalid cursor/logId" }, { status: 400 });
      }

      // Respond immediately; the chunk runs in the background with this
      // invocation's own fresh maxDuration window.
      runInBackground(processChunk(db, baseUrl, logIdParam, cursor, isTest));
      return NextResponse.json({ accepted: true, cursor, logId: logIdParam });
    }

    // ── First invocation (Vercel Cron, or manual Run Now / Test Send) ───────
    // Auth model:
    //  - Cron (no force): must present `Authorization: Bearer $CRON_SECRET`
    //    (Vercel injects this automatically when CRON_SECRET is configured).
    //  - Admin UI (force=true): must present a valid Firebase ID token with an
    //    admin claim. Closes the previously open force=true trigger so an
    //    anonymous caller cannot fire a real send against live email/payment.
    if (force) {
      if (!(await isAuthenticatedAdmin(req))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else if (!hasValidSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load the most recent job
    const jobSnap = await db
      .collection("bulkInvoiceJobs")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (jobSnap.empty) {
      return NextResponse.json(
        { error: "No job found. Create a job first." },
        { status: 404 }
      );
    }

    const jobDoc = jobSnap.docs[0];
    const job = jobDoc.data() as JobDocument;

    // CRON guard: if not force, only run on the scheduled date
    if (!force) {
      const today = new Date().toISOString().slice(0, 10);
      if (job.scheduledSendDate !== today) {
        return NextResponse.json({
          message: `Scheduled for ${job.scheduledSendDate}. Today is ${today}. Skipped.`,
        });
      }
    }

    if (job.status === "Running") {
      return NextResponse.json({ error: "Job is already running" }, { status: 409 });
    }

    // Safety valve: refuse runs above the configured recipient ceiling so a
    // misconfigured or abusive run can't drain live email/payment quotas.
    if (MOCK_SUBSCRIBERS.length > MAX_RECIPIENTS_PER_RUN) {
      return NextResponse.json(
        {
          error: `Run blocked: ${MOCK_SUBSCRIBERS.length} recipients exceeds the safety cap of ${MAX_RECIPIENTS_PER_RUN}. Raise MAX_RECIPIENTS_PER_RUN to proceed.`,
        },
        { status: 400 }
      );
    }

    const { startDate, endDate } = job;
    const logId = uuidv4();
    const now = new Date().toISOString();

    const logDoc: RunLogDocument = {
      logId,
      jobId: job.jobId,
      isTest,
      startDate,
      endDate,
      scheduledSendDate: job.scheduledSendDate,
      runAt: now,
      status: "Running",
      cursor: 0,
      totalSubscribers: MOCK_SUBSCRIBERS.length,
      totalProcessed: 0,
      sent: 0,
      failed: 0,
      blocked: 0,
      results: [],
    };

    await db.collection("bulkInvoiceLogs").doc(logId).set(logDoc);

    // Mark job as Running (skip for test send)
    if (!isTest) {
      await jobDoc.ref.update({
        status: "Running",
        updatedAt: now,
        latestLogId: logId,
      });
    }

    // Kick off chunk 0 in the background and respond immediately. Progress is
    // observable by polling the job (non-test) or the log doc (both).
    runInBackground(processChunk(db, baseUrl, logId, 0, isTest));

    return NextResponse.json({
      logId,
      isTest,
      status: "Running",
      totalSubscribers: MOCK_SUBSCRIBERS.length,
      chunkSize: CHUNK_SIZE,
    });
  } catch (err) {
    console.error("[run]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Vercel Cron invokes the scheduled path with an HTTP GET request, so the
// automated path must be reachable via GET. The manual "Run Now" / "Test Send"
// actions from the admin UI (and chunk self-triggers) use POST. Both delegate
// to the shared handler.
export async function GET(req: NextRequest) {
  return handleRun(req);
}

export async function POST(req: NextRequest) {
  return handleRun(req);
}
