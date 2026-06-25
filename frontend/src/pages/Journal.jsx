import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  fetchJournalEntries, fetchJournalEntry, upsertJournalEntry, summarizeDay, fetchWeeklyWrapped,
} from "../lib/queries";
import { CardSkeleton } from "../components/Skeleton";

const MOODS = ["😄", "🙂", "😐", "😟", "😫"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Weekly Wrapped modal                                               */
/* ------------------------------------------------------------------ */

function WrappedModal({ open, onClose }) {
  const wrappedQ = useQuery({
    queryKey: ["weeklyWrapped"],
    queryFn: fetchWeeklyWrapped,
    enabled: open,
  });

  if (!open) return null;
  const w = wrappedQ.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-accent-purple/20 via-bg-surface to-accent-blue/10 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold uppercase tracking-widest text-accent-purple">Your Week, Wrapped</span>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">✕</button>
        </div>

        {wrappedQ.isLoading ? (
          <CardSkeleton lines={5} />
        ) : w ? (
          <div className="space-y-5">
            <h2 className="font-display text-2xl font-extrabold leading-tight">{w.headline}</h2>
            <p className="text-sm text-text-muted leading-relaxed">{w.summary}</p>

            <div className="grid grid-cols-2 gap-3">
              {w.stats.map((s, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                  className="rounded-2xl bg-bg-surface/80 p-4 text-center backdrop-blur">
                  <p className="font-mono text-3xl font-extrabold text-accent-purple">{s.value}</p>
                  <p className="mt-1 text-[11px] text-text-muted">{s.label}</p>
                </motion.div>
              ))}
            </div>

            {w.highlights?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Highlights</p>
                {w.highlights.map((h, i) => (
                  <p key={i} className="text-sm text-text-primary">✨ {h}</p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-muted">Couldn't load your wrapped.</p>
        )}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function Journal() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [content, setContent] = useState("");
  const [mood, setMood] = useState(null);
  const [showWrapped, setShowWrapped] = useState(false);

  const entryQ = useQuery({ queryKey: ["journal", date], queryFn: () => fetchJournalEntry(date) });
  const listQ = useQuery({ queryKey: ["journalList"], queryFn: () => fetchJournalEntries(30) });

  // Sync local editor when the selected entry loads
  useEffect(() => {
    if (entryQ.data) {
      setContent(entryQ.data.content || "");
      setMood(entryQ.data.mood || null);
    }
  }, [entryQ.data]);

  const saveMut = useMutation({
    mutationFn: () => upsertJournalEntry(date, content, mood),
    onSuccess: () => {
      toast.success("Journal saved");
      qc.invalidateQueries({ queryKey: ["journal", date] });
      qc.invalidateQueries({ queryKey: ["journalList"] });
    },
  });

  const summarizeMut = useMutation({
    mutationFn: () => summarizeDay(date),
    onSuccess: (data) => {
      toast.success("AI summary ready");
      qc.setQueryData(["journal", date], data);
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || "AI summary unavailable";
      toast.error(msg);
    },
  });

  const aiSummary = entryQ.data?.ai_summary;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-extrabold">Journal</h1>
        <button onClick={() => setShowWrapped(true)}
          className="rounded-lg bg-gradient-to-r from-accent-purple to-accent-blue px-4 py-2 text-xs font-semibold text-bg-base shadow hover:opacity-90 transition">
          ✨ Weekly Wrapped
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* Editor */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary focus:outline-none" />
            <div className="flex gap-1">
              {MOODS.map((m) => (
                <button key={m} onClick={() => setMood(m)}
                  className={`h-8 w-8 rounded-lg text-lg transition ${mood === m ? "bg-accent-purple/20 scale-110" : "hover:bg-bg-elevated"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <textarea value={content} onChange={(e) => setContent(e.target.value)}
            placeholder="What did you do today? What's on your mind?"
            rows={12}
            className="w-full resize-none rounded-xl border border-border bg-bg-surface p-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple focus:outline-none leading-relaxed" />

          <div className="flex gap-2">
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
              className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-bg-base hover:opacity-90 transition disabled:opacity-50">
              {saveMut.isPending ? "Saving…" : "Save Entry"}
            </button>
            <button onClick={() => summarizeMut.mutate()} disabled={summarizeMut.isPending}
              className="rounded-lg bg-accent-purple/15 px-4 py-2 text-sm font-semibold text-accent-purple hover:bg-accent-purple/25 transition disabled:opacity-50">
              {summarizeMut.isPending ? "Thinking…" : "✨ Summarize my day with AI"}
            </button>
          </div>

          {/* AI summary card */}
          <AnimatePresence>
            {aiSummary && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-accent-purple/30 bg-accent-purple/5 p-4">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent-purple">AI Reflection</p>
                <p className="text-sm text-text-primary leading-relaxed">{aiSummary}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Past entries */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Recent entries</p>
          {listQ.isLoading ? (
            <CardSkeleton lines={4} />
          ) : (listQ.data || []).length === 0 ? (
            <p className="text-sm text-text-muted">No entries yet.</p>
          ) : (
            <div className="space-y-2">
              {listQ.data.map((e) => (
                <button key={e.id} onClick={() => setDate(e.entry_date)}
                  className={`w-full rounded-lg border p-3 text-left transition ${date === e.entry_date ? "border-accent-purple bg-accent-purple/5" : "border-border bg-bg-surface hover:bg-bg-elevated/60"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-text-muted">{e.entry_date}</span>
                    {e.mood && <span>{e.mood}</span>}
                  </div>
                  <p className="mt-1 text-xs text-text-primary line-clamp-2">{e.content || "(empty)"}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <WrappedModal open={showWrapped} onClose={() => setShowWrapped(false)} />
    </div>
  );
}
