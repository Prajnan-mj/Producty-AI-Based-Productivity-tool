import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  fetchTasks, triageTask, acceptTriage, defragCalendar, fetchMomentum,
} from "../lib/queries";

/* ----------------------------------------------------------------- */
/* Momentum card                                                      */
/* ----------------------------------------------------------------- */
function MomentumCard() {
  const momQ = useQuery({ queryKey: ["momentum"], queryFn: fetchMomentum });
  const m = momQ.data;
  if (!m) return null;

  const trendIcon = { improving: "📈", steady: "➡️", slipping: "📉" }[m.recent_trend] || "➡️";

  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base text-text-primary">Momentum</h3>
        <span className="text-2xl">{trendIcon}</span>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <span className="font-display text-4xl font-bold text-accent">{m.streak_pct}%</span>
        <span className="pb-1 text-sm text-text-muted">{m.completed}/{m.total} on time</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{m.message}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Triage result display                                              */
/* ----------------------------------------------------------------- */
function TriageDisplay({ result, onAccept, accepting }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-bg-surface p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
          result.status === "crisis" ? "bg-accent-red/20 text-accent-red" : "bg-accent/20 text-accent"
        }`}>
          {result.status === "crisis" ? "Crisis Mode" : "On Track"}
        </span>
        <span className="text-sm text-text-muted">
          {result.hours_remaining.toFixed(1)}h left — {result.hours_needed.toFixed(1)}h needed
        </span>
      </div>

      {result.micro_steps.length > 0 && (
        <>
          <h4 className="mb-2 text-sm font-semibold text-text-primary">Rescue Plan</h4>
          <div className="space-y-1.5">
            {result.micro_steps.map((s, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-bg-elevated px-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-text-onaccent">{s.order}</span>
                <span className="flex-1 text-sm text-text-primary">{s.title}</span>
                <span className="text-xs text-text-muted">{s.minutes}m</span>
              </div>
            ))}
          </div>
        </>
      )}

      {result.recommended_calendar_blocks.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold text-text-primary">Suggested Schedule</h4>
          <div className="space-y-1">
            {result.recommended_calendar_blocks.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-text-muted">
                <span className="font-mono">{new Date(b.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span>→</span>
                <span className="font-mono">{new Date(b.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-text-primary">{b.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <button onClick={() => onAccept(true)} disabled={accepting}
          className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-bold text-text-onaccent hover:brightness-105 disabled:opacity-50">
          {accepting ? "Saving…" : "Accept plan"}
        </button>
        <button onClick={() => onAccept(false)} disabled={accepting}
          className="rounded-lg bg-bg-elevated px-4 py-2.5 text-sm text-text-muted hover:text-text-primary">
          Decline
        </button>
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------- */
/* Defrag result display                                              */
/* ----------------------------------------------------------------- */
function DefragDisplay({ result }) {
  if (!result) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="mt-4 rounded-2xl border border-border bg-bg-surface p-6">
      <h4 className="mb-3 font-display text-base text-text-primary">Calendar Defrag for "{result.crisis_task}"</h4>
      {result.proposed_changes.length === 0 && result.crisis_slots.length === 0 ? (
        <p className="text-sm text-text-muted">No calendar conflicts found — your schedule is clear.</p>
      ) : (
        <>
          {result.proposed_changes.length > 0 && (
            <div className="mb-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Existing events</p>
              {result.proposed_changes.map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-bg-elevated px-3 py-2 text-sm">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    c.action === "move" ? "bg-accent/20 text-accent" : c.action === "shrink" ? "bg-accent-red/20 text-accent-red" : "bg-bg-base text-text-muted"
                  }`}>{c.action}</span>
                  <span className="text-text-primary">{c.title}</span>
                  <span className="ml-auto text-xs text-text-muted">{c.reason}</span>
                </div>
              ))}
            </div>
          )}
          {result.crisis_slots.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Crisis task slots</p>
              {result.crisis_slots.map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-accent">{new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span>→</span>
                  <span className="font-mono text-xs text-accent">{new Date(s.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-text-primary">{s.title}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

/* ----------------------------------------------------------------- */
/* Page                                                               */
/* ----------------------------------------------------------------- */
export default function Rescue() {
  const qc = useQueryClient();
  const [selectedTask, setSelectedTask] = useState(null);
  const [effort, setEffort] = useState(4);
  const [progress, setProgress] = useState(0);
  const [triageResult, setTriageResult] = useState(null);
  const [defragResult, setDefragResult] = useState(null);

  const tasksQ = useQuery({
    queryKey: ["tasks", "pending"],
    queryFn: () => fetchTasks({ status: "pending" }),
  });
  const pendingTasks = (tasksQ.data?.items || []).filter((t) => t.deadline);

  const triageMut = useMutation({
    mutationFn: ({ id, data }) => triageTask(id, data),
    onSuccess: (data) => { setTriageResult(data); toast.success(data.status === "crisis" ? "Crisis detected — rescue plan ready" : "You're on track!"); },
    onError: () => toast.error("Triage failed"),
  });

  const acceptMut = useMutation({
    mutationFn: ({ triageId, accepted }) => acceptTriage(triageId, accepted),
    onSuccess: (_, { accepted }) => {
      toast.success(accepted ? "Plan accepted — go!" : "Plan declined");
      qc.invalidateQueries({ queryKey: ["momentum"] });
    },
    onError: () => toast.error("Couldn't save"),
  });

  const defragMut = useMutation({
    mutationFn: (taskId) => defragCalendar(taskId),
    onSuccess: (data) => setDefragResult(data),
    onError: () => toast.error("Defrag failed"),
  });

  const runTriage = () => {
    if (!selectedTask) return;
    setTriageResult(null);
    setDefragResult(null);
    triageMut.mutate({
      id: selectedTask,
      data: { estimated_effort_hours: effort, current_progress_pct: progress },
    });
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Rescue Agent</h1>
          <p className="mt-1 text-sm text-text-muted">
            Pick a task with a deadline — Producty checks if you're in crisis and builds a rescue plan.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: controls */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-border bg-bg-surface p-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-text-muted">Task with deadline</label>
              <select value={selectedTask || ""} onChange={(e) => setSelectedTask(e.target.value || null)}
                className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none">
                <option value="">Select a task…</option>
                {pendingTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} — due {new Date(t.deadline).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-text-muted">Estimated effort (hours)</label>
                <input type="number" min={0.5} max={200} step={0.5} value={effort}
                  onChange={(e) => setEffort(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-text-muted">Current progress (%)</label>
                <input type="number" min={0} max={100} value={progress}
                  onChange={(e) => setProgress(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={runTriage} disabled={!selectedTask || triageMut.isPending}
                className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-bold text-text-onaccent hover:brightness-105 disabled:opacity-50">
                {triageMut.isPending ? "Analyzing…" : "Run Triage"}
              </button>
              {triageResult?.status === "crisis" && selectedTask && (
                <button onClick={() => defragMut.mutate(selectedTask)} disabled={defragMut.isPending}
                  className="rounded-lg bg-bg-elevated px-4 py-2.5 text-sm font-semibold text-text-primary hover:brightness-110 disabled:opacity-50">
                  {defragMut.isPending ? "Defragging…" : "Defrag Calendar"}
                </button>
              )}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {triageResult && (
              <TriageDisplay
                key={triageResult.triage_id}
                result={triageResult}
                onAccept={(accepted) => acceptMut.mutate({ triageId: triageResult.triage_id, accepted })}
                accepting={acceptMut.isPending}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {defragResult && <DefragDisplay result={defragResult} />}
          </AnimatePresence>
        </div>

        {/* Right: momentum */}
        <div>
          <MomentumCard />
          <p className="mt-3 text-center text-[10px] text-text-muted">
            Say "I have an exam tomorrow" to the voice button for instant panic capture.
          </p>
        </div>
      </div>
    </div>
  );
}
