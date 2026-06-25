import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { fetchTasks, createTask, updateTask, deleteTask, markTaskDone, importFromGmail, aiPrioritize, breakdownTask } from "../lib/queries";
import Confetti from "../components/Confetti";
import ProcrastinationAlert from "../components/ProcrastinationAlert";
import { CardSkeleton } from "../components/Skeleton";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const PRI_COLORS = {
  high: "bg-accent-red/15 text-accent-red",
  medium: "bg-accent-amber/15 text-accent-amber",
  low: "bg-accent-green/15 text-accent-green",
};

const SOURCE_TAGS = { gmail: "Gmail", voice: "Voice", document: "Doc", manual: "" };

/**
 * Deadline-based urgency bucket:
 *   overdue → red, due today → yellow, future/none → blue
 */
function urgencyOf(task) {
  if (!task.deadline) return "none";
  const now = new Date();
  const dl = new Date(task.deadline);
  if (dl < now) return "overdue";
  const isToday = dl.toDateString() === now.toDateString();
  return isToday ? "today" : "future";
}

const URGENCY_BORDER = {
  overdue: "border-l-accent-red",
  today: "border-l-accent-amber",
  future: "border-l-accent-blue",
  none: "border-l-border",
};

const URGENCY_TEXT = {
  overdue: "text-accent-red",
  today: "text-accent-amber",
  future: "text-accent-blue",
  none: "text-text-muted",
};

function countdown(deadline) {
  if (!deadline) return null;
  const ms = new Date(deadline) - Date.now();
  if (ms < 0) {
    const d = Math.ceil(-ms / 86400000);
    return d <= 1 ? "overdue" : `${d}d overdue`;
  }
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "< 1h left";
  if (h < 24) return `${h}h left`;
  return `${Math.ceil(h / 24)}d left`;
}

/* ------------------------------------------------------------------ */
/* Sortable task card                                                  */
/* ------------------------------------------------------------------ */

function SortableTaskCard({ task, onDone, onDelete }) {
  const qc = useQueryClient();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const done = task.status === "done";
  const [expanded, setExpanded] = useState(false);
  const [breakdown, setBreakdown] = useState(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);

  const urgency = urgencyOf(task);

  const handleDone = (e) => {
    e.stopPropagation();
    if (done) {
      updateTask(task.id, { status: "pending" }).then(() => qc.invalidateQueries({ queryKey: ["tasks"] }));
    } else {
      onDone(task.id);
    }
  };

  const handleExpand = () => {
    if (!expanded && !breakdown && !loadingBreakdown) {
      setLoadingBreakdown(true);
      breakdownTask(task.id)
        .then((d) => setBreakdown(d))
        .catch(() => setBreakdown({ summary: "Could not generate breakdown.", subtasks: [] }))
        .finally(() => setLoadingBreakdown(false));
    }
    setExpanded(!expanded);
  };

  const toggleSubtask = (subId, currentStatus) => {
    const next = currentStatus === "done" ? "pending" : "done";
    updateTask(subId, { status: next }).then(() => {
      setBreakdown((prev) => prev && ({
        ...prev,
        subtasks: prev.subtasks.map((s) => s.id === subId ? { ...s, status: next } : s),
      }));
      qc.invalidateQueries({ queryKey: ["tasks"] });
    });
  };

  return (
    <motion.div ref={setNodeRef} style={style} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className={`group rounded-xl border border-l-4 ${URGENCY_BORDER[urgency]} border-border bg-bg-surface transition ${done ? "opacity-60" : ""}`}>

      <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={handleExpand}>
        {/* Drag handle */}
        <div {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} className="mt-1 cursor-grab text-text-muted/40 hover:text-text-muted touch-none">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </div>

        {/* Check/uncheck button */}
        <button onClick={handleDone}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${done ? "border-accent bg-accent" : "border-border hover:border-accent"}`}>
          {done && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-3 w-3 text-text-onaccent"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium text-text-primary ${done ? "line-through text-text-muted" : ""}`}>{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${PRI_COLORS[task.priority] || PRI_COLORS.medium}`}>
              {task.priority}
            </span>
            {task.deadline && <span className={`font-mono text-[11px] ${URGENCY_TEXT[urgency]}`}>{countdown(task.deadline)}</span>}
            {task.source !== "manual" && SOURCE_TAGS[task.source] && (
              <span className="rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">{SOURCE_TAGS[task.source]}</span>
            )}
          </div>
        </div>

        {/* Expand arrow */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
          <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Delete */}
        <button onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          className="mt-1 text-text-muted/40 opacity-0 group-hover:opacity-100 hover:text-accent-red transition">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Expanded: AI summary + subtasks */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border"
          >
            <div className="space-y-3 px-4 py-4 pl-12">
              {loadingBreakdown && (
                <p className="text-xs text-text-muted animate-pulse">AI is breaking this down...</p>
              )}

              {breakdown && (
                <>
                  {/* AI summary */}
                  <div className="flex items-start gap-2 rounded-lg border-l-2 border-accent bg-accent/5 p-3">
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-accent">AI</span>
                    <p className="text-sm leading-relaxed text-text-muted">{breakdown.summary}</p>
                  </div>

                  {/* Subtasks */}
                  {breakdown.subtasks.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Subtasks</p>
                      {breakdown.subtasks.map((sub) => {
                        const subDone = sub.status === "done";
                        return (
                          <div key={sub.id} className="flex items-start gap-3 rounded-lg bg-bg-elevated/50 px-3 py-2.5">
                            <button onClick={() => toggleSubtask(sub.id, sub.status)}
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${subDone ? "border-accent bg-accent" : "border-border hover:border-accent"}`}>
                              {subDone && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} className="h-2.5 w-2.5 text-text-onaccent">
                                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm ${subDone ? "line-through text-text-muted" : "text-text-primary"}`}>{sub.title}</p>
                              {sub.description && <p className="mt-0.5 text-xs text-text-muted">{sub.description}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* AI suggestions panel                                                */
/* ------------------------------------------------------------------ */

function AiPanel({ data, onApply, onApplyAll, onClose }) {
  if (!data) return null;
  return (
    <motion.div initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 300, opacity: 0 }}
      className="fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-border bg-bg-surface shadow-xl lg:static lg:h-auto lg:rounded-xl lg:border">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-display text-sm font-bold text-accent">AI Priorities</h3>
        <div className="flex gap-2">
          <button onClick={onApplyAll} className="rounded-md bg-accent-purple px-2 py-1 text-[10px] font-semibold text-bg-base hover:bg-accent-purple/80">Apply All</button>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">✕</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {data.suggestions?.map((s) => (
          <div key={s.task_id} className="rounded-lg bg-bg-elevated p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
                {s.priority_score >= 70 ? "Do first" : s.priority_score >= 40 ? "Then" : "Later"}
              </span>
              <button onClick={() => onApply(s)}
                className="rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/20">Apply</button>
            </div>
            <p className="text-xs text-text-primary">{s.title}</p>
            <p className="text-[11px] text-text-muted leading-relaxed">{s.reasoning}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Quick-add modal                                                     */
/* ------------------------------------------------------------------ */

function QuickAddModal({ open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", deadline: "", priority: "medium" });

  const mut = useMutation({
    mutationFn: createTask,
    onSuccess: () => { toast.success("Task created"); qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); setForm({ title: "", deadline: "", priority: "medium" }); },
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl border border-border bg-bg-surface p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold">Quick Add Task</h2>
        <input placeholder="What needs to be done?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none" autoFocus />
        <div className="flex gap-3">
          <input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:outline-none" />
          <div className="flex gap-1">
            {["high", "medium", "low"].map((p) => (
              <button key={p} onClick={() => setForm({ ...form, priority: p })}
                className={`rounded-lg px-3 py-2 text-[11px] font-semibold capitalize transition ${form.priority === p ? PRI_COLORS[p].replace("/15", "") + " bg-opacity-100" : "bg-bg-elevated text-text-muted"}`}
                style={form.priority === p ? {} : undefined}>{p[0].toUpperCase()}</button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-muted">Cancel</button>
          <button onClick={() => mut.mutate({ ...form, deadline: form.deadline ? new Date(form.deadline).toISOString() : null })}
            disabled={!form.title || mut.isPending}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-bg-base hover:bg-accent-blue/80 transition disabled:opacity-50">
            {mut.isPending ? "Adding…" : "Add Task"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline task creator                                                 */
/* ------------------------------------------------------------------ */

function InlineAdd() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [urgent, setUrgent] = useState(false);

  const mut = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      toast.success("Task added");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setTitle(""); setDeadline(""); setUrgent(false);
    },
  });

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    mut.mutate({
      title: title.trim(),
      priority: urgent ? "high" : "medium",
      deadline: deadline ? new Date(deadline).toISOString() : null,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-bg-surface p-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Type a new task…"
        className="flex-1 min-w-[140px] bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none" />
      <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
        className="rounded-lg bg-bg-elevated px-2 py-1 text-[11px] text-text-primary focus:outline-none" />
      <button type="button" onClick={() => setUrgent(!urgent)}
        className={`rounded-lg px-3 py-1 text-[11px] font-semibold transition ${urgent ? "bg-accent-red text-white" : "bg-bg-elevated text-text-muted"}`}>
        {urgent ? "Urgent" : "Not urgent"}
      </button>
      <button type="submit" disabled={!title.trim() || mut.isPending}
        className="rounded-lg bg-accent-blue/10 px-3 py-1 text-xs font-semibold text-accent-blue hover:bg-accent-blue/20 disabled:opacity-50">Add</button>
    </form>
  );
}

function ColorLegend() {
  return (
    <div className="flex items-center gap-4 text-[11px] text-text-muted">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent-red" /> Overdue</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent-amber" /> Due today</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent-blue" /> Upcoming</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Tasks() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState({ status: "", priority: "", sort_by: "created" });
  const [showAi, setShowAi] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [items, setItems] = useState(null);

  const tasksQ = useQuery({
    queryKey: ["tasks", filter],
    queryFn: () => fetchTasks({ ...filter, limit: 50, offset: 0 }),
    onSuccess: (data) => { if (!items) setItems(data.items.map((t) => t.id)); },
  });

  // Keep item order in sync, preserving user reorder
  const taskItems = tasksQ.data?.items || [];
  const orderedTasks = items
    ? items.map((id) => taskItems.find((t) => t.id === id)).filter(Boolean)
    : taskItems;

  // Counts
  const pending = taskItems.filter((t) => t.status === "pending").length;
  const inProg = taskItems.filter((t) => t.status === "in_progress").length;
  const done = taskItems.filter((t) => t.status === "done").length;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const ids = prev || taskItems.map((t) => t.id);
      const oldIdx = ids.indexOf(active.id);
      const newIdx = ids.indexOf(over.id);
      return arrayMove(ids, oldIdx, newIdx);
    });
  }

  const doneMut = useMutation({ mutationFn: markTaskDone, onSuccess: () => { toast.success("Marked done"); qc.invalidateQueries({ queryKey: ["tasks"] }); } });
  const delMut = useMutation({ mutationFn: deleteTask, onSuccess: () => { toast.success("Task deleted"); qc.invalidateQueries({ queryKey: ["tasks"] }); } });
  const gmailMut = useMutation({ mutationFn: () => importFromGmail(20), onSuccess: (d) => { toast.success(`${d.length} tasks imported from Gmail`); qc.invalidateQueries({ queryKey: ["tasks"] }); } });

  const priMut = useMutation({
    mutationFn: aiPrioritize,
    onSuccess: (d) => { setShowAi(true); priMut.data = d; },
  });

  const applyOne = (s) => {
    const pri = s.priority_score >= 70 ? "high" : s.priority_score >= 40 ? "medium" : "low";
    updateTask(s.task_id, { priority: pri }).then(() => { toast.success("Priority applied"); qc.invalidateQueries({ queryKey: ["tasks"] }); });
  };

  const applyAll = () => {
    const suggestions = priMut.data?.suggestions || [];
    Promise.all(suggestions.map((s) => {
      const pri = s.priority_score >= 70 ? "high" : s.priority_score >= 40 ? "medium" : "low";
      return updateTask(s.task_id, { priority: pri });
    })).then(() => { toast.success("All priorities applied"); qc.invalidateQueries({ queryKey: ["tasks"] }); setShowAi(false); });
  };

  return (
    <div className="flex">
      <div className="flex-1 mx-auto max-w-4xl px-4 py-6 lg:px-8 space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl font-extrabold">Tasks</h1>
          <div className="flex gap-2">
            <button onClick={() => gmailMut.mutate()} disabled={gmailMut.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-bg-surface border border-border px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition disabled:opacity-50">
              {gmailMut.isPending ? "Scanning…" : "Import Gmail"}
            </button>
            <button onClick={() => priMut.mutate()} disabled={priMut.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 transition disabled:opacity-50">
              {priMut.isPending ? "Thinking…" : "AI Prioritize"}
            </button>
          </div>
        </div>

        {/* Procrastination nudges */}
        <ProcrastinationAlert />

        {/* Count badges */}
        <div className="flex gap-2">
          {[
            { label: "Pending", val: pending, cls: "text-accent-amber bg-accent-amber/10" },
            { label: "In Progress", val: inProg, cls: "text-accent-blue bg-accent-blue/10" },
            { label: "Done", val: done, cls: "text-accent-green bg-accent-green/10" },
          ].map(({ label, val, cls }) => (
            <span key={label} className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{val} {label}</span>
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 rounded-xl bg-bg-surface p-2">
          <select value={filter.priority} onChange={(e) => { setFilter({ ...filter, priority: e.target.value }); setItems(null); }}
            className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-primary focus:outline-none">
            <option value="">All priorities</option>
            <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
          <select value={filter.status} onChange={(e) => { setFilter({ ...filter, status: e.target.value }); setItems(null); }}
            className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-primary focus:outline-none">
            <option value="">All statuses</option>
            <option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="done">Done</option>
          </select>
          <select value={filter.sort_by} onChange={(e) => { setFilter({ ...filter, sort_by: e.target.value }); setItems(null); }}
            className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-primary focus:outline-none">
            <option value="created">Newest</option><option value="deadline">Deadline</option><option value="priority">Priority</option>
          </select>
          <div className="ml-auto"><ColorLegend /></div>
        </div>

        {/* Task list */}
        {tasksQ.isLoading ? (
          <div className="space-y-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
        ) : orderedTasks.length === 0 ? (
          <div className="rounded-xl border border-border bg-bg-surface p-10 text-center">
            <p className="text-sm font-semibold text-text-primary">No tasks yet</p>
            <p className="mt-1 text-sm text-text-muted">Add one with voice, or type below.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <AnimatePresence>
                <div className="space-y-2">
                  {orderedTasks.map((t) => (
                    <SortableTaskCard key={t.id} task={t}
                      onDone={(id) => doneMut.mutate(id)}
                      onDelete={(id) => delMut.mutate(id)} />
                  ))}
                </div>
              </AnimatePresence>
            </SortableContext>
          </DndContext>
        )}

        {/* Inline add */}
        <InlineAdd />

        {/* Add task — bottom-right (voice lives bottom-left, app-wide) */}
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowModal(true)}
          className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-text-onaccent shadow-lg transition hover:brightness-105">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-6 w-6">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </motion.button>

        <QuickAddModal open={showModal} onClose={() => setShowModal(false)} />
      </div>

      {/* AI panel */}
      <AnimatePresence>
        {showAi && <AiPanel data={priMut.data} onApply={applyOne} onApplyAll={applyAll} onClose={() => setShowAi(false)} />}
      </AnimatePresence>
    </div>
  );
}
