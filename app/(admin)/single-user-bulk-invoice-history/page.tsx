// app/(admin)/single-user-bulk-invoice-history/page.tsx
"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { MOCK_SUBSCRIBERS } from "@/lib/mock/subscribers";
import { getDailyReadings } from "@/lib/mock/generation";
import { calculateBilling } from "@/lib/invoice/calculate-billing";

const UNIT_RATE = 1.50;
const SST_RATE = 0.032;

function addMonthMinusDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const next = new Date(d);
  next.setUTCMonth(d.getUTCMonth() + 1);
  next.setUTCDate(d.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

function subtractMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function formatMonthYear(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

interface BillingMonth {
  label: string;
  startDate: string;
  endDate: string;
  totalEnergy: number;
  totalBilling: number;
  errorDays: number;
  days: Array<{
    date: string;
    energy: number;
    billingAmount: number;
    isError: boolean;
  }>;
}

function buildBillingMonths(plantId: string, baseStartDate: string, monthsBack: number): BillingMonth[] {
  const months: BillingMonth[] = [];

  for (let i = 0; i < monthsBack; i++) {
    const cycleStart = subtractMonths(baseStartDate, i);
    const cycleEnd = addMonthMinusDay(cycleStart);

    const readings = getDailyReadings(plantId, cycleStart, cycleEnd);
    const billing = calculateBilling(plantId, cycleStart, cycleEnd);

    const days = readings.map((r) => {
      const isError = r.energy === 0 && r.energy_custom === null && r.flags.length === 0;
      return {
        date: r.date,
        energy: r.energy,
        billingAmount: parseFloat((r.energy * UNIT_RATE * (1 + SST_RATE)).toFixed(2)),
        isError,
      };
    });

    months.push({
      label: formatMonthYear(cycleEnd),
      startDate: cycleStart,
      endDate: cycleEnd,
      totalEnergy: billing.totalEnergyKwh,
      totalBilling: billing.taxInclusiveAmount,
      errorDays: days.filter((d) => d.isError).length,
      days,
    });
  }

  return months;
}

export default function SingleUserBulkInvoiceHistoryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <SingleUserBulkInvoiceHistoryContent />
    </Suspense>
  );
}

function SingleUserBulkInvoiceHistoryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const plantId = searchParams.get("plantId") ?? "";

  const subscriber = MOCK_SUBSCRIBERS.find((s) => s.plant_id === plantId);

  const today = new Date().toISOString().slice(0, 10);
  const baseStart = useMemo(() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(16);
    if (d > new Date(today + "T00:00:00Z")) d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 10);
  }, [today]);

  const billingMonths = useMemo(() => {
    if (!plantId) return [];
    return buildBillingMonths(plantId, baseStart, 3);
  }, [plantId, baseStart]);

  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set([0]));

  function toggleMonth(i: number) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  if (!subscriber) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-gray-400">Subscriber not found: Plant ID {plantId}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{subscriber.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Plant ID: <span className="font-mono">{plantId}</span> · {subscriber.email || "No email"}
            </p>
          </div>
          <button
            onClick={() => router.back()}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2"
          >
            Back
          </button>
        </div>

        <div className="space-y-4">
          {billingMonths.map((month, i) => (
            <div key={month.label} className="bg-white rounded-2xl shadow">
              {/* Accordion header */}
              <button
                onClick={() => toggleMonth(i)}
                className="w-full text-left px-6 py-4 flex flex-wrap items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{month.label}</span>
                    {month.errorDays > 0 && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                        {month.errorDays} error{month.errorDays !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatDate(month.startDate)} – {formatDate(month.endDate)}
                  </p>
                </div>
                <div className="flex gap-6 text-sm text-gray-700">
                  <span>{month.totalEnergy.toFixed(2)} kWh</span>
                  <span className="font-semibold">RM {month.totalBilling.toFixed(2)}</span>
                </div>
                <span className="text-gray-400">{expandedMonths.has(i) ? "▲" : "▼"}</span>
              </button>

              {/* Accordion body */}
              {expandedMonths.has(i) && (
                <div className="border-t border-gray-100 px-6 pb-4 pt-3">
                  <div className="overflow-auto max-h-96 rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Energy (kWh)</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Billing (RM)</th>
                          <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {month.days.map((day) => (
                          <tr key={day.date} className={day.isError ? "bg-red-50" : ""}>
                            <td className="px-3 py-2 text-gray-700">{formatDate(day.date)}</td>
                            <td className={`px-3 py-2 text-right font-mono ${day.isError ? "text-red-600" : "text-gray-700"}`}>
                              {day.isError ? "—" : day.energy.toFixed(2)}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono ${day.isError ? "text-red-600" : "text-gray-700"}`}>
                              {day.isError ? "—" : day.billingAmount.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {day.isError ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">Error</span>
                              ) : (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-700">OK</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer totals */}
                  <div className="mt-3 flex flex-wrap gap-6 text-sm text-gray-700 border-t border-gray-100 pt-3">
                    <span>Total Energy: <strong>{month.totalEnergy.toFixed(2)} kWh</strong></span>
                    <span>Total Billing: <strong>RM {month.totalBilling.toFixed(2)}</strong></span>
                    {month.errorDays > 0 && (
                      <span className="text-red-700">Error Days: <strong>{month.errorDays}</strong></span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
