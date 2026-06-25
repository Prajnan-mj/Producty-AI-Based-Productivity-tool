import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  captureParseText, captureParseFile, fetchReviewQueue, actOnReview,
  fetchNextAction,
} from "../lib/queries";

function NextActionCard() {
  const [mins, setMins] = useState(30);
  const [energy, setEnergy] = useState("med");
  const q = useQuery({
    queryKey: ["nextAction", mins, energy],
    queryFn: () => fetchNextAction(mins, energy),
    retry: false,
  });
  const na = q.data;

  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-5">
      <h3 className="mb-3 font-display text-base text-text-primary">What should I do right now?</h3>
      <div className="mb-3 flex gap-2">
        <select value={mins} onChange={(e) => setMins(Number(e.target.value))}
          className="rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none">
          {[15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
        <select value={energy} onChange={(e) => setEnergy(e.target.value)}
          className="rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none">
          <option value="low">Low energy</option>
          <option value="med">Medium</option>
          <option value="high">High energy</option>
        </select>
      </div>
      {na ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-accent">{na.title}</p>
          <p className="text-xs leading-relaxed text-text-muted">{na.reason}</p>
          {na.suggested_subscope && (
            <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
              Subscope: {na.suggested_subscope}
            </p>
          )}
        </div>
      ) : q.isLoading ? (
        <p className="text-xs text-text-muted">Thinking…</p>
      ) : null}
    </div>
  );
}

function ReviewQueue() {
  const qc = useQueryClient();
  const reviewQ = useQuery({ queryKey: ["reviewQueue"], queryFn: fetchReviewQueue });
  const items = reviewQ.data || [];

  const actMut = useMutation({
    mutationFn: ({ id, action }) => actOnReview(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reviewQueue"] }),
  });

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-5">
      <h3 className="mb-3 font-display text-base text-text-primary">
        Review Queue <span className="ml-1 text-sm text-accent">({items.length})</span>
      </h3>
      <p className="mb-3 text-xs text-text-muted">Low-confidence items need your approval before they're created.</p>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-lg bg-bg-elevated px-3 py-2">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase bg-accent/10 text-accent">{item.item_type}</span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm text-text-primary">{item.title}</p>
              {item.deadline && <p className="text-[10px] text-text-muted">{new Date(item.deadline).toLocaleDateString()}</p>}
            </div>
            <span className="text-[10px] text-text-muted">{Math.round(item.confidence * 100)}%</span>
            <button onClick={() => actMut.mutate({ id: item.id, action: "approve" })}
              className="rounded bg-accent px-2 py-1 text-[10px] font-bold text-text-onaccent">Yes</button>
            <button onClick={() => actMut.mutate({ id: item.id, action: "dismiss" })}
              className="rounded bg-bg-base px-2 py-1 text-[10px] text-text-muted hover:text-text-primary">No</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Capture() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const parseMut = useMutation({
    mutationFn: (payload) => payload.file ? captureParseFile(payload.file, payload.text) : captureParseText(payload.text),
    onSuccess: (data) => {
      setResult(data);
      const n = data.created.length;
      const r = data.needs_review.length;
      if (n > 0) toast.success(`${n} item${n > 1 ? "s" : ""} auto-created`);
      if (r > 0) toast(`${r} item${r > 1 ? "s" : ""} need review`, { icon: "🔍" });
      if (n === 0 && r === 0) toast("No actionable items found", { icon: "🤷" });
      qc.invalidateQueries({ queryKey: ["reviewQueue"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setText("");
    },
    onError: () => toast.error("Capture failed — check your Gemini key"),
  });

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) parseMut.mutate({ file, text });
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) parseMut.mutate({ file, text });
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-text-primary">Capture</h1>
        <p className="mt-1 text-sm text-text-muted">
          Dump anything here — text, photos, screenshots, voice transcripts.
          Producty extracts the tasks, events, and deadlines for you.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Input area */}
          <div
            className="rounded-2xl border-2 border-dashed border-border bg-bg-surface p-6 transition hover:border-accent/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={"Paste anything here — a professor's email, meeting notes, a to-do list, even raw brain dump…\n\nOr drop an image / PDF onto this box."}
              className="w-full resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => { if (text.trim()) parseMut.mutate({ text: text.trim() }); }}
                disabled={!text.trim() || parseMut.isPending}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent hover:brightness-105 disabled:opacity-50"
              >
                {parseMut.isPending ? "Parsing…" : "Capture"}
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="rounded-lg bg-bg-elevated px-4 py-2 text-sm font-semibold text-text-primary hover:brightness-110">
                Upload file
              </button>
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.docx,.txt"
                onChange={handleFileSelect} />
              <span className="text-[10px] text-text-muted">or drag & drop</span>
            </div>
          </div>

          {/* Results */}
          <AnimatePresence>
            {result && (result.created.length > 0 || result.needs_review.length > 0) && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-bg-surface p-5 space-y-3">
                <h3 className="font-display text-base text-text-primary">Extracted</h3>
                {result.created.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg bg-bg-elevated px-3 py-2">
                    <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
                      {item.item_type}
                    </span>
                    <span className="flex-1 text-sm text-text-primary">{item.title}</span>
                    <span className="text-[10px] text-accent">{Math.round(item.confidence * 100)}%</span>
                    <span className="text-[10px] text-accent">✓ created</span>
                  </div>
                ))}
                {result.needs_review.map((item, i) => (
                  <div key={`r-${i}`} className="flex items-center gap-3 rounded-lg bg-bg-elevated px-3 py-2">
                    <span className="rounded bg-accent-red/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-red">
                      review
                    </span>
                    <span className="flex-1 text-sm text-text-primary">{item.title}</span>
                    <span className="text-[10px] text-text-muted">{Math.round(item.confidence * 100)}%</span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <ReviewQueue />
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <NextActionCard />
        </div>
      </div>
    </div>
  );
}
