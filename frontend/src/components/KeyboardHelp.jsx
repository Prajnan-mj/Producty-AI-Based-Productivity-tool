import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const SHORTCUTS = [
  { keys: ["Ctrl/⌘", "K"], label: "Open the command palette" },
  { keys: ["?"], label: "Show this shortcuts panel" },
  { keys: ["Esc"], label: "Close any panel or palette" },
  { keys: ["/"], label: "Block menu inside a note" },
  { keys: ["Ctrl/⌘", "B"], label: "Bold (in a note)" },
  { keys: ["Ctrl/⌘", "I"], label: "Italic (in a note)" },
];

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export default function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "?" && !isTyping(document.activeElement)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.14 }}
            className="w-full max-w-sm rounded-2xl border border-border bg-bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg text-text-primary">Keyboard shortcuts</h2>
            <div className="mt-4 space-y-2.5">
              {SHORTCUTS.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-text-primary/80">{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k) => (
                      <kbd key={k} className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-[11px] text-text-muted">{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-center text-[11px] text-text-muted">Press <kbd className="rounded border border-border px-1 py-0.5">Esc</kbd> to close</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
