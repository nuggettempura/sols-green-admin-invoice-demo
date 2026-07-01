/**
 * Seeds the Firebase emulator with mock billing records.
 * Run with: npx ts-node --esm scripts/seed-emulator.ts
 * (Emulator must be running: firebase emulators:start --only firestore,auth)
 */

import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, setDoc, doc } from "firebase/firestore";
import { MOCK_BILLING_RECORDS } from "../lib/mock/subscribers";

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_API_KEY,
  projectId: process.env.NEXT_PUBLIC_PROJECT_ID || "sols-energy-dev",
});

const db = getFirestore(app);
connectFirestoreEmulator(db, "localhost", 8080);

async function seed() {
  console.log("Seeding Firestore emulator with mock billing records...");

  for (const record of MOCK_BILLING_RECORDS) {
    const id = `mock-billing-${record.plant_id}`;
    await setDoc(doc(db, "solsGreenBillingHistoryAdmin", id), record);
    console.log(`  ✓ plant_id ${record.plant_id} — billStatus: ${record.billStatus}`);
  }

  console.log("\nDone! Open http://localhost:4000 to view the data.");
}

seed().catch(console.error);
