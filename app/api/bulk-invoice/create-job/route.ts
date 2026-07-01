// app/api/bulk-invoice/create-job/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase/admin";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const { startDate, endDate, scheduledSendDate } = (await req.json()) as {
      startDate: string;
      endDate: string;
      scheduledSendDate: string;
    };

    if (!startDate || !endDate || !scheduledSendDate) {
      return NextResponse.json(
        { error: "startDate, endDate, scheduledSendDate are required" },
        { status: 400 }
      );
    }

    const start = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);

    if (end < start) {
      return NextResponse.json(
        { error: "End date must be after start date" },
        { status: 400 }
      );
    }

    if (diffDays > 30) {
      return NextResponse.json(
        { error: "Billing period must not exceed 30 days" },
        { status: 400 }
      );
    }

    const db = getFirestore(adminApp);

    const jobId = uuidv4();
    const now = new Date().toISOString();

    const job = {
      jobId,
      startDate,
      endDate,
      scheduledSendDate,
      status: "Pending" as const,
      createdAt: now,
      updatedAt: now,
      totalSubscribers: 0,
      eligibleCount: 0,
      blockedCount: 0,
      successCount: 0,
      failedCount: 0,
      latestLogId: null as string | null,
    };

    await db.collection("bulkInvoiceJobs").doc(jobId).set(job);

    return NextResponse.json(job);
  } catch (err) {
    console.error("[create-job]", err);
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }
}
