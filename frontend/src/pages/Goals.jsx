import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, CartesianGrid,
} from "recharts";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  fetchGoals, fetchGoalVisual, updateGoalProgress, completeMilestone, aiBreakdownGoal, bulkCreateTasks, goalResumeBullet,
} from "../lib/queries";
import { CardSkeleton } from "../components/Skeleton";

const TRACK_COLORS = {
  on_track: "#34D399",
  slightly_behind: "#FBBF24",
  behind: "#F87171",
  completed: "#A78BFA",
};

function trackLabel(s) {
  return { on_track: "On track", slightly_behind: "Slightly behind", behind: "Behind", completed: "Completed" }[s] || s;
}

/* ------------------------------------------------------------------ */
/* Visual analytics panel for a selected goal                         */
/* ------------------------------------------------------------------ */

function GoalVisual({ goal }) {
  const qc = useQueryClient();
  const [progressInput, setProgressInput] = useState(goal.progress_percentage);

  const visualQ = useQuery({
    queryKey: ["goalVisual", goal.id],
    queryFn: () => fetchGoalVisual(goal.id),
  });

  const progressMut = useMutation({
    mutationFn: () => updateGoalProgress(goal.id, { progress_percentage: progressInput, notes: "" }),
    onSuccess: () => {
      toast.success("Progress updated");
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goalVisual", goal.id] });
    },
  });

  const milestoneMut = useMutation({
    mutationFn: (msId) => completeMilestone(goal.id, msId),
    onSuccess: () => {
      toast.success("Milestone completed");
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goalVisual", goal.id] });
    },
  });

  const breakdownMut = useMutation({ mutationFn: () => aiBreakdownGoal(goal.id) });
  const resumeMut = useMutation({
    mutationFn: () => goalResumeBullet(goal.id),
    onError: () => toast.error("Couldn't draft a bullet right now"),
  });
  const importMut = useMutation({
    mutationFn: (tasks) => bulkCreateTasks(tasks.map((t) => ({ title: t.title, description: t.description, deadline: t.deadline, priority: t.priority }))),
    onSuccess: () => { toast.success("Tasks imported"); qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });

  const visual = visualQ.data;
  const chartData = (visual?.progress_over_time || []).map((p) => ({
    date: p.date.slice(5), // MM-DD
    percentage: p.percentage,
  }));

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="space-y-5 rounded-xl border border-border bg-bg-surface p-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display text-lg font-bold">{goal.title}</h2>
          {goal.description && <p className="mt-1 text-sm text-text-muted">{goal.description}</p>}
        </div>
        {visual && (
          <span className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: (visual.on_track ? "#34D399" : "#F87171") + "18", color: visual.on_track ? "#34D399" : "#F87171" }}>
            {visual.on_track ? "✓ On track" : "⚠ Behind"}
          </span>
        )}
      </div>

      {/* Progress chart */}
      {visualQ.isLoading ? (
        <CardSkeleton lines={5} />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2D3148" />
              <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} />
              <YAxis domain={[0, 100]} stroke="#94A3B8" fontSize={11} />
              <Tooltip contentStyle={{ background: "#1A1D27", border: "1px solid #2D3148", borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="percentage" stroke="#A78BFA" strokeWidth={2}
                dot={{ r: 3, fill: "#A78BFA" }} animationDuration={800} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Projected completion */}
      {visual?.projected_completion_date && (
        <p className="text-xs text-text-muted">
          Projected completion: <span className="font-mono text-accent-purple">{visual.projected_completion_date}</span>
        </p>
      )}

      {/* Progress slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Update progress</span>
          <span className="font-mono font-bold text-accent-purple">{Math.round(progressInput)}%</span>
        </div>
        <input type="range" min={0} max={100} value={progressInput}
          onChange={(e) => setProgressInput(+e.target.value)}
          className="w-full accent-accent-purple" />
        <button onClick={() => progressMut.mutate()} disabled={progressMut.isPending}
          className="w-full rounded-lg bg-accent-purple/10 py-2 text-xs font-semibold text-accent-purple hover:bg-accent-purple/20 transition disabled:opacity-50">
          {progressMut.isPending ? "Saving…" : "Save Progress"}
        </button>
      </div>

      {/* Milestones */}
      {goal.milestones?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Milestones</p>
          {goal.milestones.map((ms) => (
            <div key={ms.id} className="flex items-center gap-2">
              <button onClick={() => !ms.is_completed && milestoneMut.mutate(ms.id)}
                disabled={ms.is_completed}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${ms.is_completed ? "border-accent-green bg-accent-green" : "border-border hover:border-accent-green"}`}>
                {ms.is_completed && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="h-3 w-3"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
              <span className={`text-xs ${ms.is_completed ? "text-text-muted line-through" : "text-text-primary"}`}>{ms.title}</span>
              <span className="ml-auto font-mono text-[10px] text-text-muted">{ms.target_date}</span>
            </div>
          ))}
        </div>
      )}

      {/* AI breakdown */}
      <div>
        <button onClick={() => breakdownMut.mutate()} disabled={breakdownMut.isPending}
          className="rounded-lg bg-accent-purple/10 px-3 py-1.5 text-xs font-semibold text-accent-purple hover:bg-accent-purple/20 transition disabled:opacity-50">
          {breakdownMut.isPending ? "Thinking…" : "✨ AI Breakdown into Tasks"}
        </button>
        {breakdownMut.data && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-accent-purple">Suggested Tasks</p>
              <button onClick={() => importMut.mutate(breakdownMut.data.tasks)} disabled={importMut.isPending}
                className="rounded-md bg-accent-blue px-2 py-1 text-[10px] font-semibold text-bg-base hover:bg-accent-blue/80">
                {importMut.isPending ? "Importing…" : "Import All"}
              </button>
            </div>
            {breakdownMut.data.tasks.map((t, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-bg-elevated/50 px-3 py-2">
                <span className="font-mono text-[10px] text-accent-blue mt-0.5">{i + 1}.</span>
                <p className="flex-1 text-xs text-text-primary">{t.title}</p>
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${t.priority === "high" ? "bg-accent-red/15 text-accent-red" : t.priority === "low" ? "bg-accent-green/15 text-accent-green" : "bg-accent-amber/15 text-accent-amber"}`}>{t.priority}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resume auto-updater */}
      <div className="border-t border-border pt-4">
        <button onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending}
          className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 transition disabled:opacity-50">
          {resumeMut.isPending ? "Drafting…" : "Draft résumé bullet"}
        </button>
        {resumeMut.data && (
          <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <p className="text-sm leading-relaxed text-text-primary">{resumeMut.data.bullet}</p>
            <button onClick={() => { navigator.clipboard.writeText(resumeMut.data.bullet); toast.success("Copied"); }}
              className="mt-2 text-[11px] font-semibold text-accent hover:underline">Copy</button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function Goals() {
  const [goalType, setGoalType] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  const goalsQ = useQuery({
    queryKey: ["goals", goalType],
    queryFn: () => fetchGoals({ goal_type: goalType, status: "active" }),
  });

  const goals = goalsQ.data || [];
  const selected = goals.find((g) => g.id === selectedId) || goals[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-extrabold">Goals</h1>
        <p className="text-xs text-text-muted">Create goals from the Habits page →</p>
      </div>

      {/* Type toggle */}
      <div className="flex gap-1 rounded-xl bg-bg-surface p-1 w-fit">
        {[{ v: "all", l: "All" }, { v: "short_term", l: "Short-term" }, { v: "long_term", l: "Long-term" }].map(({ v, l }) => (
          <button key={v} onClick={() => { setGoalType(v); setSelectedId(null); }}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${goalType === v ? "bg-accent-purple text-bg-base" : "text-text-muted hover:text-text-primary"}`}>{l}</button>
        ))}
      </div>

      {goalsQ.isLoading ? (
        <CardSkeleton lines={6} />
      ) : goals.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-surface p-8 text-center text-sm text-text-muted">
          No active goals. Create one from the Habits page.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Goal list */}
          <div className="space-y-2">
            {goals.map((g) => (
              <button key={g.id} onClick={() => setSelectedId(g.id)}
                className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === g.id ? "border-accent-purple bg-accent-purple/5" : "border-border bg-bg-surface hover:bg-bg-elevated/60"}`}>
                <p className="text-sm font-medium text-text-primary truncate">{g.title}</p>
                <div className="mt-2 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${g.progress_percentage}%`, background: TRACK_COLORS[g.on_track_status] || "#A78BFA" }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px]">
                  <span className="font-mono text-text-muted">{Math.round(g.progress_percentage)}%</span>
                  <span style={{ color: TRACK_COLORS[g.on_track_status] }}>{trackLabel(g.on_track_status)} · {g.days_remaining}d</span>
                </div>
              </button>
            ))}
          </div>

          {/* Visual panel */}
          {selected && <GoalVisual key={selected.id} goal={selected} />}
        </div>
      )}
    </div>
  );
}
