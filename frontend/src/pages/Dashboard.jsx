import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useUserStore from "../store/userStore";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchDailyPlan,
  fetchUrgentTasks,
  fetchDeadlineSummary,
  fetchHabitsSummary,
  fetchMeetings,
  fetchUpcomingBills,
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

const DONUT_COLORS = ["#FFB000", "#2A2F36"];

const fadeUp = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } };

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function TopBar({ onSync, syncing }) {
  const user = useUserStore((s) => s.user);
  const [imgFailed, setImgFailed] = useState(false);
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase() || "?";
  const showPicture = user?.picture_url && !imgFailed;
  return (
    <header className="flex items-center justify-between border-b border-border bg-bg-surface/60 px-6 py-3 backdrop-blur-sm">
      <h1 className="font-display text-lg font-bold tracking-tight">Producty</h1>
      <div className="flex items-center gap-3">
        <button onClick={onSync} disabled={syncing}
          className="flex items-center gap-1.5 rounded-lg bg-accent-blue/10 px-3 py-1.5 text-xs font-medium text-accent-blue transition hover:bg-accent-blue/20 disabled:opacity-50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}>
            <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m0 0a9 9 0 0 1 9-9m-9 9a9 9 0 0 0 9 9" />
          </svg>
          {syncing ? "Syncing…" : "Sync Google"}
        </button>
        {showPicture ? (
          <img src={user.picture_url} alt={user?.name || "Profile"} referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-accent-purple/20 flex items-center justify-center text-xs font-bold text-accent-purple">{initial}</div>
        )}
      </div>
    </header>
  );
}

function DailyPlanWidget({ data, isLoading }) {
  if (isLoading) return <CardSkeleton lines={5} />;
  if (!data) return null;

  const sections = [
    { title: "Morning", code: "AM", blocks: data.morning_blocks },
    { title: "Afternoon", code: "PM", blocks: data.afternoon_blocks },
    { title: "Evening", code: "EVE", blocks: data.evening_blocks },
  ];

  return (
    <div className="border border-border bg-bg-surface p-5 space-y-4">
      <h3 className="font-display text-sm font-bold text-text-muted">Daily Plan</h3>
      {sections.map(({ title, code, blocks }) =>
        blocks?.length > 0 && (
          <div key={title} className="space-y-1">
            <p className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
              <span className="text-accent">{code}</span> {title}
            </p>
            <div className="divide-y divide-border border-y border-border">
              {blocks.map((b, i) => (
                <div key={i} className="flex items-center gap-3 px-1 py-2">
                  <span className="font-mono text-[11px] text-accent w-14 shrink-0">{fmtTime(b.time)}</span>
                  <span className="text-sm text-text-primary truncate">{b.activity}</span>
                </div>
              ))}
            </div>
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
        <div className="border border-border bg-bg-surface px-6 py-8 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-text-muted">Nothing urgent</p>
          <p className="mt-1.5 text-sm text-text-muted">Plan your next move.</p>
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
          <div className="h-8 w-1 rounded-full" style={{ background: m.category === "professional" ? "#4D7C8A" : "#5A6470" }} />
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
  if (isLoading) return <CardSkeleton lines={2} />;
  const bills = (data || []).slice(0, 2);
  if (bills.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5 space-y-3">
      <h3 className="font-display text-sm font-bold text-text-muted uppercase tracking-wider">Bills Due</h3>
      {bills.map((b) => (
        <div key={b.id} className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary">{b.name}</p>
            <p className="font-mono text-[11px] text-text-muted">
              {b.days_until_due != null && b.days_until_due <= 1 ? "Due tomorrow" : `${b.days_until_due}d left`}
            </p>
          </div>
          <span className="font-mono text-sm font-semibold text-accent-amber">
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
    improving: { label: "▲ UP", cls: "text-accent" },
    steady: { label: "— FLAT", cls: "text-text-muted" },
    slipping: { label: "▼ DOWN", cls: "text-accent-red" },
  }[m.recent_trend] || { label: "— FLAT", cls: "text-text-muted" };
  return (
    <div className="border border-border bg-bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-text-muted">Momentum</h3>
        <span className={`font-mono text-[11px] font-semibold tracking-wider ${trend.cls}`}>{trend.label}</span>
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
    <div className="flex items-start gap-3 border-l-2 border-accent bg-accent/5 p-4">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent shrink-0 pt-0.5">AI</span>
      <p className="text-sm text-text-muted leading-relaxed">{message}</p>
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
        <div className="mx-auto max-w-7xl grid grid-cols-1 lg:grid-cols-[30%_1fr_25%] gap-6">

          {/* -------- LEFT COLUMN -------- */}
          <div className="space-y-6">
            <motion.div {...fadeUp}>
              <p className="font-display text-2xl font-extrabold">{greeting()}, {firstName}</p>
              <p className="mt-1 text-sm text-text-muted">{today}</p>
            </motion.div>

            {/* The app's thesis in one button. */}
            <motion.div {...fadeUp}>
              <PanicButton className="w-full" />
              <p className="mt-2 text-center text-[11px] text-text-muted">Overwhelmed? Get a 48-hour survival plan instantly.</p>
            </motion.div>

            <MoodCheckin />

            <DailyPlanWidget data={plan.data} isLoading={plan.isLoading} />
          </div>

          {/* -------- CENTER COLUMN -------- */}
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">Urgency Feed</h2>
            <UrgencyFeed
              tasks={urgent.data}
              summary={summary.data}
              isLoading={urgent.isLoading || summary.isLoading}
              onDone={(id) => doneMut.mutate(id)}
              onSnooze={(id) => snoozeMut.mutate(id)}
            />
          </div>

          {/* -------- RIGHT COLUMN -------- */}
          <div className="space-y-6">
            <MomentumWidget />
            <HabitRing data={habits.data} isLoading={habits.isLoading} />
            <MeetingsWidget data={meetings.data} isLoading={meetings.isLoading} />
            <BillsWidget data={bills.data} isLoading={bills.isLoading} />
            <AiTip message={plan.data?.motivational_message} />
          </div>
        </div>
      </main>
    </div>
  );
}
