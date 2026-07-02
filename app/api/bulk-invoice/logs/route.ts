// app/api/bulk-invoice/logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase/admin";

export async function GET(req: NextRequest) {
  const logId = req.nextUrl.searchParams.get("logId");

  try {
    const db = getFirestore(adminApp);

    // Single log lookup — used by the UI to poll a chunked run's progress
    if (logId) {
      const doc = await db.collection("bulkInvoiceLogs").doc(logId).get();
      if (!doc.exists) {
        return NextResponse.json({ error: "Log not found" }, { status: 404 });
      }
      return NextResponse.json(doc.data());
    }

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
