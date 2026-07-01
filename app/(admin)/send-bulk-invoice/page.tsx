// app/(admin)/send-bulk-invoice/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MOCK_SUBSCRIBERS } from "@/lib/mock/subscribers";
import { isSubscriberEligible, getMissingDates } from "@/lib/mock/generation";

interface BillingJob {
  jobId: string;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  status: string;
  successCount?: number;
  failedCount?: number;
  blockedCount?: number;
  latestLogId?: string | null;
}

interface EligibleRow {
  plant_id: string;
  name: string;
  email: string;
}

interface BlockedRow {
  plant_id: string;
  name: string;
  email: string;
  reason: string;
  missingDates: string[];
}

function addMonthMinusDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const nextMonth = new Date(d);
  nextMonth.setUTCMonth(d.getUTCMonth() + 1);
  nextMonth.setUTCDate(d.getUTCDate() - 1);
  return nextMonth.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000
  );
}

function formatDisplayDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-MY", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  Running: "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
  "Partially Completed": "bg-orange-100 text-orange-800",
  Failed: "bg-red-100 text-red-800",
};

export default function SendBulkInvoicePage() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  // Date picker state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [scheduledSendDate, setScheduledSendDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [savingJob, setSavingJob] = useState(false);

  // Current job
  const [currentJob, setCurrentJob] = useState<BillingJob | null>(null);
  const [loadingJob, setLoadingJob] = useState(true);

  // Run / test send state
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    status: string; sent: number; failed: number; blocked: number; isTest?: boolean;
  } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "warning" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "warning" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }

  // Auto-suggest end date when start date changes
  useEffect(() => {
    if (startDate) {
      setEndDate(addMonthMinusDay(startDate));
    }
  }, [startDate]);

  // Validate date inputs
  useEffect(() => {
    if (!startDate || !endDate) { setDateError(null); return; }
    if (endDate < startDate) { setDateError("End date must be after start date"); return; }
    const diff = daysBetween(startDate, endDate);
    if (diff > 30) { setDateError("Billing period must not exceed 30 days"); return; }
    if (scheduledSendDate && scheduledSendDate < today) {
      setDateError("Scheduled send date cannot be in the past"); return;
    }
    setDateError(null);
  }, [startDate, endDate, scheduledSendDate, today]);

  const canSetCycle = !!(startDate && endDate && scheduledSendDate && !dateError);

  // Load current job from Firebase
  const loadJob = useCallback(async () => {
    setLoadingJob(true);
    try {
      const res = await fetch("/api/bulk-invoice/job");
      if (!res.ok) return;
      const data = await res.json() as BillingJob | { job: null };
      if ("jobId" in data) setCurrentJob(data);
      else setCurrentJob(null);
    } catch {
      // ignore
    } finally {
      setLoadingJob(false);
    }
  }, []);

  useEffect(() => { loadJob(); }, [loadJob]);

  // Poll while Running
  useEffect(() => {
    if (currentJob?.status !== "Running") return;
    const interval = setInterval(loadJob, 3000);
    return () => clearInterval(interval);
  }, [currentJob?.status, loadJob]);

  // Subscriber preflight split
  const billingRange = currentJob
    ? { start: currentJob.startDate, end: currentJob.endDate }
    : startDate && endDate
    ? { start: startDate, end: endDate }
    : null;

  const { eligible, blocked } = useMemo<{ eligible: EligibleRow[]; blocked: BlockedRow[] }>(() => {
    if (!billingRange) return { eligible: [], blocked: [] };
    const el: EligibleRow[] = [];
    const bl: BlockedRow[] = [];

    for (const sub of MOCK_SUBSCRIBERS) {
      if (!sub.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sub.email)) {
        bl.push({ plant_id: sub.plant_id, name: sub.name, email: sub.email || "", reason: "No email address", missingDates: [] });
        continue;
      }
      if (!isSubscriberEligible(sub.plant_id, billingRange.start, billingRange.end)) {
        const missing = getMissingDates(sub.plant_id, billingRange.start, billingRange.end);
        bl.push({ plant_id: sub.plant_id, name: sub.name, email: sub.email, reason: "Missing generation data", missingDates: missing });
        continue;
      }
      el.push({ plant_id: sub.plant_id, name: sub.name, email: sub.email });
    }
    return { eligible: el, blocked: bl };
  }, [billingRange]);

  async function handleSetCycle() {
    if (!canSetCycle) return;
    setSavingJob(true);
    try {
      const res = await fetch("/api/bulk-invoice/create-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, scheduledSendDate }),
      });
      if (!res.ok) {
        const e = await res.json() as { error: string };
        showToast(e.error || "Failed to set billing cycle", "error");
        return;
      }
      const job = await res.json() as BillingJob;
      setCurrentJob(job);
      showToast("Billing cycle set successfully", "success");
    } catch {
      showToast("Failed to set billing cycle", "error");
    } finally {
      setSavingJob(false);
    }
  }

  async function handleRun(isTest: boolean) {
    if (!currentJob || running) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch(`/api/bulk-invoice/run?force=true${isTest ? "&isTest=true" : ""}`, {
        method: "POST",
      });
      const data = await res.json() as { status: string; sent: number; failed: number; blocked: number; error?: string };
      if (!res.ok) {
        showToast(data.error || "Run failed", "error");
        return;
      }
      setRunResult({ ...data, isTest });
      await loadJob();
      if (isTest) {
        showToast(`Test send complete — ${data.sent} sent, ${data.blocked} blocked, ${data.failed} failed. Results visible in Send History (marked as Test).`, "success");
      } else {
        showToast(`Job ${data.status}: ${data.sent} sent, ${data.blocked} blocked, ${data.failed} failed.`, data.failed > 0 ? "warning" : "success");
      }
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setRunning(false);
    }
  }

  const toastBg = {
    success: "bg-green-50 border-green-200 text-green-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    error: "bg-red-50 border-red-200 text-red-800",
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {toast && (
          <div className={`rounded-md border px-4 py-3 text-sm ${toastBg[toast.type]}`}>
            {toast.message}
          </div>
        )}

        {/* Section 1: Date picker */}
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Set Billing Cycle</h2>
          <p className="text-sm text-gray-500 mb-4">
            Set the billing period and scheduled send date. The end date is auto-suggested as one day before the start day in the following month.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Billing Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Billing End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Scheduled Send Date</label>
              <input
                type="date"
                value={scheduledSendDate}
                onChange={(e) => setScheduledSendDate(e.target.value)}
                min={today}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {dateError && (
            <p className="mt-2 text-sm text-red-600">{dateError}</p>
          )}

          <div className="mt-4 flex items-center gap-4">
            <button
              onClick={handleSetCycle}
              disabled={!canSetCycle || savingJob}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-5 py-2"
            >
              {savingJob ? "Saving…" : "Set Billing Cycle"}
            </button>

            <div className="text-sm text-gray-500">
              {currentJob ? (
                <span className="text-gray-700">
                  Current billing cycle:{" "}
                  <strong>{formatDisplayDate(currentJob.startDate)} – {formatDisplayDate(currentJob.endDate)}</strong>
                  {" | "}Scheduled send: <strong>{formatDisplayDate(currentJob.scheduledSendDate)}</strong>
                </span>
              ) : (
                <span className="text-amber-600">No billing cycle determined yet</span>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Job card */}
        {!loadingJob && currentJob && (
          <div className="bg-white rounded-2xl shadow p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Scheduled Job</h3>
                <p className="text-sm text-gray-500">
                  {formatDisplayDate(currentJob.startDate)} – {formatDisplayDate(currentJob.endDate)}
                </p>
              </div>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[currentJob.status] ?? "bg-gray-100 text-gray-700"}`}>
                {currentJob.status}
              </span>
            </div>

            {runResult && (
              <div className="mb-4 rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700 flex flex-wrap gap-4">
                {runResult.isTest && <span className="font-semibold text-purple-700">[TEST] </span>}
                <span>Sent: <strong className="text-green-700">{runResult.sent}</strong></span>
                <span>Blocked: <strong className="text-amber-700">{runResult.blocked}</strong></span>
                <span>Failed: <strong className="text-red-700">{runResult.failed}</strong></span>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => handleRun(false)}
                disabled={running || currentJob.status === "Running"}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
              >
                {running ? "Running…" : "Run Now"}
              </button>
              <button
                onClick={() => handleRun(true)}
                disabled={running || currentJob.status === "Running"}
                className="border border-purple-600 text-purple-600 hover:bg-purple-50 disabled:opacity-50 text-sm font-medium rounded-lg px-4 py-2"
              >
                Test Send
              </button>
              <button
                onClick={() => router.push("/bulk-invoice-send-history")}
                className="border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2"
              >
                Send History
              </button>
            </div>
          </div>
        )}

        {/* Section 3: Eligible subscribers */}
        {billingRange && (
          <>
            <div className="bg-white rounded-2xl shadow p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-3">
                Eligible Subscribers ({eligible.length})
              </h3>
              <div className="overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plant ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {eligible.length > 0 ? eligible.map((s) => (
                      <tr key={s.plant_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-mono">{s.plant_id}</td>
                        <td className="px-4 py-3 text-gray-900">{s.name}</td>
                        <td className="px-4 py-3 text-gray-500">{s.email}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => router.push(`/single-user-bulk-invoice-history?plantId=${s.plant_id}`)}
                            className="text-xs text-blue-600 hover:underline font-medium"
                          >
                            Bulk Send History
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No eligible subscribers</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 4: Blocked subscribers */}
            <div className="bg-amber-50 rounded-2xl shadow p-6">
              <h3 className="text-base font-semibold text-amber-900 mb-3">
                Blocked Subscribers ({blocked.length})
              </h3>
              <div className="overflow-auto rounded-lg border border-amber-200">
                <table className="w-full text-sm divide-y divide-amber-100">
                  <thead className="bg-amber-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Plant ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Customer Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Reason</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Missing Dates</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 bg-amber-50">
                    {blocked.length > 0 ? blocked.map((s) => (
                      <tr key={s.plant_id}>
                        <td className="px-4 py-3 text-amber-900 font-mono">{s.plant_id}</td>
                        <td className="px-4 py-3 text-amber-900">{s.name}</td>
                        <td className="px-4 py-3 text-amber-700">{s.email || <span className="text-red-600 text-xs">No email</span>}</td>
                        <td className="px-4 py-3 text-amber-700 text-xs">{s.reason}</td>
                        <td className="px-4 py-3 text-amber-700 text-xs max-w-[200px]">
                          {s.missingDates.length > 0 ? s.missingDates.join(", ") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => router.push(`/single-user-bulk-invoice-history?plantId=${s.plant_id}`)}
                            className="text-xs text-amber-800 hover:underline font-medium"
                          >
                            Bulk Send History
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-amber-400">No blocked subscribers</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
