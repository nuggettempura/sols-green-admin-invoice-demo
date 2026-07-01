// app/api/bulk-invoice/job/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase/admin";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  try {
    const db = getFirestore(adminApp);

    if (jobId) {
      const doc = await db.collection("bulkInvoiceJobs").doc(jobId).get();
      if (!doc.exists) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
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
