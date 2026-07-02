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
  },
  {
    plant_id: "1006",
    name: "Lim Kok Weng",
    email: "lim.kokweng@example.com",
  },
  {
    plant_id: "1007",
    name: "Farah Diyana binti Rosli",
    email: "farah.diyana@example.com",
  },
  {
    plant_id: "1008",
    name: "Mohamad Hafiz bin Osman",
    email: "", // no email — to test the "cannot receive" case
  },
  // 1009-1030 — pads the roster past CHUNK_SIZE (20) so a bulk run exercises
  // more than one chunk in app/api/bulk-invoice/run/route.ts.
  { plant_id: "1009", name: "Chong Wei Ming", email: "chong.weiming@example.com" },
  { plant_id: "1010", name: "Nurul Ain binti Zulkifli", email: "nurul.ain@example.com" },
  { plant_id: "1011", name: "Tan Sri Ismail", email: "tan.ismail@example.com" },
  { plant_id: "1012", name: "Priya Devi Ramasamy", email: "priya.devi@example.com" },
  { plant_id: "1013", name: "Wong Chee Keong", email: "wong.cheekeong@example.com" },
  { plant_id: "1014", name: "Siti Aminah binti Rahman", email: "siti.aminah@example.com" },
  { plant_id: "1015", name: "Muhammad Aizat bin Yusof", email: "aizat.yusof@example.com" },
  { plant_id: "1016", name: "Lee Mei Fen", email: "lee.meifen@example.com" },
  { plant_id: "1017", name: "Karthik Subramaniam", email: "karthik.s@example.com" },
  { plant_id: "1018", name: "Nor Hidayah binti Kamal", email: "nor.hidayah@example.com" },
  { plant_id: "1019", name: "Goh Jun Wei", email: "goh.junwei@example.com" },
  { plant_id: "1020", name: "Aisyah binti Mohd Nasir", email: "aisyah.nasir@example.com" },
  { plant_id: "1021", name: "Vikram Singh Gill", email: "vikram.gill@example.com" },
  { plant_id: "1022", name: "Chin Li Wen", email: "chin.liwen@example.com" },
  { plant_id: "1023", name: "Amirul Hakim bin Zainal", email: "amirul.hakim@example.com" },
  { plant_id: "1024", name: "Devaraj a/l Muthusamy", email: "devaraj.muthusamy@example.com" },
  { plant_id: "1025", name: "Fatin Nabila binti Hashim", email: "fatin.nabila@example.com" },
  { plant_id: "1026", name: "Ong Kai Xuan", email: "ong.kaixuan@example.com" },
  { plant_id: "1027", name: "Haziq Danial bin Sulaiman", email: "haziq.danial@example.com" },
  { plant_id: "1028", name: "Meera Krishnan", email: "meera.krishnan@example.com" },
  { plant_id: "1029", name: "Teoh Boon Hock", email: "teoh.boonhock@example.com" },
  { plant_id: "1030", name: "Zulaikha binti Sabri", email: "zulaikha.sabri@example.com" },
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
  {
    plant_id: "1006",
    billStatus: "save_to_drive",
    invoiceEmailMessageId: "<mock-msg-id-1006@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2025",
    invoiceEmailSentAt: Date.now() - 6 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  },
  {
    plant_id: "1007",
    billStatus: "sent_to_user",
    invoiceEmailMessageId: "<mock-msg-id-1007@mailgun.org>",
    invoiceEmailSubject: "Your Monthly Home Solar Subscription Billing - June 2025",
    invoiceEmailSentAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
    dueDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  },
];
