import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  fetchBills, fetchBillsSummary, createBill, markBillPaid, detectBillsFromEmail,
} from "../lib/queries";
import { CardSkeleton } from "../components/Skeleton";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const PLATFORM_META = {
  google_pay: { label: "Google Pay", icon: "💳", color: "bg-accent-blue/10 text-accent-blue" },
  app_store: { label: "App Store", icon: "🍎", color: "bg-accent-purple/10 text-accent-purple" },
  bank: { label: "Bank", icon: "🏦", color: "bg-accent-green/10 text-accent-green" },
  manual: { label: "Manual", icon: "📝", color: "bg-bg-elevated text-text-muted" },
};

const RECURRENCE_BADGE = {
  monthly: "bg-accent-blue/10 text-accent-blue",
  weekly: "bg-accent-purple/10 text-accent-purple",
  yearly: "bg-accent-amber/10 text-accent-amber",
  "one-time": "bg-bg-elevated text-text-muted",
};

const TABS = [
  { key: "upcoming", label: "Upcoming", filter: { status: "pending" } },
  { key: "overdue", label: "Overdue", filter: { status: "overdue" } },
  { key: "paid", label: "Paid", filter: { status: "paid" } },
  { key: "all", label: "All", filter: {} },
];

/* ------------------------------------------------------------------ */
/* Summary cards                                                       */
/* ------------------------------------------------------------------ */

function SummaryCards({ data, isLoading }) {
  if (isLoading) return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} lines={1} />)}</div>;
  if (!data) return null;

  const cards = [
    { label: "Pending", value: `₹${Number(data.total_pending_amount).toLocaleString()}`, cls: "text-accent-amber" },
    { label: "Overdue", value: data.overdue_count, cls: "text-accent-red" },
    { label: "Autopay", value: data.autopay_count, cls: "text-accent-green" },
    { label: "Paid this month", value: `₹${Number(data.total_paid_this_month).toLocaleString()}`, cls: "text-accent-blue" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ label, value, cls }) => (
        <div key={label} className="rounded-xl border border-border bg-bg-surface p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
          <p className={`mt-1 font-mono text-xl font-bold ${cls}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bill card                                                           */
/* ------------------------------------------------------------------ */

function BillCard({ bill, onMarkPaid }) {
  const platform = PLATFORM_META[bill.platform] || PLATFORM_META.manual;
  const daysLeft = bill.days_until_due;
  const isOverdue = daysLeft != null && daysLeft < 0;
  const currency = bill.currency === "USD" ? "$" : "₹";

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`group rounded-xl border bg-bg-surface p-5 transition hover:bg-bg-elevated/60 ${
        isOverdue ? "border-accent-red/40" : "border-border"
      }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Name + platform */}
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-text-primary truncate">{bill.name}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${platform.color}`}>
              {platform.icon} {platform.label}
            </span>
          </div>

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${RECURRENCE_BADGE[bill.recurrence] || RECURRENCE_BADGE["one-time"]}`}>
              {bill.recurrence}
            </span>
            {bill.autopay_enabled && (
              <span className="flex items-center gap-1 rounded-full bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold text-accent-green">
                🔒 Autopay
              </span>
            )}
            {bill.status === "paid" && bill.paid_at && (
              <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold text-accent-green">
                ✓ Paid
              </span>
            )}
          </div>

          {/* Due date */}
          <p className="font-mono text-[11px] text-text-muted">
            Due {new Date(bill.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {daysLeft != null && bill.status !== "paid" && (
              <span className={`ml-2 font-semibold ${isOverdue ? "text-accent-red" : daysLeft <= 3 ? "text-accent-amber" : "text-accent-green"}`}>
                {isOverdue ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? "Due today" : daysLeft === 1 ? "Due tomorrow" : `${daysLeft}d left`}
              </span>
            )}
          </p>
        </div>

        {/* Amount + actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <p className="font-mono text-xl font-bold text-text-primary">
            {currency}{Number(bill.amount).toLocaleString()}
          </p>
          <div className="flex gap-1.5">
            {bill.status !== "paid" && (
              <button onClick={() => onMarkPaid(bill.id)}
                className="rounded-lg bg-accent-green/10 px-3 py-1.5 text-[11px] font-semibold text-accent-green hover:bg-accent-green/20 transition">
                Mark Paid
              </button>
            )}
            {bill.payment_url && (
              <a href={bill.payment_url} target="_blank" rel="noopener noreferrer"
                className="rounded-lg bg-accent-blue/10 px-3 py-1.5 text-[11px] font-semibold text-accent-blue hover:bg-accent-blue/20 transition">
                Pay →
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Detect bills modal                                                  */
/* ------------------------------------------------------------------ */

function DetectedBillsModal({ open, data, isLoading, onConfirm, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg rounded-2xl border border-border bg-bg-surface p-6 max-h-[80dvh] overflow-y-auto space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold">Bills Found in Gmail</h2>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-accent-purple">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-purple" />
            Scanning your emails with AI…
          </div>
        )}

        {data && (
          <>
            <p className="text-xs text-text-muted">{data.emails_scanned} emails scanned, {data.detected.length} bills found</p>
            {data.detected.length === 0 && (
              <p className="text-sm text-text-muted py-4 text-center">No bills detected in recent emails.</p>
            )}
            <div className="space-y-3">
              {data.detected.map((bill, i) => (
                <div key={i} className="rounded-lg border border-border bg-bg-elevated p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-text-primary">{bill.name}</p>
                      <p className="text-[11px] text-text-muted truncate">{bill.source_email_subject}</p>
                    </div>
                    {bill.amount && (
                      <p className="font-mono text-sm font-bold text-text-primary">
                        {bill.currency === "USD" ? "$" : "₹"}{Number(bill.amount).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {bill.due_date && <span className="font-mono text-[10px] text-accent-amber">Due: {bill.due_date}</span>}
                    <span className="rounded-full bg-bg-surface px-2 py-0.5 text-[10px] text-text-muted capitalize">{bill.category}</span>
                    <span className="font-mono text-[10px] text-accent-purple">{Math.round(bill.confidence * 100)}% conf</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => onConfirm(bill)}
                      className="rounded-md bg-accent-blue px-3 py-1 text-[11px] font-semibold text-bg-base hover:bg-accent-blue/80 transition">
                      Add Bill
                    </button>
                    <button className="rounded-md bg-bg-surface px-3 py-1 text-[11px] font-semibold text-text-muted hover:text-text-primary transition">
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-muted hover:text-text-primary transition">Close</button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add bill modal                                                      */
/* ------------------------------------------------------------------ */

function AddBillModal({ open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "", amount: "", currency: "INR", due_date: "",
    recurrence: "one-time", category: "other", platform: "manual",
    autopay_enabled: false, payment_url: "",
  });

  const mut = useMutation({
    mutationFn: createBill,
    onSuccess: () => {
      toast.success("Bill added");
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["billsSummary"] });
      onClose();
      setForm({ name: "", amount: "", currency: "INR", due_date: "", recurrence: "one-time", category: "other", platform: "manual", autopay_enabled: false, payment_url: "" });
    },
  });

  if (!open) return null;

  const submit = () => {
    if (!form.name || !form.amount || !form.due_date) return;
    mut.mutate({ ...form, amount: parseFloat(form.amount), due_date: new Date(form.due_date).toISOString() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl border border-border bg-bg-surface p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold">Add Bill</h2>

        <input placeholder="Bill name (e.g. Netflix, Rent)" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none" />

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-[11px] text-text-muted">Amount</label>
            <div className="mt-1 flex">
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="rounded-l-lg border border-r-0 border-border bg-bg-elevated px-2 py-2 text-xs text-text-primary focus:outline-none">
                <option value="INR">₹</option><option value="USD">$</option>
              </select>
              <input type="number" placeholder="500" value={form.amount} min="0" step="0.01"
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="flex-1 rounded-r-lg border border-border bg-bg-elevated px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none" />
            </div>
          </div>
          <div className="flex-1">
            <label className="text-[11px] text-text-muted">Due date</label>
            <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:outline-none" />
          </div>
        </div>

        {/* Recurrence */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-text-muted">Recurrence</label>
          <div className="flex gap-1.5">
            {["one-time", "monthly", "weekly", "yearly"].map((r) => (
              <button key={r} onClick={() => setForm({ ...form, recurrence: r })}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize transition ${form.recurrence === r ? "bg-accent-blue text-bg-base" : "bg-bg-elevated text-text-muted"}`}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Platform */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-text-muted">Platform</label>
          <div className="flex gap-1.5">
            {Object.entries(PLATFORM_META).map(([key, { label, icon }]) => (
              <button key={key} onClick={() => setForm({ ...form, platform: key })}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${form.platform === key ? "bg-accent-blue text-bg-base" : "bg-bg-elevated text-text-muted"}`}>
                {icon} {label}
              </button>
            ))}
          </div>
        </div>

        {/* Autopay toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <button onClick={() => setForm({ ...form, autopay_enabled: !form.autopay_enabled })}
            className={`relative h-6 w-11 rounded-full transition ${form.autopay_enabled ? "bg-accent-green" : "bg-bg-elevated"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.autopay_enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <span className="text-sm text-text-muted">Autopay enabled</span>
        </label>

        {/* Payment URL */}
        <input placeholder="Payment URL (optional)" value={form.payment_url}
          onChange={(e) => setForm({ ...form, payment_url: e.target.value })}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none" />

        <p className="text-[10px] text-text-muted italic">
          We don't process payments. Click the payment button to open your payment app.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-muted">Cancel</button>
          <button onClick={submit} disabled={!form.name || !form.amount || !form.due_date || mut.isPending}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-bg-base hover:bg-accent-blue/80 transition disabled:opacity-50">
            {mut.isPending ? "Adding…" : "Add Bill"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Bills() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("upcoming");
  const [showAdd, setShowAdd] = useState(false);
  const [showDetect, setShowDetect] = useState(false);

  const activeTab = TABS.find((t) => t.key === tab) || TABS[0];

  const summaryQ = useQuery({ queryKey: ["billsSummary"], queryFn: fetchBillsSummary });
  const billsQ = useQuery({ queryKey: ["bills", tab], queryFn: () => fetchBills(activeTab.filter) });

  const markPaidMut = useMutation({
    mutationFn: markBillPaid,
    onSuccess: () => {
      toast.success("Bill marked as paid ✅");
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["billsSummary"] });
    },
  });

  const detectMut = useMutation({
    mutationFn: detectBillsFromEmail,
    onSuccess: () => setShowDetect(true),
    onError: () => toast.error("Failed to scan Gmail"),
  });

  const confirmBillMut = useMutation({
    mutationFn: (bill) => {
      const payload = {
        name: bill.name,
        amount: bill.amount || 0,
        currency: bill.currency || "INR",
        due_date: bill.due_date ? new Date(bill.due_date).toISOString() : new Date().toISOString(),
        recurrence: "one-time",
        category: bill.category || "other",
        platform: "manual",
        autopay_enabled: false,
      };
      return createBill(payload);
    },
    onSuccess: () => {
      toast.success("Bill added from email");
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["billsSummary"] });
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-8 space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-extrabold">Bills</h1>
        <div className="flex gap-2">
          <button onClick={() => { detectMut.mutate(); setShowDetect(true); }}
            disabled={detectMut.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-accent-purple/10 px-3 py-1.5 text-xs font-semibold text-accent-purple hover:bg-accent-purple/20 transition disabled:opacity-50">
            📧 {detectMut.isPending ? "Scanning…" : "Scan Gmail"}
          </button>
          <button onClick={() => setShowAdd(true)}
            className="rounded-lg bg-accent-blue px-4 py-1.5 text-xs font-semibold text-bg-base hover:bg-accent-blue/80 transition">
            + Add Bill
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <SummaryCards data={summaryQ.data} isLoading={summaryQ.isLoading} />

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-bg-surface p-1 w-fit">
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${tab === key ? "bg-accent-blue text-bg-base" : "text-text-muted hover:text-text-primary"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Bills list */}
      {billsQ.isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
      ) : (billsQ.data || []).length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-surface p-8 text-center text-sm text-text-muted">
          No bills in this category.
        </div>
      ) : (
        <AnimatePresence>
          <div className="space-y-3">
            {(billsQ.data || []).map((b) => (
              <BillCard key={b.id} bill={b} onMarkPaid={(id) => markPaidMut.mutate(id)} />
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* Disclaimer */}
      <p className="text-center text-[11px] text-text-muted italic pt-4">
        💡 We don't process payments. Click the payment button to open your payment app.
      </p>

      {/* Modals */}
      <AddBillModal open={showAdd} onClose={() => setShowAdd(false)} />
      <DetectedBillsModal
        open={showDetect}
        data={detectMut.data}
        isLoading={detectMut.isPending}
        onConfirm={(bill) => confirmBillMut.mutate(bill)}
        onClose={() => setShowDetect(false)}
      />
    </div>
  );
}
