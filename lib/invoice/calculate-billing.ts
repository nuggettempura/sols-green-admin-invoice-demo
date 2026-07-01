import { v4 as uuidv4 } from "uuid";
import { getDailyReadings } from "@/lib/mock/generation";

const UNIT_RATE = 1.50; // RM per kWh
const SST_RATE = 0.032;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMonthLabel(endDate: string): string {
  const d = new Date(endDate + "T00:00:00Z");
  return d.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface BillingCalculation {
  invoiceNumber: string;
  billingYearMonth: string;
  startDate: string;
  endDate: string;
  billEndDateTs: number;
  billGeneratedDate: string;
  billStatus: "draft";
  billingAmount: number;
  createdAt: string;
  description: string;
  displayPayableAmount: number;
  displayTaxAmount: number;
  displayTaxExclusiveAmount: number;
  dueDate: string;
  dueDateTs: number;
  itemDescription: string;
  nonce: string;
  payexCollectionID: string;
  dealId: string;
  sstAmount: number;
  subtotal: number;
  taxAmount: number;
  taxExclusiveAmount: number;
  taxInclusiveAmount: number;
  updatedAt: string;
  updatedAtTs: number;
  totalEnergyKwh: number;
}

export function calculateBilling(
  plantId: string,
  startDate: string,
  endDate: string
): BillingCalculation {
  const readings = getDailyReadings(plantId, startDate, endDate);
  const totalEnergyKwh = round2(readings.reduce((sum, r) => sum + r.energy, 0));
  const billingAmount = round2(totalEnergyKwh * UNIT_RATE);
  const sstAmount = round2(billingAmount * SST_RATE);
  const taxInclusiveAmount = round2(billingAmount + sstAmount);

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const endDateMs = new Date(endDate + "T00:00:00Z").getTime();
  const dueDate = addDays(endDate, 14);
  const dueDateMs = new Date(dueDate + "T00:00:00Z").getTime();

  const yearMonth = endDate.slice(0, 7); // "2026-06"
  const monthLabel = getMonthLabel(endDate);
  const invoiceNumber = `INV-${yearMonth}-${plantId}`;

  return {
    invoiceNumber,
    billingYearMonth: yearMonth,
    startDate,
    endDate,
    billEndDateTs: endDateMs,
    billGeneratedDate: nowIso.slice(0, 10),
    billStatus: "draft",
    billingAmount,
    createdAt: nowIso,
    description: `Monthly Home Solar Subscription - ${monthLabel}`,
    displayPayableAmount: taxInclusiveAmount,
    displayTaxAmount: sstAmount,
    displayTaxExclusiveAmount: billingAmount,
    dueDate,
    dueDateTs: dueDateMs,
    itemDescription: "Home Solar Subscription",
    nonce: uuidv4(),
    payexCollectionID: uuidv4(),
    dealId: plantId,
    sstAmount,
    subtotal: billingAmount,
    taxAmount: sstAmount,
    taxExclusiveAmount: billingAmount,
    taxInclusiveAmount,
    updatedAt: nowIso,
    updatedAtTs: nowMs,
    totalEnergyKwh,
  };
}
