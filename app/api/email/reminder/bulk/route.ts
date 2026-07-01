import { NextRequest, NextResponse } from "next/server";
import formData from "form-data";
import Mailgun from "mailgun.js";
import { adminApp } from "@/lib/firebase/admin";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  buildPaymentReminderHtml,
  buildPaymentReminderText,
  PAYMENT_REMINDER_SUBJECT,
} from "@/lib/email/templates/payment-reminder";
import { MOCK_BILLING_RECORDS } from "@/lib/mock/subscribers";

interface ReminderRecipient {
  plantId?: string;
  customerName?: string;
  emails?: string[];
  email?: string;
}

interface NormalizedRecipient {
  emails: string[];
  customerName?: string;
  plantId?: string;
}

interface ThreadEligibleRecipient extends NormalizedRecipient {
  invoiceEmailMessageId: string;
  invoiceEmailSubject: string;
}

interface SendResult {
  email: string;
  plantId?: string;
  customerName?: string;
  status: "success" | "failed";
  error?: string;
}

interface BlockedRecipient {
  plantId?: string;
  customerName?: string;
  reasonCode: string;
  reason: string;
}

const mailgun = new Mailgun(formData);
const MAIL_BATCH_SIZE = 20;
const FROM_ADDRESS = "Sols Energy <subscription.billing@sols247.org>";
const DEFAULT_INVOICE_SUBJECT = "Your Monthly Home Solar Subscription Billing";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toReplySubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return `Re: ${DEFAULT_INVOICE_SUBJECT}`;
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function normalizeRecipients(input: ReminderRecipient[]): NormalizedRecipient[] {
  return input
    .map((r) => {
      const rawEmails = [
        ...(Array.isArray(r?.emails) ? r.emails : []),
        typeof r?.email === "string" ? r.email : "",
      ];
      const emails = Array.from(
        new Set(
          rawEmails
            .map((v) => (typeof v === "string" ? normalizeEmail(v) : ""))
            .filter((e) => !!e && isValidEmail(e))
        )
      );
      if (emails.length === 0) return null;
      return { emails, customerName: r.customerName, plantId: r.plantId } as NormalizedRecipient;
    })
    .filter((r): r is NormalizedRecipient => !!r);
}

function getMockBillingDocs(plantId: string): Record<string, unknown>[] {
  return MOCK_BILLING_RECORDS.filter((r) => String(r.plant_id) === String(plantId));
}

function resolveBillingThread(plantId: string, docs: Record<string, unknown>[]) {
  if (!plantId) return { eligible: false, reasonCode: "MISSING_PLANT_ID", reason: "Plant ID is required" };
  if (docs.length === 0) return { eligible: false, reasonCode: "BILL_NOT_FOUND", reason: "No billing record found" };

  const sentDocs = docs.filter((d) => d.billStatus === "sent_to_user" || d.billStatus === "save_to_drive");
  if (sentDocs.length === 0) return { eligible: false, reasonCode: "INVOICE_NOT_SENT", reason: "Invoice is not sent yet" };

  const threadDocs = sentDocs.filter((d) => !!d.invoiceEmailMessageId);
  if (threadDocs.length === 0) return { eligible: false, reasonCode: "INVOICE_THREAD_ID_MISSING", reason: "Invoice email thread id is missing" };

  const now = Date.now();
  const nonOverdue = threadDocs.filter((d) => {
    const dueDate = typeof d.dueDate === "string" ? new Date(`${d.dueDate}T23:59:59.999`).getTime() : 0;
    return dueDate > now;
  });

  if (nonOverdue.length === 0) return { eligible: false, reasonCode: "INVOICE_OVERDUE", reason: "Invoice due date has passed" };

  const latest = nonOverdue[0];
  return {
    eligible: true,
    messageId: String(latest.invoiceEmailMessageId),
    subject: String(latest.invoiceEmailSubject || DEFAULT_INVOICE_SUBJECT),
  };
}

async function classifyRecipients(recipients: NormalizedRecipient[]) {
  const blocked: BlockedRecipient[] = [];
  const eligible: ThreadEligibleRecipient[] = [];

  // Try to fetch from Firestore emulator, fall back to mock data
  let useFirestore = false;
  let db: FirebaseFirestore.Firestore | null = null;
  try {
    db = getFirestore(adminApp);
    useFirestore = true;
  } catch {
    // fall back to mock
  }

  for (const recipient of recipients) {
    const plantId = String(recipient.plantId || "").trim();
    let docs: Record<string, unknown>[] = [];

    if (useFirestore && db && plantId) {
      try {
        const snapshot = await db
          .collection("solsGreenBillingHistoryAdmin")
          .where("plant_id", "in", [plantId, plantId.replace(/^0+/, "")])
          .get();
        docs = snapshot.docs.map((d) => d.data() as Record<string, unknown>);
      } catch {
        docs = getMockBillingDocs(plantId);
      }
    } else {
      docs = getMockBillingDocs(plantId);
    }

    const resolution = resolveBillingThread(plantId, docs);
    if (!resolution.eligible) {
      blocked.push({
        plantId: recipient.plantId,
        customerName: recipient.customerName,
        reasonCode: resolution.reasonCode || "BILL_NOT_FOUND",
        reason: resolution.reason || "Not eligible",
      });
    } else {
      eligible.push({
        ...recipient,
        invoiceEmailMessageId: (resolution as { messageId: string }).messageId,
        invoiceEmailSubject: (resolution as { subject: string }).subject,
      });
    }
  }

  return { blocked, eligibleRecipients: eligible };
}

async function sendEmails(
  mg: ReturnType<typeof mailgun.client>,
  domain: string,
  recipients: ThreadEligibleRecipient[]
): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (let i = 0; i < recipients.length; i += MAIL_BATCH_SIZE) {
    const batch = recipients.slice(i, i + MAIL_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (r) => {
        try {
          await mg.messages.create(domain, {
            from: FROM_ADDRESS,
            to: r.emails,
            subject: toReplySubject(r.invoiceEmailSubject || DEFAULT_INVOICE_SUBJECT),
            "h:In-Reply-To": r.invoiceEmailMessageId,
            "h:References": r.invoiceEmailMessageId,
            html: buildPaymentReminderHtml({ customerName: r.customerName }),
            text: buildPaymentReminderText({ customerName: r.customerName }),
          });
          return { email: r.emails[0], plantId: r.plantId, customerName: r.customerName, status: "success" as const };
        } catch (err) {
          return {
            email: r.emails[0],
            plantId: r.plantId,
            customerName: r.customerName,
            status: "failed" as const,
            error: err instanceof Error ? err.message : "Failed to send",
          };
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

async function persistLogs(params: {
  sentBy: string;
  recipientsCount: number;
  successCount: number;
  failedCount: number;
  entries: Array<{ plant_id: string; plantName: string }>;
}): Promise<Record<string, string>> {
  const lastSentUpdates: Record<string, string> = {};
  if (params.entries.length === 0) return lastSentUpdates;

  const sentAtTs = Date.now();
  const sentAtISO = new Date(sentAtTs).toISOString();
  const dateStr = sentAtISO.slice(0, 10);

  params.entries.forEach((e) => { lastSentUpdates[e.plant_id] = sentAtISO; });

  try {
    const db = getFirestore(adminApp);
    const dataEntries = params.entries.map((e) => ({ plant_id: e.plant_id, sent_at: sentAtTs, plantName: e.plantName }));

    const existing = await db.collection("paymentEmailRemainderLogs").where("date", "==", dateStr).limit(1).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({
        date_ts: sentAtTs,
        sent_by: params.sentBy,
        data: FieldValue.arrayUnion(...dataEntries),
      });
    } else {
      const ref = db.collection("paymentEmailRemainderLogs").doc();
      await ref.set({
        id: ref.id,
        date: dateStr,
        date_ts: sentAtTs,
        sent_by: params.sentBy,
        data: dataEntries,
        meta: {
          totalRecipients: params.recipientsCount,
          successCount: params.successCount,
          failedCount: params.failedCount,
          subject: PAYMENT_REMINDER_SUBJECT,
          templateVersion: "v1",
        },
      });
    }
  } catch (err) {
    console.error("Failed to persist logs:", err);
  }

  return lastSentUpdates;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;

    if (!apiKey || !domain) {
      return NextResponse.json({ error: "Missing Mailgun configuration" }, { status: 500 });
    }

    const payload = await request.json();
    const sentBy = typeof payload?.sentBy === "string" ? payload.sentBy : "demo-user";
    const recipientsInput: ReminderRecipient[] = payload?.recipients || [];

    if (!Array.isArray(recipientsInput) || recipientsInput.length === 0) {
      return NextResponse.json({ error: "Recipients are required" }, { status: 400 });
    }

    const recipients = normalizeRecipients(recipientsInput);
    if (recipients.length === 0) {
      return NextResponse.json({ error: "No valid recipient emails found" }, { status: 400 });
    }

    const { blocked, eligibleRecipients } = await classifyRecipients(recipients);

    const mg = mailgun.client({ username: "api", key: apiKey });
    const results = eligibleRecipients.length > 0 ? await sendEmails(mg, domain, eligibleRecipients) : [];

    const successCount = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed");

    const successEntries = results
      .filter((r) => r.status === "success" && r.plantId)
      .map((r) => ({ plant_id: r.plantId!, plantName: r.customerName || r.plantId! }));

    const uniqueEntries = Array.from(new Map(successEntries.map((e) => [e.plant_id, e])).values());

    const lastSentUpdates = await persistLogs({
      sentBy,
      recipientsCount: eligibleRecipients.length,
      successCount,
      failedCount: failed.length,
      entries: uniqueEntries,
    });

    return NextResponse.json({
      success: failed.length === 0 && blocked.length === 0,
      totalRequested: recipients.length,
      eligibleCount: eligibleRecipients.length,
      blockedCount: blocked.length,
      totalRecipients: eligibleRecipients.length,
      successCount,
      failedCount: failed.length,
      blocked,
      failed,
      lastSentUpdates,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
