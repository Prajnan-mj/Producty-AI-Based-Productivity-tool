import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import useUserStore from "../store/userStore";
import useUiStore from "../store/uiStore";
import api from "../lib/api";

const ALL_SIDEBAR_ITEMS = [
  { key: "capture", label: "Capture" },
  { key: "dashboard", label: "Dashboard" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
  { key: "countdown", label: "Countdown" },
  { key: "rescue", label: "Rescue" },
  { key: "goals", label: "Goals" },
  { key: "habits", label: "Habits" },
  { key: "focus", label: "Focus" },
  { key: "flashcards", label: "Flashcards" },
  { key: "journal", label: "Journal" },
  { key: "notes", label: "Notes" },
  { key: "bills", label: "Bills" },
  { key: "documents", label: "Documents" },
];

function loadToggles() {
  try {
    const raw = localStorage.getItem("sidebar_toggles");
    if (raw) return JSON.parse(raw);
  } catch {}
  const defaults = {};
  ALL_SIDEBAR_ITEMS.forEach((i) => (defaults[i.key] = true));
  return defaults;
}

export function useSidebarToggles() {
  const [toggles, setToggles] = useState(loadToggles);

  const set = (key, val) => {
    setToggles((prev) => {
      const next = { ...prev, [key]: val };
      localStorage.setItem("sidebar_toggles", JSON.stringify(next));
      window.dispatchEvent(new Event("sidebar-toggles-changed"));
      return next;
    });
  };

  useEffect(() => {
    const handler = () => setToggles(loadToggles());
    window.addEventListener("sidebar-toggles-changed", handler);
    return () => window.removeEventListener("sidebar-toggles-changed", handler);
  }, []);

  return { toggles, setToggle: set };
}

export default function ProfileDropdown() {
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);
  const logout = useUserStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("main"); // "main" | "visibility"
  const [imgFailed, setImgFailed] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const { toggles, setToggle } = useSidebarToggles();
  const ref = useRef(null);
  const fileRef = useRef(null);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => { if (!open) setTab("main"); }, [open]);

  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase() || "?";
  const showPicture = user?.picture_url && !imgFailed;

  const handlePfpUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      const updated = { ...user, picture_url: url };
      setUser(updated);
      setImgFailed(false);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center">
        {showPicture ? (
          <img src={user.picture_url} alt={user?.name || "Profile"} referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-8 w-8 rounded-full object-cover ring-2 ring-transparent transition hover:ring-accent/40" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent transition hover:bg-accent/25">{initial}</div>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl border border-border bg-bg-surface shadow-xl"
          >
            {tab === "main" && (
              <div>
                {/* User info */}
                <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
                  {showPicture ? (
                    <img src={user.picture_url} alt="" referrerPolicy="no-referrer"
                      onError={() => setImgFailed(true)}
                      className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">{initial}</div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{user?.name || "User"}</p>
                    <p className="truncate text-xs text-text-muted">{user?.email}</p>
                  </div>
                </div>

                {/* Menu items */}
                <div className="py-1.5">
                  <button onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center gap-3 px-4 py-2 text-sm text-text-primary transition hover:bg-bg-elevated">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-text-muted"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Edit profile picture
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePfpUpload} />

                  <button onClick={toggleDark}
                    className="flex w-full items-center justify-between px-4 py-2 text-sm text-text-primary transition hover:bg-bg-elevated">
                    <span className="flex items-center gap-3">
                      {dark ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-text-muted"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-text-muted"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                      {dark ? "Light mode" : "Dark mode"}
                    </span>
                    <span className={`flex h-5 w-9 items-center rounded-full px-0.5 transition ${dark ? "bg-accent" : "bg-border"}`}>
                      <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${dark ? "translate-x-4" : "translate-x-0"}`} />
                    </span>
                  </button>

                  <button onClick={() => setTab("visibility")}
                    className="flex w-full items-center gap-3 px-4 py-2 text-sm text-text-primary transition hover:bg-bg-elevated">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-text-muted"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" /></svg>
                    Sidebar visibility
                  </button>

                  <div className="mx-3 my-1.5 h-px bg-border" />

                  <button onClick={() => { setOpen(false); logout(); }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-sm text-accent-red transition hover:bg-accent-red/8">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Sign out
                  </button>
                </div>
              </div>
            )}

            {tab === "visibility" && (
              <div>
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <button onClick={() => setTab("main")} className="text-text-muted hover:text-text-primary">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <p className="text-sm font-semibold text-text-primary">Sidebar visibility</p>
                </div>
                <div className="max-h-72 overflow-y-auto py-2">
                  {ALL_SIDEBAR_ITEMS.map((item) => (
                    <label key={item.key} className="flex cursor-pointer items-center justify-between px-4 py-2 text-sm transition hover:bg-bg-elevated">
                      <span className="text-text-primary">{item.label}</span>
                      <input
                        type="checkbox"
                        checked={toggles[item.key] !== false}
                        onChange={(e) => setToggle(item.key, e.target.checked)}
                        className="h-4 w-4 rounded border-border accent-accent"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
