export interface MockSubscriber {
  plant_id: string;
  name: string;
  email: string;
  alternative_email_address_1?: string;
  alternative_email_address_2?: string;
}

export const MOCK_SUBSCRIBERS: MockSubscriber[] = [
  {
    plant_id: "1001",
    name: "Raoul Walia",
    email: "raoul@sols247.org",
    alternative_email_address_1: "raould.walia@gmail.com",
  },
  {
    plant_id: "1002",
    name: "Arif Haikal",
    email: "arif.h@sols247.org",
  },
  {
    plant_id: "1003",
    name: "Adam Halid",
    email: "adam.h@sols247.org",
    alternative_email_address_1: "adam.h@sols247.org",
  },
  {
    plant_id: "1004",
    name: "Ashweni Luques",
    email: "ash@sols247.org",
  },
  {
    plant_id: "1005",
    name: "Anand Bhandari",
    email: "anand.b@sols247.org",
    alternative_email_address_1: "anand.bhandari@gmail.com",
    alternative_email_address_2: "anand.b@sols247.org",
  }
];

// Mock billing records seeded into the Firestore emulator
// Each record mirrors the shape of solsGreenBillingHistoryAdmin docs
export const MOCK_BILLING_RECORDS = [
  {
    plant_id: "1001",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1001@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2025",
    invoiceEmailSentAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), // 14 days from now
  },
  {
    plant_id: "1002",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1002@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2025",
    invoiceEmailSentAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  },
  {
    plant_id: "1003",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1003@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2025",
    invoiceEmailSentAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  },
  {
    plant_id: "1004",
    billStatus: "draft", // not sent yet — should be blocked
    invoiceEmailMessageId: "",
    invoiceEmailSubject: "",
    invoiceEmailSentAt: 0,
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  },
  {
    plant_id: "1005",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1005@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2025",
    invoiceEmailSentAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), // overdue — should be blocked
  },
]