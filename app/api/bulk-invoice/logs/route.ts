// app/api/bulk-invoice/logs/route.ts
import { NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase/admin";

export async function GET() {
  try {
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
