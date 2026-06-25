import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import api from "../lib/api";
import { bulkCreateTasks } from "../lib/queries";

const MAX_SIZE = 10 * 1024 * 1024;
const ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

function priorityBadge(p) {
  const cls = { high: "bg-accent-red/15 text-accent-red", medium: "bg-accent-amber/15 text-accent-amber", low: "bg-accent-green/15 text-accent-green" };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls[p] || cls.medium}`}>{p}</span>;
}

export default function DocumentUploader() {
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [agentExpanded, setAgentExpanded] = useState(false);

  const analyzeMut = useMutation({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("user_context", "");
      const res = await api.post("/documents/analyze", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => { if (e.total) setProgress(Math.round((e.loaded / e.total) * 100)); },
      });
      return res.data;
    },
    onSuccess: (data) => { setResult(data.analysis); setProgress(0); toast.success("Document analyzed"); },
    onError: () => { setProgress(0); toast.error("Analysis failed"); },
  });

  const bulkMut = useMutation({
    mutationFn: (steps) => bulkCreateTasks(steps.map((s) => ({
      title: s.step,
      description: `From document analysis`,
      deadline: s.deadline || null,
      priority: s.priority || "medium",
    }))),
    onSuccess: () => toast.success("Tasks created from plan"),
  });

  const onDrop = useCallback((accepted) => {
    if (accepted.length > 0) { setResult(null); analyzeMut.mutate(accepted[0]); }
  }, [analyzeMut]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_SIZE,
    multiple: false,
  });

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div {...getRootProps()}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition cursor-pointer ${isDragActive ? "border-accent-blue bg-accent-blue/5" : "border-border bg-bg-surface hover:border-text-muted"}`}>
        <input {...getInputProps()} />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-10 w-10 text-text-muted mb-3">
          <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-sm text-text-muted">
          {isDragActive ? "Drop file here…" : "Drag & drop PDF, DOCX, PNG, or JPG (max 10MB)"}
        </p>
        <p className="mt-1 text-xs text-text-muted">or click to browse</p>
      </div>

      {/* Upload progress */}
      {analyzeMut.isPending && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{progress < 100 ? "Uploading…" : "Analyzing with AI…"}</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
            <motion.div className="h-full bg-accent-blue rounded-full"
              initial={{ width: 0 }} animate={{ width: `${progress < 100 ? progress : 100}%` }}
              transition={{ duration: 0.3 }} />
          </div>
          {progress >= 100 && (
            <div className="flex items-center gap-2 text-xs text-accent-purple">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-purple" />
              AI is reading your document…
            </div>
          )}
        </div>
      )}

      {/* Analysis result */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

            {/* Summary */}
            <div className="rounded-xl border border-border bg-bg-surface p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Summary</h3>
              <p className="text-sm text-text-primary leading-relaxed">{result.summary}</p>
            </div>

            {/* Deadlines */}
            {result.deadlines?.length > 0 && (
              <div className="rounded-xl border border-border bg-bg-surface p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Deadlines Found</h3>
                <div className="space-y-2">
                  {result.deadlines.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-bg-elevated/50 px-3 py-2">
                      <span className="h-2 w-2 rounded-full bg-accent-red shrink-0" />
                      <span className="text-sm text-text-primary flex-1">{d.item}</span>
                      {d.date && <span className="font-mono text-[11px] text-accent-amber">{d.date}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action plan */}
            {result.action_plan?.length > 0 && (
              <div className="rounded-xl border border-border bg-bg-surface p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Action Plan</h3>
                  <button onClick={() => bulkMut.mutate(result.action_plan)} disabled={bulkMut.isPending}
                    className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-semibold text-bg-base hover:bg-accent-blue/80 transition disabled:opacity-50">
                    {bulkMut.isPending ? "Creating…" : "Create Tasks from Plan"}
                  </button>
                </div>
                <div className="space-y-2">
                  {result.action_plan.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg bg-bg-elevated/50 px-3 py-2.5">
                      <span className="font-mono text-xs text-accent-blue mt-0.5 shrink-0">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-primary">{step.step}</p>
                        {step.deadline && <p className="mt-0.5 font-mono text-[11px] text-text-muted">Due: {step.deadline}</p>}
                      </div>
                      {priorityBadge(step.priority)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Estimated time */}
            {result.estimated_total_time_hours > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-accent-purple/5 border border-accent-purple/20 px-4 py-2.5">
                <span className="text-sm">⏱</span>
                <span className="text-sm text-text-muted">
                  Estimated total effort: <strong className="text-accent-purple font-mono">{result.estimated_total_time_hours}h</strong>
                </span>
              </div>
            )}

            {/* Agent prompt */}
            {result.agent_prompt && (
              <div className="rounded-xl border border-border bg-bg-surface overflow-hidden">
                <button onClick={() => setAgentExpanded(!agentExpanded)}
                  className="flex w-full items-center justify-between px-5 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted hover:bg-bg-elevated/50 transition">
                  <span>✨ AI Agent Prompt</span>
                  <span>{agentExpanded ? "▲" : "▼"}</span>
                </button>
                <AnimatePresence>
                  {agentExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden">
                      <div className="border-t border-border px-5 py-4">
                        <pre className="whitespace-pre-wrap text-xs text-text-muted font-mono leading-relaxed max-h-60 overflow-y-auto">
                          {result.agent_prompt}
                        </pre>
                        <button onClick={() => { navigator.clipboard.writeText(result.agent_prompt); toast.success("Copied to clipboard"); }}
                          className="mt-3 rounded-lg bg-accent-purple/10 px-3 py-1.5 text-xs font-semibold text-accent-purple hover:bg-accent-purple/20 transition">
                          Copy Prompt
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
