import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { createPanicPlan } from "../lib/queries";

const VERDICT_STYLE = {
  do: "bg-accent/15 text-accent",
  defer: "bg-bg-elevated text-text-muted",
  drop: "bg-accent-red/15 text-accent-red line-through",
};

export function PanicPlanView({ plan }) {
  return (
    <div className="space-y-5">
      <p className="font-display text-xl text-accent-red">{plan.headline}</p>

      {plan.triage?.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Triage</p>
          <div className="space-y-1.5">
            {plan.triage.map((t, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-bg-surface px-3 py-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${VERDICT_STYLE[t.verdict] || VERDICT_STYLE.do}`}>{t.verdict}</span>
                <span className="flex-1 text-sm text-text-primary">{t.item}</span>
                <span className="hidden text-[11px] text-text-muted sm:block">{t.why}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.schedule?.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Survival schedule</p>
          <div className="space-y-1.5">
            {plan.schedule.map((s, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border-l-2 border-accent bg-bg-surface px-3 py-2">
                <span className="w-24 shrink-0 font-mono text-xs text-accent">{s.time}</span>
                <span className="flex-1 text-sm text-text-primary">{s.action}</span>
                {s.minutes ? <span className="font-mono text-[11px] text-text-muted">{s.minutes}m</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.pep_talk && (
        <p className="rounded-xl bg-accent/5 px-4 py-3 text-sm italic text-text-primary">{plan.pep_talk}</p>
      )}
    </div>
  );
}

export default function PanicButton({ className = "" }) {
  const [open, setOpen] = useState(false);
  const mut = useMutation({
    mutationFn: createPanicPlan,
    onSuccess: () => setOpen(true),
    onError: () => toast.error("Couldn't build a plan — try again"),
  });

  const plan = mut.data;
  const shareUrl = plan ? `${window.location.origin}/share/panic/${plan.share_token}` : "";

  return (
    <>
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending}
        style={{ animation: mut.isPending ? "none" : "panic-pulse 2.4s infinite" }}
        className={`flex items-center justify-center gap-2 rounded-2xl bg-accent-red px-6 py-4 font-display text-lg text-white shadow-lg transition hover:brightness-110 disabled:opacity-70 ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
          <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {mut.isPending ? "Building your plan…" : "Panic Mode"}
      </button>

      <AnimatePresence>
        {open && plan && (
          <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={() => setOpen(false)}>
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
              className="my-8 w-full max-w-2xl rounded-2xl border border-accent-red/30 bg-bg-base p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-red">Panic Mode · next 48h</span>
                <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary">✕</button>
              </div>

              <PanicPlanView plan={plan} />

              <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
                <input readOnly value={shareUrl}
                  className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted" />
                <button onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Share link copied"); }}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-text-onaccent hover:brightness-105">
                  Copy share link
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
