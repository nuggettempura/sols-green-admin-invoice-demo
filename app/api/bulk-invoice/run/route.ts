// app/api/bulk-invoice/run/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Mailgun from "mailgun.js";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";
import { adminApp } from "@/lib/firebase/admin";
import { MOCK_SUBSCRIBERS, MockSubscriber } from "@/lib/mock/subscribers";
import { getMissingDates, isSubscriberEligible } from "@/lib/mock/generation";
import { calculateBilling, BillingCalculation } from "@/lib/invoice/calculate-billing";
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

interface JobDocument {
  jobId: string;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  status: string;
}

const CHUNK_SIZE = 20;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
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

  const html = buildInvoiceEmailHtml({
    customerName,
    invoiceNumber,
    billingPeriod,
    totalAmount,
    dueDate,
    paymentURL,
  });

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
  subscriber: MockSubscriber,
  startDate: string,
  endDate: string,
  payexToken: string | null
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

  // Generate PayEx payment link
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  let payexPaymentURL = `${baseUrl}/payment-placeholder`;

  if (payexToken) {
    try {
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
      // Continue with placeholder URL (non-fatal)
    }
  }

  // Generate PDF
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateInvoicePDF({
      subscriber: { plant_id: plantId, name, email },
      billing,
      paymentURL: payexPaymentURL,
    });
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
  try {
    const billingPeriod = `${formatDate(startDate)} – ${formatDate(endDate)}`;
    const totalAmount = `RM ${billing.taxInclusiveAmount.toFixed(2)}`;
    const dueDateFormatted = formatDate(billing.dueDate);
    await sendInvoiceEmail(
      email,
      name,
      billing.invoiceNumber,
      billingPeriod,
      totalAmount,
      dueDateFormatted,
      payexPaymentURL,
      pdfBytes
    );
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
  };
}

// Suppress unused import warning — FieldValue is available for future use
void FieldValue;

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const force = searchParams.get("force") === "true";
  const isTest = searchParams.get("isTest") === "true";

  try {
    const db = getFirestore(adminApp);

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

    // Mark job as Running (skip for test send)
    if (!isTest) {
      await jobDoc.ref.update({ status: "Running", updatedAt: new Date().toISOString() });
    }

    const { startDate, endDate } = job;

    // Get PayEx token (fail gracefully)
    let payexToken: string | null = null;
    try {
      const tokenData = await getTokenData(process.env.PAYEX_TOKEN ?? "");
      payexToken = tokenData.access_token;
    } catch {
      console.warn("[run] PayEx token fetch failed — payment links will be placeholder");
    }

    // Process all subscribers in chunks of CHUNK_SIZE
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

    const finalStatus: "Completed" | "Partially Completed" | "Failed" =
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

    // Always write to bulkInvoiceLogs (including test runs)
    await db.collection("bulkInvoiceLogs").doc(logId).set(logDoc);

    // Only update job status and billing history for non-test runs
    if (!isTest) {
      // Write billing history for each successfully sent invoice
      const batch = db.batch();

      for (const result of sent) {
        const billing = calculateBilling(result.plantId, startDate, endDate);
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
