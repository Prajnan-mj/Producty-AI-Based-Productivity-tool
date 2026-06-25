import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { noteAI } from "../../lib/queries";

function textToParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));
}

function selectedText(editor) {
  const { from, to } = editor.state.selection;
  return from === to ? "" : editor.state.doc.textBetween(from, to, " ");
}

export default function EditorAIPanel({ editor, noteId }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setShowPrompt(false); } };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const mut = useMutation({
    mutationFn: ({ action, body }) => noteAI(noteId, { action, ...body }),
    onError: () => toast.error("AI unavailable right now"),
  });

  const run = async (action, body = {}) => {
    setOpen(false);
    const t = toast.loading("Thinking…");
    try {
      const res = await mut.mutateAsync({ action, body });
      apply(action, res);
      toast.success("Done", { id: t });
    } catch {
      toast.dismiss(t);
    }
  };

  const apply = (action, res) => {
    const result = res.result || "";
    if (action === "summarize") {
      editor.chain().focus().insertContentAt(0, {
        type: "callout",
        attrs: { emoji: "💡" },
        content: [{ type: "paragraph", content: [{ type: "text", text: result }] }],
      }).run();
    } else if (action === "extract_tasks") {
      const titles = (res.inserted_tasks || []).map((t) => t.title);
      if (titles.length === 0) { toast("No action items found"); return; }
      const end = editor.state.doc.content.size;
      editor.chain().focus().insertContentAt(end, {
        type: "taskList",
        content: titles.map((title) => ({
          type: "taskItem", attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: title }] }],
        })),
      }).run();
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(`${titles.length} action items added here and to your Tasks page`);
    } else if (action === "continue" || action === "generate") {
      editor.chain().focus().insertContent(textToParagraphs(result)).run();
    } else {
      // fix_grammar / make_shorter / make_longer — replace the current selection
      const { from, to } = editor.state.selection;
      editor.chain().focus().insertContentAt({ from, to }, result).run();
    }
  };

  const needsSelection = (action) => {
    if (!selectedText(editor)) {
      toast("Select some text first");
      return true;
    }
    return false;
  };

  const ACTIONS = [
    ["Summarize this note", () => run("summarize")],
    ["Extract action items", () => run("extract_tasks")],
    ["Continue writing", () => run("continue", { selected_text: editor.getText().split(/\s+/).slice(-200).join(" ") })],
    ["Fix grammar & spelling", () => !needsSelection("fix_grammar") && run("fix_grammar", { selected_text: selectedText(editor) })],
    ["Make it shorter", () => !needsSelection("make_shorter") && run("make_shorter", { selected_text: selectedText(editor) })],
    ["Make it longer", () => !needsSelection("make_longer") && run("make_longer", { selected_text: selectedText(editor) })],
    ["Generate from prompt", () => { setShowPrompt(true); }],
  ];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-text-onaccent hover:brightness-105">
        AI
      </button>
      {open && !showPrompt && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-xl border border-border bg-bg-surface p-1 shadow-2xl">
          {ACTIONS.map(([label, fn]) => (
            <button key={label} onClick={fn}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-elevated">{label}</button>
          ))}
        </div>
      )}
      {showPrompt && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-xl border border-border bg-bg-surface p-3 shadow-2xl">
          <p className="mb-2 text-xs font-semibold text-text-muted">Generate from prompt</p>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} autoFocus
            placeholder="e.g. A study plan for my chemistry final"
            className="w-full resize-none rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => { setShowPrompt(false); setPrompt(""); }} className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-muted">Cancel</button>
            <button onClick={() => { const p = prompt.trim(); if (p) { run("generate", { prompt: p }); setShowPrompt(false); setPrompt(""); } }}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-text-onaccent">Generate</button>
          </div>
        </div>
      )}
    </div>
  );
}
