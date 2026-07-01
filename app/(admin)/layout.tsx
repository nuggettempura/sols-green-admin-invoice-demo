import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-blue-700 text-sm">SOLS Energy — Demo</span>
        <Link
          href="/send-bulk-invoice"
          className="text-sm text-gray-600 hover:text-blue-600 font-medium"
        >
          Send Bulk Invoice
        </Link>
        <Link
          href="/bulk-invoice-send-history"
          className="text-sm text-gray-600 hover:text-blue-600 font-medium"
        >
          Send History
        </Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
