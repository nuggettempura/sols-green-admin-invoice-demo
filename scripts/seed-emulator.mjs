import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, setDoc, doc } from "firebase/firestore";

function makeBillingRecord({
  plant_id,
  billStatus,
  invoiceEmailMessageId,
  invoiceEmailSubject,
  invoiceEmailSentAt,
  dueDate,
  dueDateTs,
  invoiceNumber,
  dealId,
  billingAmount,
  sstRate = 0.032,
}) {
  const sstAmount = parseFloat((billingAmount * sstRate).toFixed(2));
  const taxInclusiveAmount = parseFloat((billingAmount + sstAmount).toFixed(2));
  const now = Date.now();
  const month = "June";
  const year = "2026";

  return {
    plant_id,
    billStatus,
    invoiceEmailMessageId,
    invoiceEmailSubject,
    invoiceEmailSentAt,

    // Billing period
    startDate: 1778860800000,
    endDate: "2026-06-30",
    billEndDateTs: 1782921599999,
    billGeneratedDate: "2026-06-22",
    billingYearMonth: "202606",

    // Invoice details
    invoiceNumber,
    dealId,
    nonce: crypto.randomUUID(),
    payexCollectionID: crypto.randomUUID(),
    description: `Billing for ${month} ${year}`,
    itemDescription: `Solar Green Product Monthly Bill for ${month} ${year}`,

    // Amounts
    billingAmount,
    subtotal: billingAmount,
    sstAmount,
    taxAmount: sstAmount,
    displayTaxAmount: sstAmount,
    taxExclusiveAmount: billingAmount,
    displayTaxExclusiveAmount: billingAmount,
    taxInclusiveAmount,
    displayPayableAmount: taxInclusiveAmount,

    // Due date
    dueDate,
    dueDateTs,

    // Timestamps
    createdAt: now - 8 * 24 * 60 * 60 * 1000,
    updatedAt: now - 7 * 24 * 60 * 60 * 1000,
    updatedAtTs: now - 7 * 24 * 60 * 60 * 1000,
  };
}

const MOCK_BILLING_RECORDS = [
  makeBillingRecord({
    plant_id: "1001",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1001@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2026",
    invoiceEmailSentAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dueDateTs: Date.now() + 14 * 24 * 60 * 60 * 1000,
    invoiceNumber: "HSS2026-0608001",
    dealId: 17878112001,
    billingAmount: 460.14,
  }),
  makeBillingRecord({
    plant_id: "1002",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1002@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2026",
    invoiceEmailSentAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dueDateTs: Date.now() + 10 * 24 * 60 * 60 * 1000,
    invoiceNumber: "HSS2026-0608002",
    dealId: 17878112002,
    billingAmount: 312.50,
  }),
  makeBillingRecord({
    plant_id: "1003",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1003@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2026",
    invoiceEmailSentAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dueDateTs: Date.now() + 7 * 24 * 60 * 60 * 1000,
    invoiceNumber: "HSS2026-0608003",
    dealId: 17878112003,
    billingAmount: 528.00,
  }),
  makeBillingRecord({
    plant_id: "1004",
    billStatus: "draft",
    invoiceEmailMessageId: "",
    invoiceEmailSubject: "",
    invoiceEmailSentAt: 0,
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dueDateTs: Date.now() + 7 * 24 * 60 * 60 * 1000,
    invoiceNumber: "HSS2026-0608004",
    dealId: 17878112004,
    billingAmount: 195.00,
  }),
  makeBillingRecord({
    plant_id: "1005",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1005@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2026",
    invoiceEmailSentAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dueDateTs: Date.now() - 1 * 24 * 60 * 60 * 1000,
    invoiceNumber: "HSS2026-0608005",
    dealId: 17878112005,
    billingAmount: 640.75,
  }),
  makeBillingRecord({
    plant_id: "1006",
    billStatus: "save_to_drive",
    invoiceEmailMessageId: "<mock-msg-id-1006@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2026",
    invoiceEmailSentAt: Date.now() - 6 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dueDateTs: Date.now() + 5 * 24 * 60 * 60 * 1000,
    invoiceNumber: "HSS2026-0608006",
    dealId: 17878112006,
    billingAmount: 389.20,
  }),
  makeBillingRecord({
    plant_id: "1007",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1007@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2026",
    invoiceEmailSentAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dueDateTs: Date.now() + 12 * 24 * 60 * 60 * 1000,
    invoiceNumber: "HSS2026-0608007",
    dealId: 17878112007,
    billingAmount: 275.90,
  }),
];

const app = initializeApp({
  apiKey: "demo-key",
  projectId: "demo-no-project",
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
