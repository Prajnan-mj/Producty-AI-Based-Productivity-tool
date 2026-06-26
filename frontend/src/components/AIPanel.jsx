import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { fetchDailyPlan, fetchAgentPrompt, composeEmail, sendEmail } from "../lib/queries";
import { streamChat } from "../lib/chatStream";
import { useVoice } from "../hooks/useVoice";
import { CardSkeleton } from "./Skeleton";

function fmtTime(raw) {
  if (!raw) return "";
  if (/^\d{1,2}:\d{2}/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const TABS = [
  { key: "plan", label: "Daily Plan" },
  { key: "chat", label: "Chat" },
  { key: "email", label: "Email" },
  { key: "agent", label: "Agent" },
];

/* ------------------------------------------------------------------ */
/* a) Daily Plan tab                                                   */
/* ------------------------------------------------------------------ */

function DailyPlanTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["dailyPlan"],
    queryFn: fetchDailyPlan,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  if (isLoading) return <div className="p-4 space-y-3"><CardSkeleton lines={4} /><CardSkeleton lines={3} /></div>;
  if (!data) return <p className="p-4 text-sm text-text-muted">No plan available.</p>;

  const sections = [
    { title: "Morning", icon: "☀️", blocks: data.morning_blocks },
    { title: "Afternoon", icon: "🌤️", blocks: data.afternoon_blocks },
    { title: "Evening", icon: "🌙", blocks: data.evening_blocks },
  ];

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      {/* Top priorities */}
      {data.top_3_priorities?.length > 0 && (
        <div className="rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent-blue">Top Priorities</p>
          <ol className="space-y-1">
            {data.top_3_priorities.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm text-text-primary">
                <span className="font-mono text-accent-blue">{i + 1}.</span>{p}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Time blocks */}
      {sections.map(({ title, icon, blocks }) =>
        blocks?.length > 0 ? (
          <div key={title} className="space-y-2">
            <p className="text-xs font-medium text-text-muted">{icon} {title}</p>
            {blocks.map((b, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-bg-elevated/50 px-3 py-2">
                <span className="w-14 shrink-0 font-mono text-[11px] text-accent-blue">{fmtTime(b.time)}</span>
                <span className="truncate text-sm text-text-primary">{b.activity}</span>
              </div>
            ))}
          </div>
        ) : null
      )}

      {/* Risk items */}
      {data.risk_items?.length > 0 && (
        <div className="rounded-xl border border-accent-red/20 bg-accent-red/5 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent-red">⚠ Watch Out</p>
          <ul className="space-y-1">
            {data.risk_items.map((r, i) => (
              <li key={i} className="text-sm text-text-muted">{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Motivation */}
      {data.motivational_message && (
        <div className="rounded-xl border border-accent-purple/20 bg-accent-purple/5 p-3">
          <p className="text-sm italic leading-relaxed text-text-muted">{data.motivational_message}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* b) Chat tab                                                         */
/* ------------------------------------------------------------------ */

function ChatTab() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const sendRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendText = useCallback((text) => {
    if (!text || streaming) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const next = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(next);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    streamChat({
      message: text,
      contextWindow: history,
      signal: controller.signal,
      onToken: (chunk) => {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + chunk };
          return copy;
        });
      },
      onDone: () => setStreaming(false),
      onError: (err) => {
        setStreaming(false);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: `Error: ${err.message}` };
          return copy;
        });
      },
    });
  }, [messages, streaming]);

  sendRef.current = sendText;

  const send = () => {
    sendText(input.trim());
  };

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  // Voice integration — disabled for now, hook + files kept for future use.
  // const handleVoiceResult = useCallback(({ transcript }) => {
  //   setInput(transcript);
  //   setTimeout(() => sendRef.current?.(transcript), 50);
  // }, []);
  // const { isListening, transcript, isSupported, startListening, stopListening } = useVoice({
  //   onResult: handleVoiceResult,
  // });

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="mt-8 text-center text-sm text-text-muted">
            <p className="text-2xl mb-2">💬</p>
            Ask me about your schedule, priorities, or what to focus on next.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
              m.role === "user" ? "bg-accent-blue text-bg-base" : "bg-bg-elevated text-text-primary"
            }`}>
              {m.content || (streaming && i === messages.length - 1 ? (
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: "300ms" }} />
                </span>
              ) : "")}
              {streaming && i === messages.length - 1 && m.content && (
                <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-accent-blue align-middle" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Ask about your day..."
            className="flex-1 resize-none rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none max-h-24"
          />
          {streaming ? (
            <button onClick={stop} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-red text-bg-base">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            </button>
          ) : (
            <button onClick={send} disabled={!input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-blue text-bg-base transition hover:bg-accent-blue/80 disabled:opacity-40">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* c) Email tab — ask the AI to write + send an email                  */
/* ------------------------------------------------------------------ */

function EmailTab() {
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState(null); // {to, subject, body}
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const handleCompose = async () => {
    const text = instruction.trim();
    if (!text || drafting) return;
    setDrafting(true);
    try {
      const d = await composeEmail(text, null);
      setDraft(d);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't draft the email.");
    } finally {
      setDrafting(false);
    }
  };

  const handleSend = async () => {
    if (!draft || sending) return;
    if (!draft.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.to)) {
      toast.error("Add a valid recipient email.");
      return;
    }
    setSending(true);
    try {
      const res = await sendEmail(draft.to, draft.subject, draft.body);
      toast.success(res.message || "Email sent!");
      setDraft(null);
      setInstruction("");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-y-auto p-4 space-y-3">
      <p className="text-xs text-text-muted">
        Tell the AI what to write. Example: “Email john@acme.com to reschedule
        tomorrow's 3pm meeting to Friday.”
      </p>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
        placeholder="What should the email say?"
        className="w-full resize-none rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none"
      />
      <button onClick={handleCompose} disabled={!instruction.trim() || drafting}
        className="rounded-lg bg-accent-blue px-3 py-2 text-xs font-bold text-bg-base transition hover:bg-accent-blue/80 disabled:opacity-40">
        {drafting ? "Drafting…" : "Draft with AI"}
      </button>

      {draft && (
        <div className="space-y-2 rounded-xl border border-border bg-bg-base p-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">To</label>
            <input
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              placeholder="recipient@example.com"
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-sm text-text-primary focus:border-accent-blue focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Subject</label>
            <input
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-sm text-text-primary focus:border-accent-blue focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Body</label>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={8}
              className="mt-1 w-full resize-none rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-sm text-text-primary focus:border-accent-blue focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSend} disabled={sending}
              className="flex-1 rounded-lg bg-accent py-2 text-xs font-bold text-text-onaccent transition hover:opacity-90 disabled:opacity-50">
              {sending ? "Sending…" : "Send Email"}
            </button>
            <button onClick={() => setDraft(null)}
              className="rounded-lg bg-bg-elevated px-3 py-2 text-xs font-semibold text-text-muted hover:text-text-primary">
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* d) Agent Prompt tab                                                 */
/* ------------------------------------------------------------------ */

function AgentPromptTab() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["agentPrompt"],
    queryFn: fetchAgentPrompt,
    staleTime: Infinity,
    retry: false,
  });

  const copy = () => {
    if (data?.prompt) {
      navigator.clipboard.writeText(data.prompt);
      toast.success("Prompt copied");
    }
  };

  return (
    <div className="flex flex-1 flex-col min-h-0 p-4">
      <p className="mb-3 text-xs text-text-muted">
        Paste this into Antigravity, n8n, Make, or Zapier to automate your tasks.
      </p>

      {isLoading ? (
        <CardSkeleton lines={8} />
      ) : (
        <div className="relative flex-1 min-h-0">
          <pre className="h-full overflow-y-auto rounded-xl border border-border bg-bg-base p-3 font-mono text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap">
            {data?.prompt || "No prompt generated yet."}
          </pre>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button onClick={copy} disabled={!data?.prompt}
          className="flex-1 rounded-lg bg-accent-purple/10 px-3 py-2 text-xs font-semibold text-accent-purple transition hover:bg-accent-purple/20 disabled:opacity-50">
          Copy Prompt
        </button>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 rounded-lg bg-bg-elevated px-3 py-2 text-xs font-semibold text-text-muted transition hover:text-text-primary disabled:opacity-50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}>
            <path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {isFetching ? "Generating…" : "Regenerate"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel shell                                                         */
/* ------------------------------------------------------------------ */

export default function AIPanel({ className = "" }) {
  const [tab, setTab] = useState("plan");

  return (
    <aside className={`flex w-80 flex-col border-l border-border bg-bg-surface ${className}`}>
      {/* Header + tabs */}
      <div className="border-b border-border px-4 pt-4">
        <div className="mb-3">
          <h2 className="font-display text-sm font-bold">AI Assistant</h2>
        </div>
        <div className="flex gap-1">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`relative rounded-t-lg px-3 py-2 text-xs font-semibold transition ${tab === key ? "text-accent-purple" : "text-text-muted hover:text-text-primary"}`}>
              {label}
              {tab === key && (
                <motion.span layoutId="ai-tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-purple" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex flex-1 flex-col min-h-0">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }} className="flex flex-1 flex-col min-h-0">
            {tab === "plan" && <DailyPlanTab />}
            {tab === "chat" && <ChatTab />}
            {tab === "email" && <EmailTab />}
            {tab === "agent" && <AgentPromptTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </aside>
  );
}
