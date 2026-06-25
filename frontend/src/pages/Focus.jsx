import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { fetchFocusSuggestion } from "../lib/queries";

const WORK = 25 * 60;
const BREAK = 5 * 60;

function fmt(s) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export default function Focus() {
  const [mode, setMode] = useState("work"); // work | break
  const [remaining, setRemaining] = useState(WORK);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const intervalRef = useRef(null);

  const focusQ = useQuery({ queryKey: ["focusSuggestion"], queryFn: fetchFocusSuggestion });

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          // session complete — flip mode
          const nextMode = mode === "work" ? "break" : "work";
          if (mode === "work") setRounds((x) => x + 1);
          toast.success(mode === "work" ? "Session done — take a break" : "Break over — back to it");
          setMode(nextMode);
          return nextMode === "work" ? WORK : BREAK;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, mode]);

  const total = mode === "work" ? WORK : BREAK;
  const progress = 1 - remaining / total;
  const R = 130;
  const C = 2 * Math.PI * R;

  const reset = () => { setRunning(false); setRemaining(mode === "work" ? WORK : BREAK); };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 lg:px-8">
      <h1 className="font-display text-2xl text-text-primary">Focus</h1>
      <p className="mt-1 text-sm text-text-muted">25-minute sprints. One thing at a time.</p>

      {/* AI context for this session */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">This session, focus on</p>
        {focusQ.isLoading ? (
          <p className="mt-2 text-sm text-text-muted">Thinking…</p>
        ) : (
          <p className="mt-2 text-base leading-relaxed text-text-primary">{focusQ.data?.message}</p>
        )}
      </motion.div>

      {/* Timer */}
      <div className="mt-10 flex flex-col items-center">
        <div className="relative flex items-center justify-center">
          <svg width="300" height="300" className="-rotate-90">
            <circle cx="150" cy="150" r={R} fill="none" stroke="var(--bg-elevated)" strokeWidth="10" />
            <circle cx="150" cy="150" r={R} fill="none"
              stroke={mode === "work" ? "var(--accent)" : "#6F7D55"} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - progress)}
              style={{ transition: "stroke-dashoffset 1s linear" }} />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="font-mono text-5xl font-bold text-text-primary">{fmt(remaining)}</span>
            <span className="mt-1 text-xs uppercase tracking-wider text-text-muted">{mode === "work" ? "Focus" : "Break"}</span>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3">
          <button onClick={() => setRunning((r) => !r)}
            className="rounded-xl bg-accent px-8 py-3 font-display text-lg text-text-onaccent hover:brightness-105">
            {running ? "Pause" : "Start"}
          </button>
          <button onClick={reset}
            className="rounded-xl bg-bg-elevated px-5 py-3 text-sm font-semibold text-text-muted hover:text-text-primary">
            Reset
          </button>
          <button onClick={() => focusQ.refetch()}
            className="rounded-xl bg-bg-elevated px-5 py-3 text-sm font-semibold text-text-muted hover:text-text-primary">
            New focus
          </button>
        </div>

        <p className="mt-6 text-sm text-text-muted">Completed sprints today: <span className="font-mono text-accent">{rounds}</span></p>
      </div>
    </div>
  );
}
