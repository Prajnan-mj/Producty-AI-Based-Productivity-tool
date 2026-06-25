import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import useUiStore from "../store/uiStore";
import useUserStore from "../store/userStore";
import { createTask, createNote, searchEverything } from "../lib/queries";

/**
 * Global command palette. Ctrl/Cmd+K from anywhere to jump between pages or
 * fire quick actions (new task, new note, open AI, voice, sign out).
 */
export default function CommandPalette() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setAiPanelOpen = useUiStore((s) => s.setAiPanelOpen);
  const logout = useUserStore((s) => s.logout);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState("list"); // "list" | "newTask" | "search"
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const searchTimer = useRef(null);

  const close = () => { setOpen(false); setQuery(""); setActive(0); setMode("list"); setSearchResults([]); };

  const newNoteMut = useMutation({
    mutationFn: () => createNote({ title: "Untitled", content: "", folder_id: null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notes"] }); navigate("/notes"); toast.success("New note created"); },
    onError: () => toast.error("Couldn't create note"),
  });

  const newTaskMut = useMutation({
    mutationFn: (title) => createTask({ title, priority: "medium" }),
    onSuccess: () => {
      ["tasks", "urgentTasks"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Task added");
      navigate("/tasks");
    },
    onError: () => toast.error("Couldn't add task"),
  });

  // Build the command list.
  const commands = useMemo(() => {
    const go = (to) => () => { navigate(to); close(); };
    const nav = [
      ["Capture", "/capture"], ["Dashboard", "/dashboard"], ["Tasks", "/tasks"], ["Calendar", "/calendar"],
      ["Countdown", "/countdown"], ["Rescue", "/rescue"], ["Goals", "/goals"], ["Habits", "/habits"],
      ["Focus", "/focus"], ["Flashcards", "/flashcards"], ["Journal", "/journal"], ["Notes", "/notes"],
      ["Documents", "/documents"], ["Bills", "/bills"], ["Rooms", "/rooms"],
    ].map(([label, to]) => ({ id: `nav:${to}`, group: "Navigate", label: `Go to ${label}`, keywords: label, run: go(to) }));

    const actions = [
      { id: "search", group: "Actions", label: "Search everything…", keywords: "find lookup", run: () => { setMode("search"); setQuery(""); setActive(0); setSearchResults([]); } },
      { id: "new-task", group: "Create", label: "New task…", keywords: "add todo", run: () => { setMode("newTask"); setQuery(""); setActive(0); } },
      { id: "new-note", group: "Create", label: "New note", keywords: "write doc", run: () => { newNoteMut.mutate(); close(); } },
      { id: "ai", group: "Actions", label: "Open AI assistant", keywords: "chat help", run: () => { setAiPanelOpen(true); close(); } },
      { id: "voice", group: "Actions", label: "Voice command", keywords: "speak mic dictate", run: () => { window.dispatchEvent(new CustomEvent("producty:start-voice")); close(); } },
      { id: "logout", group: "Actions", label: "Sign out", keywords: "log out exit", run: () => { close(); logout(); } },
    ];
    return [...actions, ...nav];
  }, [navigate, newNoteMut, setAiPanelOpen, logout]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => (c.label + " " + (c.keywords || "")).toLowerCase().includes(q));
  }, [commands, query]);

  // Open/close on Ctrl/Cmd+K.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) { setActive(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open, mode]);

  // Keep the active item in view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const doSearch = (q) => {
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await searchEverything(q.trim());
        setSearchResults(r);
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 300);
  };

  const onInputKey = (e) => {
    if (mode === "search") {
      if (e.key === "Escape") { setMode("list"); setQuery(""); setSearchResults([]); }
      return;
    }
    if (mode === "newTask") {
      if (e.key === "Enter") { const t = query.trim(); if (t) { newTaskMut.mutate(t); close(); } }
      else if (e.key === "Escape") { setMode("list"); setQuery(""); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  let lastGroup = null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.14 }}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-text-muted">
                {mode === "newTask"
                  ? <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  : <path d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" strokeLinecap="round" />}
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); if (mode === "search") doSearch(e.target.value); }}
                onKeyDown={onInputKey}
                placeholder={mode === "search" ? "Search tasks, notes, bills…" : mode === "newTask" ? "Task title, then press Enter…" : "Search commands…"}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted sm:block">Esc</kbd>
            </div>

            {mode === "list" && (
              <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
                {filtered.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-text-muted">No matching commands.</p>
                )}
                {filtered.map((c, i) => {
                  const showGroup = c.group !== lastGroup;
                  lastGroup = c.group;
                  return (
                    <div key={c.id}>
                      {showGroup && (
                        <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{c.group}</p>
                      )}
                      <button
                        data-idx={i}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => c.run()}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                          i === active ? "bg-accent/15 text-text-primary" : "text-text-primary/80 hover:bg-bg-elevated"
                        }`}
                      >
                        <span>{c.label}</span>
                        {i === active && <span className="text-[10px] text-text-muted">↵</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {mode === "newTask" && (
              <div className="px-4 py-4 text-xs text-text-muted">
                Press <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Enter</kbd> to create,
                {" "}<kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Esc</kbd> to go back.
              </div>
            )}

            {mode === "search" && (
              <div className="max-h-80 overflow-y-auto p-1.5">
                {searching && <p className="px-3 py-4 text-center text-xs text-text-muted">Searching…</p>}
                {!searching && query.trim() && searchResults.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-text-muted">No results for "{query}"</p>
                )}
                {searchResults.map((r) => {
                  const typeColors = { task: "text-accent", note: "text-accent-blue", bill: "text-accent-amber", meeting: "text-accent-purple" };
                  const routes = { task: "/tasks", note: "/notes", bill: "/bills", meeting: "/calendar" };
                  return (
                    <button key={`${r.type}-${r.id}`}
                      onClick={() => { navigate(routes[r.type] || "/dashboard"); close(); }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-bg-elevated">
                      <span className={`text-[10px] font-bold uppercase ${typeColors[r.type] || "text-text-muted"}`}>{r.type}</span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm text-text-primary">{r.title}</p>
                        {r.snippet && <p className="truncate text-[10px] text-text-muted">{r.snippet}</p>}
                      </div>
                      {r.tags && <span className="text-[10px] text-text-muted">{r.tags}</span>}
                    </button>
                  );
                })}
                {!query.trim() && <p className="px-3 py-6 text-center text-xs text-text-muted">Type to search across tasks, notes, bills, and meetings.</p>}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
