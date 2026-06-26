import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { fetchFocusSuggestion } from "../lib/queries";

function loadSettings() {
  try {
    const raw = localStorage.getItem("focus_settings");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { work: 25, break: 5 };
}

function saveSettings(s) {
  localStorage.setItem("focus_settings", JSON.stringify(s));
}

function fmt(s) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

const PRESETS = [
  { label: "25/5", work: 25, break: 5 },
  { label: "50/10", work: 50, break: 10 },
  { label: "90/20", work: 90, break: 20 },
];

export default function Focus() {
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [customWork, setCustomWork] = useState(settings.work);
  const [customBreak, setCustomBreak] = useState(settings.break);

  const workSecs = settings.work * 60;
  const breakSecs = settings.break * 60;

  const [mode, setMode] = useState("work");
  const [remaining, setRemaining] = useState(workSecs);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const intervalRef = useRef(null);

  const focusQ = useQuery({ queryKey: ["focusSuggestion"], queryFn: fetchFocusSuggestion });

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          const nextMode = mode === "work" ? "break" : "work";
          if (mode === "work") setRounds((x) => x + 1);
          toast.success(mode === "work" ? "Session done — take a break" : "Break over — back to it");
          setMode(nextMode);
          return nextMode === "work" ? workSecs : breakSecs;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, mode, workSecs, breakSecs]);

  const total = mode === "work" ? workSecs : breakSecs;
  const progress = 1 - remaining / total;
  const R = 130;
  const C = 2 * Math.PI * R;

  const reset = () => { setRunning(false); setRemaining(mode === "work" ? workSecs : breakSecs); };

  const applySettings = (w, b) => {
    const next = { work: w, break: b };
    setSettings(next);
    saveSettings(next);
    setRunning(false);
    setMode("work");
    setRemaining(w * 60);
    setShowSettings(false);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Focus</h1>
          <p className="mt-1 text-sm text-text-muted">{settings.work}-minute sprints. One thing at a time.</p>
        </div>
        <button onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition hover:text-text-primary hover:bg-bg-elevated">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
            <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Timer settings
        </button>
      </div>

      {/* Settings panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <div className="mt-4 rounded-xl border border-border bg-bg-surface p-5 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Presets</p>
              <div className="flex gap-2">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => { setCustomWork(p.work); setCustomBreak(p.break); applySettings(p.work, p.break); }}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${settings.work === p.work && settings.break === p.break ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted hover:text-text-primary"}`}>
                    {p.label}
                  </button>
                ))}
              </div>

              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Custom (minutes)</p>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  Work
                  <input type="number" min={1} max={180} value={customWork} onChange={(e) => setCustomWork(Number(e.target.value) || 1)}
                    className="w-20 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-center text-sm font-mono text-text-primary focus:border-accent focus:outline-none" />
                </label>
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  Break
                  <input type="number" min={1} max={60} value={customBreak} onChange={(e) => setCustomBreak(Number(e.target.value) || 1)}
                    className="w-20 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-center text-sm font-mono text-text-primary focus:border-accent focus:outline-none" />
                </label>
                <button onClick={() => applySettings(customWork, customBreak)}
                  className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-text-onaccent transition hover:opacity-90">
                  Apply
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI context */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">This session, focus on</p>
        {focusQ.isLoading ? (
          <p className="mt-2 text-sm text-text-muted">Thinking...</p>
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
            className="rounded-xl bg-accent px-8 py-3 text-lg font-bold text-text-onaccent hover:brightness-105">
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
