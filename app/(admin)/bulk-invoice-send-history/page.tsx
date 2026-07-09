// app/(admin)/bulk-invoice-send-history/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface SubscriberResult {
  plantId: string;
  customerName: string;
  email: string;
  status: "sent" | "failed" | "blocked";
  reason?: string;
  missingDates?: string[];
  invoiceNumber?: string;
  previewUrl?: string | null;
  error?: string;
}

interface BulkInvoiceLog {
  logId: string;
  jobId: string;
  isTest: boolean;
  startDate: string;
  endDate: string;
  scheduledSendDate: string;
  runAt: string;
  status: string;
  totalProcessed: number;
  sent: number;
  failed: number;
  blocked: number;
  results: SubscriberResult[];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00Z")
    .toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatDateTime(iso: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });
}

const STATUS_COLORS: Record<string, string> = {
  Completed: "bg-green-100 text-green-800",
  "Partially Completed": "bg-orange-100 text-orange-800",
  Failed: "bg-red-100 text-red-800",
};

const RESULT_COLORS: Record<string, string> = {
  sent: "text-green-700",
  failed: "text-red-700",
  blocked: "text-amber-700",
};

export default function BulkInvoiceSendHistoryPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<BulkInvoiceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/bulk-invoice/logs")
      .then((r) => r.json())
      .then((d: { logs: BulkInvoiceLog[] }) => setLogs(d.logs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function toggleExpand(logId: string) {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      next.has(logId) ? next.delete(logId) : next.add(logId);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Bulk Invoice Send History</h1>
            <p className="text-sm text-gray-500 mt-1">All bulk invoice job runs, newest first</p>
          </div>
          <button
            onClick={() => router.push("/send-bulk-invoice")}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2"
          >
            Back to Send Bulk Invoice
          </button>
        </div>

        {loading && <p className="text-gray-400 text-sm">Loading…</p>}

        {!loading && logs.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-12 text-center text-gray-400">
            No send history yet. Use &quot;Run Now&quot; or &quot;Test Send&quot; on the Send Bulk Invoice page.
          </div>
        )}

        <div className="space-y-4">
          {logs.map((log) => (
            <div key={log.logId} className="bg-white rounded-2xl shadow">
              {/* Log header */}
              <button
                onClick={() => toggleExpand(log.logId)}
                className="w-full text-left px-6 py-4 flex flex-wrap items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatDate(log.startDate)} – {formatDate(log.endDate)}
                    </span>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[log.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {log.status}
                    </span>
                    {log.isTest && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-purple-100 text-purple-800">
                        TEST
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Run at {formatDateTime(log.runAt)} · Scheduled send: {formatDate(log.scheduledSendDate)}
                  </p>
                </div>
                <div className="flex gap-4 text-sm text-gray-600">
                  <span>Processed: <strong>{log.totalProcessed}</strong></span>
                  <span className="text-green-700">Sent: <strong>{log.sent}</strong></span>
                  <span className="text-amber-700">Blocked: <strong>{log.blocked}</strong></span>
                  <span className="text-red-700">Failed: <strong>{log.failed}</strong></span>
                </div>
                <span className="text-gray-400 text-sm">{expandedLogIds.has(log.logId) ? "▲" : "▼"}</span>
              </button>

              {/* Expanded results */}
              {expandedLogIds.has(log.logId) && (
                <div className="border-t border-gray-100 px-6 pb-4 pt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase">
                        <th className="text-left pb-2 pr-4">Customer</th>
                        <th className="text-left pb-2 pr-4">Plant ID</th>
                        <th className="text-left pb-2 pr-4">Status</th>
                        <th className="text-left pb-2 pr-4">Reason / Error</th>
                        <th className="text-left pb-2">Email</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {log.results.map((r) => (
                        <tr key={`${log.logId}-${r.plantId}`}>
                          <td className="py-2 pr-4 text-gray-900">{r.customerName}</td>
                          <td className="py-2 pr-4 text-gray-500 font-mono">{r.plantId}</td>
                          <td className={`py-2 pr-4 font-semibold capitalize ${RESULT_COLORS[r.status]}`}>
                            {r.status}
                          </td>
                          <td className="py-2 pr-4 text-gray-500 text-xs max-w-xs truncate">
                            {r.invoiceNumber && <span className="text-gray-700 mr-2">{r.invoiceNumber}</span>}
                            {r.reason || r.error || ""}
                            {r.missingDates && r.missingDates.length > 0 && (
                              <span className="text-amber-700 ml-1">({r.missingDates.join(", ")})</span>
                            )}
                          </td>
                          <td className="py-2 text-xs">
                            {r.previewUrl ? (
                              <a href={r.previewUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">
                                View email
                              </a>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
