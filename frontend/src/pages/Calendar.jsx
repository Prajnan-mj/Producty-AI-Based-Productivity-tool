import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { fetchMeetings, fetchDeadlineTimeline, categorizeMeeting, createManualMeeting } from "../lib/queries";
import { CardSkeleton } from "../components/Skeleton";

/* ------------------------------------------------------------------ */
/* Add meeting modal                                                   */
/* ------------------------------------------------------------------ */

function AddMeetingModal({ open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", start_time: "", end_time: "", category: "personal", description: "" });

  const mut = useMutation({
    mutationFn: createManualMeeting,
    onSuccess: () => {
      toast.success("Meeting added");
      qc.invalidateQueries({ queryKey: ["meetings"] });
      onClose();
      setForm({ title: "", start_time: "", end_time: "", category: "personal", description: "" });
    },
    onError: () => toast.error("Failed to add meeting"),
  });

  if (!open) return null;

  const submit = () => {
    if (!form.title || !form.start_time) return;
    const start = new Date(form.start_time);
    const end = form.end_time ? new Date(form.end_time) : new Date(start.getTime() + 3600000);
    mut.mutate({
      title: form.title,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      category: form.category,
      description: form.description || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl border border-border bg-bg-surface p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold">Add Meeting</h2>
        <input placeholder="Meeting title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-text-muted">Start</label>
            <input type="datetime-local" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-2 py-2 text-xs text-text-primary focus:outline-none" />
          </div>
          <div>
            <label className="text-[11px] text-text-muted">End (optional)</label>
            <input type="datetime-local" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-2 py-2 text-xs text-text-primary focus:outline-none" />
          </div>
        </div>
        <div className="flex gap-2">
          {["personal", "professional"].map((c) => (
            <button key={c} onClick={() => setForm({ ...form, category: c })}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold capitalize transition ${form.category === c ? (c === "professional" ? "bg-accent-blue text-bg-base" : "bg-accent-purple text-bg-base") : "bg-bg-elevated text-text-muted"}`}>
              {c}
            </button>
          ))}
        </div>
        <textarea placeholder="Notes (optional)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-muted">Cancel</button>
          <button onClick={submit} disabled={!form.title || !form.start_time || mut.isPending}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-bg-base hover:opacity-90 transition disabled:opacity-50">
            {mut.isPending ? "Adding…" : "Add Meeting"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function startOfWeek(d = new Date()) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d) { return d.toISOString(); }
function fmtDate(s) { return new Date(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
function fmtTime(s) { return new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

function durationMin(start, end) {
  const ms = new Date(end) - new Date(start);
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function deadlineColor(days) {
  if (days < 3) return "#C2334D";
  if (days <= 7) return "#C08A3E";
  return "#B4522E";
}

const TABS = ["all", "personal", "professional"];

/* ------------------------------------------------------------------ */
/* Week strip                                                          */
/* ------------------------------------------------------------------ */

function WeekStrip({ from, to, onChangeRange }) {
  const days = useMemo(() => {
    const arr = [];
    let d = new Date(from);
    while (d <= to) { arr.push(new Date(d)); d = addDays(d, 1); }
    return arr;
  }, [from, to]);

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChangeRange(addDays(from, -7), addDays(to, -7))}
        className="rounded-lg bg-bg-elevated px-2 py-1 text-text-muted hover:text-text-primary transition text-sm">←</button>
      <div className="flex gap-1 overflow-x-auto">
        {days.map((d) => {
          const isToday = d.toDateString() === new Date().toDateString();
          return (
            <div key={d.toISOString()}
              className={`flex flex-col items-center rounded-lg px-3 py-2 text-xs transition ${isToday ? "bg-accent-blue/15 text-accent-blue" : "text-text-muted"}`}>
              <span className="font-medium">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
              <span className="font-mono text-base font-bold">{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <button onClick={() => onChangeRange(addDays(from, 7), addDays(to, 7))}
        className="rounded-lg bg-bg-elevated px-2 py-1 text-text-muted hover:text-text-primary transition text-sm">→</button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meeting card                                                        */
/* ------------------------------------------------------------------ */

function MeetingCard({ meeting, onCategorize }) {
  const [editing, setEditing] = useState(false);
  const cat = meeting.category;

  return (
    <div className="group flex items-start gap-4 rounded-xl border border-border bg-bg-surface p-4 transition hover:bg-bg-elevated/60">
      <div className="h-full w-1 shrink-0 rounded-full" style={{ background: cat === "professional" ? "#6F7D55" : "#8A7E6E" }} />

      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium text-text-primary truncate">{meeting.title}</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-mono text-accent-blue">{fmtTime(meeting.start)} – {fmtTime(meeting.end)}</span>
          <span className="text-text-muted">({durationMin(meeting.start, meeting.end)})</span>
          {meeting.attendees > 0 && (
            <span className="text-text-muted">👥 {meeting.attendees}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <AnimatePresence mode="wait">
          <motion.span key={cat} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold cursor-pointer ${cat === "professional" ? "bg-accent-blue/10 text-accent-blue" : "bg-accent-purple/10 text-accent-purple"}`}
            onClick={() => setEditing(!editing)}>
            {cat}
          </motion.span>
        </AnimatePresence>

        {meeting.meet_link && (
          <a href={meeting.meet_link} target="_blank" rel="noopener noreferrer"
            className="rounded-lg bg-accent-green/10 px-2 py-1 text-[10px] font-semibold text-accent-green hover:bg-accent-green/20 transition">
            Meet
          </a>
        )}
      </div>

      {editing && (
        <div className="flex gap-1">
          {["personal", "professional"].filter((c) => c !== cat).map((c) => (
            <button key={c} onClick={() => { onCategorize(meeting.id, c); setEditing(false); }}
              className="rounded-md bg-bg-elevated px-2 py-1 text-[10px] font-semibold text-text-muted hover:text-text-primary transition">
              → {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deadline timeline                                                   */
/* ------------------------------------------------------------------ */

function DeadlineTimeline({ items, sortByDeadline, onToggleSort }) {
  const sorted = useMemo(() => {
    const arr = [...(items || [])];
    if (sortByDeadline) arr.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    return arr;
  }, [items, sortByDeadline]);

  if (!sorted.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold">Deadlines</h3>
        <button onClick={onToggleSort}
          className="rounded-lg bg-bg-elevated px-3 py-1 text-xs text-text-muted hover:text-text-primary transition">
          {sortByDeadline ? "↕ Default order" : "↕ Arrange by deadline"}
        </button>
      </div>

      <div className="relative ml-3 border-l-2 border-border pl-6 space-y-4">
        {sorted.map((item) => {
          const days = item.days_remaining ?? Math.max(0, Math.ceil((new Date(item.deadline) - Date.now()) / 86400000));
          const color = deadlineColor(days);
          return (
            <div key={item.id} className="relative">
              <div className="absolute -left-[30px] top-1.5 h-3 w-3 rounded-full border-2 border-bg-surface" style={{ background: color }} />
              <div className="rounded-lg border border-border bg-bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: color + "18", color }}>
                    {item.type}
                  </span>
                  <p className="text-sm font-medium text-text-primary truncate">{item.title}</p>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px]">
                  <span className="font-mono" style={{ color }}>
                    {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d left`}
                  </span>
                  <span className="text-text-muted">{fmtDate(item.deadline)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar page                                                       */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(startOfWeek());
  const [to, setTo] = useState(addDays(startOfWeek(), 6));
  const [tab, setTab] = useState("all");
  const [sortDl, setSortDl] = useState(false);
  const [showAddMeeting, setShowAddMeeting] = useState(false);

  const meetingsQ = useQuery({
    queryKey: ["meetings", from.toISOString(), to.toISOString(), tab],
    queryFn: () => fetchMeetings(toISO(from), toISO(addDays(to, 1)), tab),
  });

  const deadlinesQ = useQuery({
    queryKey: ["deadlineTimeline", from.toISOString(), to.toISOString()],
    queryFn: () => fetchDeadlineTimeline(toISO(from), toISO(addDays(to, 1))),
  });

  const catMut = useMutation({
    mutationFn: ({ id, category }) => categorizeMeeting(id, category),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["meetings"] }); toast.success("Category updated"); },
  });

  // Group meetings by date
  const grouped = useMemo(() => {
    const map = {};
    (meetingsQ.data || []).forEach((m) => {
      const key = new Date(m.start).toDateString();
      (map[key] ||= []).push(m);
    });
    return Object.entries(map).sort(([a], [b]) => new Date(a) - new Date(b));
  }, [meetingsQ.data]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-8 space-y-6">
      {/* Week strip + nav */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-xl font-extrabold">Calendar</h1>
          <button onClick={() => setShowAddMeeting(true)}
            className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-semibold text-bg-base hover:opacity-90 transition">
            + Add Meeting
          </button>
        </div>
        <WeekStrip from={from} to={to} onChangeRange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <AddMeetingModal open={showAddMeeting} onClose={() => setShowAddMeeting(false)} />

      {/* Category tabs */}
      <div className="flex gap-1 rounded-xl bg-bg-surface p-1 w-fit">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold capitalize transition ${tab === t ? "bg-accent-blue text-bg-base" : "text-text-muted hover:text-text-primary"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Meetings list grouped by date */}
      {meetingsQ.isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-surface p-8 text-center text-text-muted text-sm">
          No meetings this week
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([dateStr, meetings]) => (
            <div key={dateStr}>
              <p className="mb-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                {fmtDate(dateStr)}
              </p>
              <div className="space-y-2">
                {meetings.map((m) => (
                  <MeetingCard key={m.id} meeting={m}
                    onCategorize={(id, cat) => catMut.mutate({ id, category: cat })} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Deadlines */}
      {deadlinesQ.isLoading ? <CardSkeleton lines={4} /> : (
        <DeadlineTimeline items={deadlinesQ.data} sortByDeadline={sortDl} onToggleSort={() => setSortDl(!sortDl)} />
      )}
    </div>
  );
}
