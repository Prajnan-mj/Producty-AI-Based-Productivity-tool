import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { useVoice } from "../hooks/useVoice";
import { parseVoice, executeVoice } from "../lib/queries";

const ACTION_LABELS = {
  create_task: "New task",
  add_bill: "New bill",
  set_meeting: "New meeting",
  add_habit: "New habit",
  set_deadline: "Set deadline",
  create_note: "New note",
  panic_triage: "Panic rescue",
  unknown: "Unknown",
};

/**
 * The single global voice control. Fixed bottom-right, yellow.
 * Works on every page — speak a command and it parses + executes
 * (tasks, bills, meetings, habits, deadlines, notes).
 */
export default function FloatingVoiceButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [textInput, setTextInput] = useState("");
  const parseMutRef = useRef(null);

  const parseMut = useMutation({
    mutationFn: parseVoice,
    onSuccess: (data) => setParsed(data),
    onError: () => toast.error("Couldn't understand that"),
  });
  parseMutRef.current = parseMut;

  const executeMut = useMutation({
    mutationFn: ({ action, data }) => executeVoice(action, data, true),
    onSuccess: (data) => {
      toast.success(data.message || "Done");
      reset();
      ["tasks", "habits", "bills", "urgentTasks", "habitsSummary", "meetings", "notes", "folders"].forEach(
        (k) => qc.invalidateQueries({ queryKey: [k] })
      );
    },
    onError: () => toast.error("Failed to run that command"),
  });

  const handleResult = ({ transcript }) => {
    setFinalText(transcript);
    parseMutRef.current?.mutate(transcript);
  };

  const { isListening, transcript, error, startListening, stopListening } = useVoice({
    onResult: handleResult,
  });

  const reset = () => {
    setParsed(null);
    setFinalText("");
    setTextInput("");
  };

  const toggleMic = () => {
    if (isListening) {
      stopListening();
    } else {
      reset();
      setOpen(true);
      startListening();
    }
  };

  // Let the command palette (Ctrl/Cmd+K → "Voice command") trigger the mic.
  useEffect(() => {
    const start = () => { if (!isListening) { reset(); setOpen(true); startListening(); } };
    window.addEventListener("producty:start-voice", start);
    return () => window.removeEventListener("producty:start-voice", start);
  }, [isListening, startListening]);

  const submitText = () => {
    const t = textInput.trim();
    if (!t) return;
    setFinalText(t);
    setTextInput("");
    parseMut.mutate(t);
  };

  const liveText = isListening ? transcript : finalText;
  const showPanel = open && (liveText || parsed || parseMut.isPending || error || true);

  return (
    <div className="relative flex flex-col items-start gap-3">
      {/* Pop-up panel above the button */}
      <AnimatePresence>
        {open && (parsed || parseMut.isPending || liveText || error) && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-border bg-bg-surface p-4 shadow-2xl z-[60]"
          >
            {/* Parsing */}
            {parseMut.isPending && (
              <div className="flex items-center gap-2 text-xs text-accent">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                Understanding…
              </div>
            )}

            {/* Live transcript */}
            {!parsed && !parseMut.isPending && liveText && (
              <p className="text-sm text-text-primary">
                {isListening && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-accent-red" />}
                {liveText}
              </p>
            )}

            {/* Error */}
            {!parsed && !parseMut.isPending && !liveText && error && (
              <p className="text-xs text-accent-red">{error}</p>
            )}

            {/* Parsed confirmation */}
            {parsed && parsed.action !== "unknown" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-onaccent">
                    {ACTION_LABELS[parsed.action] || parsed.action}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">{Math.round((parsed.confidence || 0) * 100)}%</span>
                </div>
                <p className="text-sm leading-relaxed text-text-primary">{parsed.confirmation_message}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => executeMut.mutate({ action: parsed.action, data: parsed.extracted_data })}
                    disabled={executeMut.isPending}
                    className="flex-1 rounded-lg bg-accent py-2 text-xs font-bold text-text-onaccent transition hover:opacity-90 disabled:opacity-50"
                  >
                    {executeMut.isPending ? "Running…" : "Confirm"}
                  </button>
                  <button onClick={reset} className="rounded-lg bg-bg-elevated px-3 py-2 text-xs font-semibold text-text-muted hover:text-text-primary">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {parsed && parsed.action === "unknown" && (
              <p className="text-xs text-text-muted">
                Didn't catch a command. Try “add a task to submit the report by Friday”.
              </p>
            )}

            {/* Always-available text fallback */}
            {!parsed && !parseMut.isPending && (
              <form onSubmit={(e) => { e.preventDefault(); submitText(); }} className="mt-3 flex gap-2">
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="…or type a command"
                  className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                <button type="submit" disabled={!textInput.trim() || parseMut.isPending}
                  className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-text-onaccent disabled:opacity-50">
                  Go
                </button>
              </form>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The button itself */}
      <div className="relative flex items-center gap-2">
        <div className="relative">
          <AnimatePresence>
            {isListening && (
              <motion.span
                className="absolute inset-0 rounded-full bg-accent-red/30"
                initial={{ scale: 0.8, opacity: 0.5 }}
                animate={{ scale: 1.8, opacity: 0 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
              />
            )}
          </AnimatePresence>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={toggleMic}
            onContextMenu={(e) => { e.preventDefault(); setOpen((o) => !o); }}
            title="Voice command (right-click to open without speaking)"
            className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              isListening ? "bg-accent-red text-white" : "bg-accent text-text-onaccent hover:brightness-105"
            }`}
            aria-label={isListening ? "Stop listening" : "Start voice command"}
          >
            {isListening ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </motion.button>
        </div>

        <span className="text-xs text-text-muted">Voice command</span>

        {/* Close affordance when a panel is open but mic is idle */}
        {open && !isListening && (parsed || finalText || error) && (
          <button onClick={() => { setOpen(false); reset(); }}
            className="ml-auto rounded-full bg-bg-elevated px-2 py-1 text-[10px] text-text-muted hover:text-text-primary">
            close
          </button>
        )}
      </div>
    </div>
  );
}
