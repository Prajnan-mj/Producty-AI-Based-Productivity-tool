import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { fetchProcrastination, breakIntoChunks } from "../lib/queries";

export default function ProcrastinationAlert() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["procrastination"], queryFn: fetchProcrastination });

  const chunkMut = useMutation({
    mutationFn: breakIntoChunks,
    onSuccess: (r) => { toast.success(`Broke it into ${r.created.length} small steps`); qc.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: () => toast.error("Couldn't break it down right now"),
  });

  const items = data || [];
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.task_id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col gap-2 rounded-xl border border-accent-red/30 bg-accent-red/5 px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-sm text-text-primary">
                You've snoozed <span className="font-semibold">“{t.title}”</span> {t.snooze_count} times.
                {t.hours_left != null && t.hours_left >= 0 && <> It's <span className="text-accent-red font-semibold">{t.hours_left}h</span> away.</>}
                {t.hours_left != null && t.hours_left < 0 && <span className="text-accent-red font-semibold"> It's overdue.</span>}
              </p>
            </div>
            <button onClick={() => chunkMut.mutate(t.task_id)} disabled={chunkMut.isPending}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-text-onaccent hover:brightness-105 disabled:opacity-50">
              {chunkMut.isPending ? "Breaking down…" : "Break into 15-min steps"}
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
