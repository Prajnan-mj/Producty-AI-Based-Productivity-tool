import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { fetchMoodToday, submitMood } from "../lib/queries";

const LEVELS = [
  { v: 1, label: "Drained" },
  { v: 2, label: "Low" },
  { v: 3, label: "OK" },
  { v: 4, label: "Good" },
  { v: 5, label: "Charged" },
];

export default function MoodCheckin() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["moodToday"], queryFn: fetchMoodToday });

  const mut = useMutation({
    mutationFn: submitMood,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["moodToday"] }); },
  });

  const energy = data?.energy ?? null;

  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Energy today</p>

      <div className="mt-3 flex gap-2">
        {LEVELS.map((l) => (
          <button key={l.v} onClick={() => mut.mutate(l.v)}
            title={l.label}
            className={`flex h-10 flex-1 flex-col items-center justify-center rounded-lg text-xs font-bold transition ${
              energy === l.v ? "bg-accent text-text-onaccent" : "bg-bg-elevated text-text-muted hover:text-text-primary"
            }`}>
            {l.v}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {data?.message && (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className="mt-3 text-sm leading-relaxed text-text-primary">{data.message}</motion.p>
        )}
      </AnimatePresence>

      {data?.focus?.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">Suggested order</p>
          {data.focus.map((t, i) => (
            <p key={i} className="flex gap-2 text-xs text-text-primary"><span className="font-mono text-text-muted">{i + 1}.</span>{t}</p>
          ))}
        </div>
      )}
    </div>
  );
}
