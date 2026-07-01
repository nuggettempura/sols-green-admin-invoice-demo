"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { MOCK_SUBSCRIBERS } from "@/lib/mock/subscribers";

interface SubscriberRow {
  plant_id: string;
  name: string;
  email: string;
  alternative_email_address_1?: string;
  alternative_email_address_2?: string;
}

interface ReminderRecipient {
  plantId: string;
  customerName: string;
  emails: string[];
}

interface SendSummary {
  totalRequested: number;
  eligibleCount: number;
  blockedCount: number;
  totalRecipients: number;
  successCount: number;
  failedCount: number;
  blocked: Array<{ plantId?: string; customerName?: string; reasonCode?: string; reason?: string }>;
  failed: Array<{ email: string; plantId?: string; status: "failed"; error?: string }>;
}

interface ConfirmContext {
  action: "selected" | "all";
  recipients: ReminderRecipient[];
  skippedNoEmail: number;
}

interface SendProgress {
  done: number;
  total: number;
  chunkSize: number;
}

type LastSentMap = Record<string, string>;

const EMAIL_CHUNK_SIZE = 20;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function dedupeEmails(emails: string[]): string[] {
  return Array.from(
    new Set(emails.map(normalizeEmail).filter((e) => !!e && isValidEmail(e)))
  );
}

function toRecipient(subscriber: SubscriberRow): ReminderRecipient | null {
  const emails = dedupeEmails([
    subscriber.email || "",
    subscriber.alternative_email_address_1 || "",
    subscriber.alternative_email_address_2 || "",
  ]);
  if (emails.length === 0) return null;
  return { plantId: subscriber.plant_id, customerName: subscriber.name || "Valued Customer", emails };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function formatLastSent(ts?: string): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

function buildToastMessage(summary: SendSummary): string {
  if (summary.failedCount === 0 && summary.blockedCount === 0) {
    return `Sent ${summary.successCount} reminder email${summary.successCount === 1 ? "" : "s"} successfully.`;
  }
  return `Sent ${summary.successCount}/${summary.eligibleCount}. Blocked: ${summary.blockedCount}. Failed: ${summary.failedCount}.`;
}

export default function SendBulkInvoicePage() {
  const [subscribers] = useState<SubscriberRow[]>(MOCK_SUBSCRIBERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlantIds, setSelectedPlantIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<SendProgress | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmContext, setConfirmContext] = useState<ConfirmContext | null>(null);
  const [sendSummary, setSendSummary] = useState<SendSummary | null>(null);
  const [lastSentMap, setLastSentMap] = useState<LastSentMap>({});
  const [toast, setToast] = useState<{ message: string; type: "success" | "warning" | "error" } | null>(null);

  const selectAllRef = useRef<HTMLInputElement>(null);
  const isSendingRef = useRef(false);
  const isCancelledRef = useRef(false);

  const showToast = (message: string, type: "success" | "warning" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const filteredSubscribers = useMemo(() => {
    if (!searchQuery.trim()) return subscribers;
    const q = searchQuery.toLowerCase();
    return subscribers.filter(
      (s) =>
        s.plant_id?.toLowerCase().includes(q) ||
        s.name?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q)
    );
  }, [subscribers, searchQuery]);

  const selectableFilteredIds = useMemo(
    () => filteredSubscribers.filter((s) => !!toRecipient(s)).map((s) => s.plant_id),
    [filteredSubscribers]
  );

  const selectedFilteredCount = useMemo(
    () => selectableFilteredIds.filter((id) => selectedPlantIds.has(id)).length,
    [selectableFilteredIds, selectedPlantIds]
  );

  const allFilteredSelected =
    selectableFilteredIds.length > 0 && selectedFilteredCount === selectableFilteredIds.length;
  const partiallySelected = selectedFilteredCount > 0 && selectedFilteredCount < selectableFilteredIds.length;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  // Load last-sent timestamps from emulator Firestore
  const loadLastSentTimestamps = useCallback(async (plantIds: string[]) => {
    const unique = Array.from(new Set(plantIds.filter(Boolean)));
    if (unique.length === 0) return;
    try {
      const res = await fetch("/api/firestore/payment-reminder/get-last-sent-by-plant-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantIds: unique }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setLastSentMap(data?.results || {});
    } catch {
      // silently ignore — emulator may not have data yet
    }
  }, []);

  useEffect(() => {
    loadLastSentTimestamps(subscribers.map((s) => s.plant_id));
  }, [subscribers, loadLastSentTimestamps]);

  const toggleSelection = (plantId: string) => {
    setSelectedPlantIds((prev) => {
      const next = new Set(prev);
      next.has(plantId) ? next.delete(plantId) : next.add(plantId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedPlantIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        selectableFilteredIds.forEach((id) => next.delete(id));
      } else {
        selectableFilteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const openConfirmation = (action: "selected" | "all") => {
    const source =
      action === "all"
        ? subscribers
        : subscribers.filter((s) => selectedPlantIds.has(s.plant_id));

    const rawRecipients = source.map(toRecipient).filter((r): r is ReminderRecipient => !!r);
    const skippedNoEmail = source.length - rawRecipients.length;

    if (rawRecipients.length === 0) {
      showToast("No valid recipient email found", "warning");
      return;
    }

    setConfirmContext({ action, recipients: rawRecipients, skippedNoEmail });
    setConfirmOpen(true);
  };

  const handleSend = async () => {
    if (!confirmContext || isSendingRef.current) return;

    isSendingRef.current = true;
    isCancelledRef.current = false;
    setSending(true);
    setSendProgress({ done: 0, total: confirmContext.recipients.length, chunkSize: 0 });
    setSendSummary(null);

    try {
      const chunks = chunkArray(confirmContext.recipients, EMAIL_CHUNK_SIZE);
      let totalRequested = 0, eligibleCount = 0, blockedCount = 0;
      let totalRecipients = 0, successCount = 0, failedCount = 0, done = 0;
      const blocked: SendSummary["blocked"] = [];
      const failed: SendSummary["failed"] = [];
      const lastSentAgg: LastSentMap = {};

      for (const chunk of chunks) {
        if (isCancelledRef.current) break;

        setSendProgress({ done, total: confirmContext.recipients.length, chunkSize: chunk.length });

        const res = await fetch("/api/email/reminder/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: chunk }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to send reminder emails");

        totalRequested += Number(data.totalRequested || chunk.length);
        eligibleCount += Number(data.eligibleCount || 0);
        blockedCount += Number(data.blockedCount || 0);
        totalRecipients += Number(data.totalRecipients || 0);
        successCount += Number(data.successCount || 0);
        failedCount += Number(data.failedCount || 0);
        blocked.push(...(data.blocked || []));
        failed.push(...(data.failed || []));
        Object.assign(lastSentAgg, data.lastSentUpdates || {});

        done += chunk.length;
        setSendProgress({ done, total: confirmContext.recipients.length, chunkSize: chunk.length });

        if (!isCancelledRef.current && done < confirmContext.recipients.length) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      if (isCancelledRef.current) {
        showToast("Bulk email sending cancelled", "warning");
      } else {
        const summary: SendSummary = {
          totalRequested, eligibleCount, blockedCount,
          totalRecipients, successCount, failedCount, blocked, failed,
        };
        setSendSummary(summary);
        setConfirmOpen(false);
        if (confirmContext.action === "selected") setSelectedPlantIds(new Set());
        if (Object.keys(lastSentAgg).length > 0) {
          setLastSentMap((prev) => ({ ...prev, ...lastSentAgg }));
        }
        showToast(buildToastMessage(summary), failedCount > 0 || blockedCount > 0 ? "warning" : "success");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to send emails", "error");
    } finally {
      isSendingRef.current = false;
      setSending(false);
      setSendProgress(null);
    }
  };

  const toastColors = {
    success: "bg-green-50 border-green-200 text-green-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    error: "bg-red-50 border-red-200 text-red-800",
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl bg-white rounded-2xl shadow p-6">
        {/* Toast */}
        {toast && (
          <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${toastColors[toast.type]}`}>
            {toast.message}
          </div>
        )}

        {/* Header */}
        <div className="mb-4 flex flex-col gap-4">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Send Bulk Email Notification</h3>
              <p className="text-sm text-gray-500">
                Select subscribers and send the predefined payment reminder email via Mailgun.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Search by Plant ID, Name, Email..."
                className="min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3">
            <button
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
              disabled={sending || selectedPlantIds.size === 0}
              onClick={() => openConfirmation("selected")}
            >
              Send to Selected ({selectedPlantIds.size})
            </button>
            <button
              className="border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-sm font-medium rounded-lg px-4 py-2"
              disabled={sending || subscribers.length === 0}
              onClick={() => openConfirmation("all")}
            >
              Send to All ({subscribers.length})
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto max-h-[60vh] rounded-lg border border-gray-200">
          <table className="w-full text-sm divide-y divide-gray-200">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    disabled={selectableFilteredIds.length === 0}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Plant ID</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Customer Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Last Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredSubscribers.length > 0 ? (
                filteredSubscribers.map((s) => {
                  const recipient = toRecipient(s);
                  const disabled = !recipient;
                  return (
                    <tr key={s.plant_id} className={disabled ? "bg-amber-50" : "hover:bg-gray-50"}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedPlantIds.has(s.plant_id)}
                          onChange={() => toggleSelection(s.plant_id)}
                          disabled={disabled}
                          className="h-4 w-4 rounded border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-900">{s.plant_id || "-"}</td>
                      <td className="px-4 py-3 text-gray-900">{s.name || "-"}</td>
                      <td className="px-4 py-3 text-gray-500">{s.email || <span className="text-amber-600 text-xs">No email</span>}</td>
                      <td className="px-4 py-3 text-gray-500">{formatLastSent(lastSentMap[s.plant_id])}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-gray-400">
                    {subscribers.length === 0 ? "No subscribers found." : "No subscribers match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Send Summary */}
        {sendSummary && (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
            <h4 className="font-semibold text-gray-900 mb-2">Last Send Result</h4>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>Requested: {sendSummary.totalRequested}</span>
              <span>Eligible: {sendSummary.eligibleCount}</span>
              <span className="text-amber-700">Blocked: {sendSummary.blockedCount}</span>
              <span className="text-green-700">Successful: {sendSummary.successCount}</span>
              <span className="text-red-700">Failed: {sendSummary.failedCount}</span>
            </div>

            {sendSummary.blocked.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto rounded border border-amber-200 bg-white p-2">
                <p className="mb-1 text-sm font-medium text-amber-700">Blocked Recipients</p>
                <ul className="space-y-1 text-xs text-amber-700">
                  {sendSummary.blocked.map((b, i) => (
                    <li key={`${b.plantId}-${i}`}>
                      {b.customerName || "-"}{b.plantId ? ` (Plant ${b.plantId})` : ""} — {b.reason || b.reasonCode}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sendSummary.failed.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto rounded border border-red-200 bg-white p-2">
                <p className="mb-1 text-sm font-medium text-red-700">Failed Recipients</p>
                <ul className="space-y-1 text-xs text-red-700">
                  {sendSummary.failed.map((f) => (
                    <li key={`${f.email}-${f.plantId}`}>
                      {f.email}{f.plantId ? ` (Plant ${f.plantId})` : ""} — {f.error || "Unknown error"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      <Modal open={confirmOpen} setOpen={setConfirmOpen} closeBtn={!sending}>
        <div className="w-full max-w-2xl">
          <h3 className="text-lg font-semibold text-gray-900">Confirm Bulk Reminder Email</h3>

          {!sending && confirmContext && (
            <>
              <p className="mt-2 text-sm text-gray-600">
                Sending reminder emails to <strong>{confirmContext.recipients.length}</strong> subscriber{confirmContext.recipients.length !== 1 ? "s" : ""}:
              </p>
              {confirmContext.skippedNoEmail > 0 && (
                <p className="mt-1 text-sm text-amber-700">
                  Skipped (no valid email): <strong>{confirmContext.skippedNoEmail}</strong>
                </p>
              )}
              <div className="mt-3 max-h-64 overflow-y-auto rounded border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Plant ID</th>
                      <th className="px-3 py-2 text-left">Email(s)</th>
                      <th className="px-3 py-2 text-left">Last Sent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {confirmContext.recipients.map((r) => (
                      <tr key={r.plantId || r.emails[0]}>
                        <td className="px-3 py-2 font-medium text-gray-900">{r.customerName}</td>
                        <td className="px-3 py-2 text-gray-900">{r.plantId}</td>
                        <td className="px-3 py-2 text-gray-900 break-all">{r.emails.join(", ")}</td>
                        <td className="px-3 py-2 text-gray-900">{r.plantId ? formatLastSent(lastSentMap[r.plantId]) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {sending && sendProgress && (
            <div className="mt-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Processing {sendProgress.chunkSize} recipients…</p>
                <button
                  onClick={() => { isCancelledRef.current = true; setConfirmOpen(false); }}
                  className="border border-gray-300 text-gray-700 text-sm rounded-lg px-3 py-1"
                >
                  Cancel
                </button>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-sky-500 transition-all duration-500"
                  style={{ width: sendProgress.total > 0 ? `${(sendProgress.done / sendProgress.total) * 100}%` : "0%" }}
                />
              </div>
              <p className="mt-2 text-sm text-gray-600">{sendProgress.done} of {sendProgress.total} sent</p>
            </div>
          )}

          {!sending && (
            <div className="mt-4 flex justify-end gap-3 border-t pt-4">
              <button
                className="border border-gray-300 text-gray-700 text-sm font-medium rounded-lg px-4 py-2"
                onClick={() => setConfirmOpen(false)}
              >
                Back
              </button>
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2"
                onClick={handleSend}
              >
                Confirm &amp; Send
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
