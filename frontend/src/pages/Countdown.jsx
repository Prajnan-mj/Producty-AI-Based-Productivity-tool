import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { fetchCountdowns, createCountdown, deleteCountdown, generatePrepPlan } from "../lib/queries";

const TYPES = ["interview", "exam", "pitch", "deadline", "other"];

function useTick() {
  const [, setN] = useState(0);
  useEffect(() => { const id = setInterval(() => setN((n) => n + 1), 1000); return () => clearInterval(id); }, []);
}

function timeParts(target) {
  const ms = new Date(target) - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { d, h, m, s };
}

const STAGES = [
  { key: 7 * 24, label: "7 days" },
  { key: 3 * 24, label: "3 days" },
  { key: 24, label: "24 hours" },
  { key: 1, label: "1 hour" },
];

function StageRail({ target }) {
  const hoursLeft = Math.max((new Date(target) - Date.now()) / 3600000, 0);
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((st, i) => {
        const passed = hoursLeft <= st.key;
        return (
          <div key={i} className="flex items-center gap-1">
            <div className={`h-2 w-2 rounded-full ${passed ? "bg-accent" : "bg-bg-elevated"}`} />
            <span className={`text-[10px] ${passed ? "text-accent" : "text-text-muted"}`}>{st.label}</span>
            {i < STAGES.length - 1 && <span className="mx-0.5 h-px w-3 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function EventCard({ event, onDelete, onPrep }) {
  useTick();
  const t = timeParts(event.event_at);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">{event.event_type}</span>
          <h3 className="mt-2 font-display text-lg text-text-primary">{event.title}</h3>
          <p className="text-xs text-text-muted">{new Date(event.event_at).toLocaleString()}</p>
        </div>
        <button onClick={() => onDelete(event.id)} className="text-text-muted hover:text-accent-red">✕</button>
      </div>

      <div className="mt-4">
        {t ? (
          <div className="flex gap-3">
            {[["d", t.d], ["h", t.h], ["m", t.m], ["s", t.s]].map(([u, v]) => (
              <div key={u} className="flex min-w-[52px] flex-col items-center rounded-lg bg-bg-elevated py-2">
                <span className="font-mono text-2xl font-bold text-text-primary">{String(v).padStart(2, "0")}</span>
                <span className="text-[10px] uppercase text-text-muted">{u}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-display text-lg text-accent-red">It's go time.</p>
        )}
      </div>

      <div className="mt-4"><StageRail target={event.event_at} /></div>

      <div className="mt-4">
        <button onClick={() => onPrep(event.id)}
          className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20">
          {event.prep_plan?.length ? "Regenerate prep plan" : "Generate AI prep plan"}
        </button>
        {event.prep_plan?.length > 0 && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {event.prep_plan.map((stage, i) => (
              <div key={i}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{stage.when}</p>
                <ul className="mt-1 space-y-1">
                  {stage.items.map((it, j) => (
                    <li key={j} className="flex gap-2 text-sm text-text-primary"><span className="text-text-muted">·</span>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function Countdown() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", event_type: "interview", event_at: "" });

  const eventsQ = useQuery({ queryKey: ["countdowns"], queryFn: fetchCountdowns });

  const createMut = useMutation({
    mutationFn: () => createCountdown({ title: form.title, event_type: form.event_type, event_at: new Date(form.event_at).toISOString() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["countdowns"] }); setForm({ title: "", event_type: "interview", event_at: "" }); toast.success("Countdown added"); },
    onError: () => toast.error("Couldn't add that"),
  });
  const deleteMut = useMutation({ mutationFn: deleteCountdown, onSuccess: () => qc.invalidateQueries({ queryKey: ["countdowns"] }) });
  const prepMut = useMutation({
    mutationFn: generatePrepPlan,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["countdowns"] }); toast.success("Prep plan ready"); },
    onError: () => toast.error("AI unavailable right now"),
  });

  const events = eventsQ.data || [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-8 space-y-6">
      <div>
        <h1 className="font-display text-2xl text-text-primary">Countdown</h1>
        <p className="mt-1 text-sm text-text-muted">High-stakes events with a T-minus prep timeline.</p>
      </div>

      {/* Add form */}
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="text-[11px] text-text-muted">Event</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Google onsite interview"
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
          </div>
          <div>
            <label className="text-[11px] text-text-muted">Type</label>
            <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary capitalize focus:outline-none">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-text-muted">When</label>
            <input type="datetime-local" value={form.event_at} onChange={(e) => setForm({ ...form, event_at: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:outline-none" />
          </div>
          <button onClick={() => createMut.mutate()} disabled={!form.title || !form.event_at || createMut.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent disabled:opacity-50">Add</button>
        </div>
      </div>

      {/* Events */}
      {eventsQ.isLoading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-border bg-bg-surface p-8 text-center text-sm text-text-muted">
          No countdowns yet. Add an interview, exam, or pitch above.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence>
            {events.map((e) => (
              <EventCard key={e.id} event={e} onDelete={deleteMut.mutate} onPrep={prepMut.mutate} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
