import { NextRequest, NextResponse } from "next/server";
import { adminApp } from "@/lib/firebase/admin";
import { getFirestore } from "firebase-admin/firestore";

export async function POST(request: NextRequest) {
  try {
    const { plantIds } = await request.json();
    if (!Array.isArray(plantIds) || plantIds.length === 0) {
      return NextResponse.json({ results: {} });
    }

    const db = getFirestore(adminApp);
    const results: Record<string, string> = {};

    // Query logs collection for all entries matching any of the plant IDs
    const snapshot = await db.collection("paymentEmailRemainderLogs").get();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const entries: Array<{ plant_id: string; sent_at: number }> = Array.isArray(data.data) ? data.data : [];
      entries.forEach((entry) => {
        if (plantIds.includes(String(entry.plant_id))) {
          const iso = new Date(entry.sent_at).toISOString();
          // Keep the most recent timestamp per plant
          if (!results[entry.plant_id] || iso > results[entry.plant_id]) {
            results[entry.plant_id] = iso;
          }
        }
      });
    });

    return NextResponse.json({ results });
  } catch (err) {
    console.error("get-last-sent-by-plant-ids error:", err);
    return NextResponse.json({ results: {} });
  }
}
