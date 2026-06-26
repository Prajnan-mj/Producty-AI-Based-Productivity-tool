import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useUserStore from "../store/userStore";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  fetchDailyPlan,
  fetchUrgentTasks,
  fetchDeadlineSummary,
  fetchHabitsSummary,
  fetchMeetings,
  fetchUpcomingBills,
  createBill,
  syncCalendar,
  markTaskDone,
  snoozeDeadline,
  fetchMomentum,
} from "../lib/queries";
import UrgencyRing from "../components/UrgencyRing";
import PanicButton from "../components/PanicButton";
import MoodCheckin from "../components/MoodCheckin";
import { CardSkeleton } from "../components/Skeleton";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtTime(raw) {
  if (!raw) return "";
  if (/^\d{1,2}:\d{2}/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatCountdown(deadline) {
  if (!deadline) return "";
  const ms = new Date(deadline) - Date.now();
  if (ms < 0) return "overdue";
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}h left`;
  return `${Math.ceil(h / 24)}d left`;
}

function priorityColor(p) {
  if (p === "high") return "border-accent-red";
  if (p === "medium") return "border-accent-amber";
  return "border-accent-green";
}

function priorityBadge(p) {
  const colors = {
    high: "bg-accent-red/15 text-accent-red",
    medium: "bg-accent-amber/15 text-accent-amber",
    low: "bg-accent-green/15 text-accent-green",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[p] || colors.low}`}>
      {p}
    </span>
  );
}

function todayISO() {
  return new Date().toISOString();
}
function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(23, 59, 59);
  return d.toISOString();
}

const DONUT_COLORS = ["#B4522E", "#E4DCCE"];

const fadeUp = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } };

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function TopBar({ onSync, syncing }) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-bg-surface/60 px-6 py-3 backdrop-blur-sm">
      <h1 className="font-display text-lg font-bold tracking-tight">Producty</h1>
      <button onClick={onSync} disabled={syncing}
        className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}>
          <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m0 0a9 9 0 0 1 9-9m-9 9a9 9 0 0 0 9 9" />
        </svg>
        {syncing ? "Syncing…" : "Sync Google"}
      </button>
    </header>
  );
}

function DailyPlanWidget({ data, isLoading }) {
  if (isLoading) return <CardSkeleton lines={5} />;
  if (!data) return null;

  const sections = [
    { title: "Morning", blocks: data.morning_blocks },
    { title: "Afternoon", blocks: data.afternoon_blocks },
    { title: "Evening", blocks: data.evening_blocks },
  ];

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5 space-y-4">
      <h3 className="font-display text-sm font-bold text-text-muted uppercase tracking-wider">Daily Plan</h3>
      {sections.map(({ title, blocks }) =>
        blocks?.length > 0 && (
          <div key={title} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</p>
            {blocks.map((b, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-bg-elevated/50 px-3 py-2">
                <span className="font-mono text-[11px] text-accent-blue w-14 shrink-0">{fmtTime(b.time)}</span>
                <span className="text-sm text-text-primary truncate">{b.activity}</span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function UrgencyFeed({ tasks, summary, isLoading, onDone, onSnooze }) {
  if (isLoading) return <div className="space-y-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>;

  const items = tasks || [];

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Overdue", val: summary.overdue, cls: "text-accent-red bg-accent-red/10" },
            { label: "Today", val: summary.due_today, cls: "text-accent-amber bg-accent-amber/10" },
            { label: "This week", val: summary.due_this_week, cls: "text-accent-blue bg-accent-blue/10" },
          ].map(({ label, val, cls }) => (
            <span key={label} className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
              {val} {label}
            </span>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-xl border border-border bg-bg-surface p-8 text-center">
          <p className="text-sm font-semibold text-text-primary">Nothing urgent</p>
          <p className="mt-1 text-sm text-text-muted">Plan your next move.</p>
        </div>
      )}

      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.id} layout {...fadeUp}
            className={`group flex items-start gap-4 rounded-xl border-l-4 ${priorityColor(t.priority)} border border-border bg-bg-surface p-4 transition hover:bg-bg-elevated/60`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{t.title}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-[11px] text-accent-amber">{formatCountdown(t.deadline)}</span>
                {priorityBadge(t.priority)}
              </div>
            </div>
            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => onDone(t.id)}
                className="rounded-md bg-accent-green/10 px-2 py-1 text-[10px] font-semibold text-accent-green hover:bg-accent-green/20">Done</button>
              <button onClick={() => onSnooze(t.id)}
                className="rounded-md bg-accent-amber/10 px-2 py-1 text-[10px] font-semibold text-accent-amber hover:bg-accent-amber/20">+3h</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function HabitRing({ data, isLoading }) {
  if (isLoading) return <CardSkeleton lines={2} />;
  if (!data) return null;

  const { completed_count, total_count, completion_percentage } = data;
  const chartData = [
    { name: "done", value: completed_count },
    { name: "left", value: Math.max(total_count - completed_count, 0) },
  ];

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5 flex flex-col items-center gap-3">
      <h3 className="font-display text-sm font-bold text-text-muted uppercase tracking-wider self-start">Habits Today</h3>
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={38} outerRadius={52}
            dataKey="value" startAngle={90} endAngle={-270} animationDuration={800} strokeWidth={0}>
            {chartData.map((_, i) => (<Cell key={i} fill={DONUT_COLORS[i]} />))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="text-center">
        <span className="font-mono text-2xl font-bold text-accent-green">{completed_count}</span>
        <span className="text-text-muted text-sm">/{total_count}</span>
        <p className="text-[11px] text-text-muted">{Math.round(completion_percentage)}% complete</p>
      </div>
    </div>
  );
}

function MeetingsWidget({ data, isLoading }) {
  if (isLoading) return <CardSkeleton lines={3} />;
  const meetings = (data || []).slice(0, 3);
  if (meetings.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5 space-y-3">
      <h3 className="font-display text-sm font-bold text-text-muted uppercase tracking-wider">Upcoming</h3>
      {meetings.map((m) => (
        <div key={m.id} className="flex items-center gap-3">
          <div className="h-8 w-1 rounded-full" style={{ background: m.category === "professional" ? "#6F7D55" : "#8A7E6E" }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary truncate">{m.title}</p>
            <p className="font-mono text-[11px] text-text-muted">
              {new Date(m.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            m.category === "professional" ? "bg-accent-blue/10 text-accent-blue" : "bg-accent-purple/10 text-accent-purple"
          }`}>{m.category}</span>
        </div>
      ))}
    </div>
  );
}

function BillsWidget({ data, isLoading }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", amount: "", reason: "personal", due_date: "" });
  const addMut = useMutation({
    mutationFn: (d) => createBill(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["upcomingBills"] });
      setForm({ name: "", amount: "", reason: "personal", due_date: "" });
      setShowAdd(false);
      toast.success("Bill added");
    },
  });

  const handleAdd = () => {
    if (!form.name.trim() || !form.amount || !form.due_date) return;
    addMut.mutate({
      name: form.name.trim(),
      amount: parseFloat(form.amount),
      currency: "INR",
      due_date: new Date(form.due_date).toISOString(),
      category: "other",
      recurrence: "one-time",
      platform: "manual",
      autopay_enabled: false,
    });
  };

  if (isLoading) return <CardSkeleton lines={2} />;
  const bills = (data || []).slice(0, 3);

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Bills Due</h3>
        <button onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-accent transition hover:bg-accent/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <div className="space-y-2 rounded-lg border border-border bg-bg-elevated p-3">
              <input placeholder="Bill name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-border bg-bg-surface px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
              <div className="flex gap-2">
                <input type="number" placeholder="Amount" min="0" step="0.01" value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="flex-1 rounded-lg border border-border bg-bg-surface px-2.5 py-1.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none" />
                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  className="flex-1 rounded-lg border border-border bg-bg-surface px-2.5 py-1.5 text-xs text-text-primary focus:outline-none" />
              </div>
              <div className="flex items-center gap-2">
                {["personal", "business"].map((r) => (
                  <button key={r} onClick={() => setForm({ ...form, reason: r })}
                    className={`rounded-md px-3 py-1 text-[11px] font-medium capitalize transition ${form.reason === r ? "bg-accent/15 text-accent" : "bg-bg-surface text-text-muted"}`}>
                    {r}
                  </button>
                ))}
                <button onClick={handleAdd} disabled={!form.name.trim() || !form.amount || !form.due_date || addMut.isPending}
                  className="ml-auto rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-text-onaccent transition hover:opacity-90 disabled:opacity-50">
                  {addMut.isPending ? "Adding..." : "Add bill"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {bills.length === 0 && !showAdd && (
        <p className="py-2 text-center text-sm text-text-muted">No upcoming bills.</p>
      )}

      {bills.map((b) => (
        <div key={b.id} className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary">{b.name}</p>
            <p className="font-mono text-[11px] text-text-muted">
              {b.days_until_due != null && b.days_until_due <= 1 ? "Due tomorrow" : `${b.days_until_due}d left`}
            </p>
          </div>
          <span className="font-mono text-sm font-semibold text-accent">
            {b.currency === "INR" ? "₹" : "$"}{Number(b.amount).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function MomentumWidget() {
  const momQ = useQuery({ queryKey: ["momentum"], queryFn: fetchMomentum, retry: false });
  const m = momQ.data;
  if (!m) return null;
  const trend = {
    improving: { label: "Improving", cls: "text-accent" },
    steady: { label: "Steady", cls: "text-text-muted" },
    slipping: { label: "Slipping", cls: "text-accent-red" },
  }[m.recent_trend] || { label: "Steady", cls: "text-text-muted" };
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-text-muted uppercase tracking-wider">Momentum</h3>
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${trend.cls}`}>{trend.label}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="font-mono text-3xl font-bold text-accent">{m.streak_pct}%</span>
        <span className="pb-0.5 text-xs text-text-muted">{m.completed}/{m.total} on time</span>
      </div>
      <p className="mt-2 text-xs text-text-muted leading-relaxed">{m.message}</p>
    </div>
  );
}

function AiTip({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border-l-2 border-accent bg-accent/5 p-4">
      <span className="shrink-0 pt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-accent">AI</span>
      <p className="text-sm leading-relaxed text-text-muted">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const qc = useQueryClient();
  const user = useUserStore((s) => s.user);
  const firstName = user?.name ? user.name.trim().split(/\s+/)[0] : "there";

  const plan = useQuery({ queryKey: ["dailyPlan"], queryFn: fetchDailyPlan, retry: false, staleTime: 30 * 60 * 1000 });
  const urgent = useQuery({ queryKey: ["urgentTasks"], queryFn: fetchUrgentTasks, retry: false });
  const summary = useQuery({ queryKey: ["deadlineSummary"], queryFn: fetchDeadlineSummary, retry: false });
  const habits = useQuery({ queryKey: ["habitsSummary"], queryFn: fetchHabitsSummary, retry: false });
  const meetings = useQuery({
    queryKey: ["upcomingMeetings"],
    queryFn: () => fetchMeetings(todayISO(), tomorrowISO()),
    retry: false,
  });
  const bills = useQuery({ queryKey: ["upcomingBills"], queryFn: fetchUpcomingBills, retry: false });

  const syncMut = useMutation({ mutationFn: syncCalendar, onSuccess: () => { qc.invalidateQueries({ queryKey: ["upcomingMeetings"] }); } });
  const doneMut = useMutation({ mutationFn: markTaskDone, onSuccess: () => { qc.invalidateQueries({ queryKey: ["urgentTasks"] }); } });
  const snoozeMut = useMutation({
    mutationFn: (id) => snoozeDeadline(id, "task", 3),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["urgentTasks"] }); },
  });

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar onSync={() => syncMut.mutate()} syncing={syncMut.isPending} />

      <main className="flex-1 px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {/* Greeting bar */}
          <motion.div {...fadeUp} className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-2xl font-bold tracking-tight">{greeting()}, <span className="text-accent">{firstName}</span></p>
              <p className="mt-1 text-sm text-text-muted">{today}</p>
            </div>
            <MoodCheckin />
          </motion.div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_38%]">
            {/* -------- MAIN COLUMN -------- */}
            <div className="space-y-5">
              <AiTip message={plan.data?.motivational_message} />

              <div>
                <h2 className="mb-3 font-display text-lg font-bold">Urgency Feed</h2>
                <UrgencyFeed
                  tasks={urgent.data}
                  summary={summary.data}
                  isLoading={urgent.isLoading || summary.isLoading}
                  onDone={(id) => doneMut.mutate(id)}
                  onSnooze={(id) => snoozeMut.mutate(id)}
                />
              </div>

              <MeetingsWidget data={meetings.data} isLoading={meetings.isLoading} />
            </div>

            {/* -------- SIDE COLUMN -------- */}
            <div className="space-y-5">
              <MomentumWidget />
              <HabitRing data={habits.data} isLoading={habits.isLoading} />
              <BillsWidget data={bills.data} isLoading={bills.isLoading} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
