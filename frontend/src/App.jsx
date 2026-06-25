import { useEffect, useRef } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Lenis from "lenis";
import useUiStore from "./store/uiStore";
import useUserStore from "./store/userStore";
import Notifications from "./components/Notifications";
import AIPanel from "./components/AIPanel";
import CursorFollower from "./components/CursorFollower";
import CommandPalette from "./components/CommandPalette";
import KeyboardHelp from "./components/KeyboardHelp";
import { LogoMark, Wordmark } from "./components/Logo";

function AiToggleButton() {
  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);
  const aiPanelOpen = useUiStore((s) => s.aiPanelOpen);
  return (
    <button onClick={toggleAiPanel}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${aiPanelOpen ? "bg-accent text-text-onaccent" : "bg-accent/10 text-accent hover:bg-accent/20"}`}>
      <span>AI</span>
    </button>
  );
}

// Grouped navigation keeps a long list scannable in the minimalist sidebar.
const NAV_GROUPS = [
  {
    label: "Plan",
    items: [
      { to: "/capture", label: "Capture", icon: "M12 4v16m8-8H4" },
      { to: "/dashboard", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" },
      { to: "/tasks", label: "Tasks", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
      { to: "/calendar", label: "Calendar", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
      { to: "/countdown", label: "Countdown", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
      { to: "/rescue", label: "Rescue", icon: "M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.96l-6.93-12a2 2 0 00-3.5 0l-6.93 12A2 2 0 005.07 19z" },
    ],
  },
  {
    label: "Grow",
    items: [
      { to: "/goals", label: "Goals", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
      { to: "/habits", label: "Habits", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
      { to: "/focus", label: "Focus", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
      { to: "/flashcards", label: "Flashcards", icon: "M8 7V5a2 2 0 012-2h9a2 2 0 012 2v9a2 2 0 01-2 2h-2M5 8h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2v-9a2 2 0 012-2z" },
      { to: "/journal", label: "Journal", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/notes", label: "Notes", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
      // Rooms hidden for now — page + backend kept for future use
      // { to: "/rooms", label: "Rooms", icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-2.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-3-6.65" },
      { to: "/bills", label: "Bills", icon: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" },
      { to: "/documents", label: "Documents", icon: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" },
    ],
  },
];

function SidebarIcon({ d }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">
      <path d={d} />
    </svg>
  );
}

function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const logout = useUserStore((s) => s.logout);

  return (
    <>
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}
      </AnimatePresence>

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-56 flex-col bg-bg-sidebar transition-transform duration-200 lg:static lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-5 py-6">
          <LogoMark size={32} />
          <Wordmark className="text-lg text-white" />
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">{group.label}</p>
              {group.items.map(({ to, label, icon }) => (
                <NavLink key={to} to={to} onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-accent text-text-onaccent" : "text-white/70 hover:bg-black/20 hover:text-white"}`
                  }>
                  <SidebarIcon d={icon} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-3 py-3">
          <button onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-accent-red/20 hover:text-accent-red">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

export default function AppShell() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const aiPanelOpen = useUiStore((s) => s.aiPanelOpen);
  const setAiPanelOpen = useUiStore((s) => s.setAiPanelOpen);
  const mainRef = useRef(null);

  // Buttery smooth wheel scrolling on the main content area (Lenis).
  useEffect(() => {
    const wrapper = mainRef.current;
    if (!wrapper) return;
    const lenis = new Lenis({
      wrapper,
      content: wrapper.firstElementChild,
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
    });
    let raf = requestAnimationFrame(function loop(time) {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    });
    return () => { cancelAnimationFrame(raf); lenis.destroy(); };
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg-base">
      <CursorFollower />
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div><Outlet /></div>
        </main>
      </div>

      {/* Mobile: open the app nav (sidebar is always visible on lg+). */}
      <button onClick={toggleSidebar}
        className="fixed left-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-surface/90 text-text-primary backdrop-blur lg:hidden"
        aria-label="Open menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
          <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
        </svg>
      </button>

      {/* Tablet/mobile: toggle the AI panel (always docked on xl+). */}
      <div className="fixed right-4 top-4 z-30 xl:hidden">
        <AiToggleButton />
      </div>

      <div className="hidden xl:flex">
        <AIPanel />
      </div>

      <AnimatePresence>
        {aiPanelOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 xl:hidden" onClick={() => setAiPanelOpen(false)} />
            <motion.div initial={{ x: 340 }} animate={{ x: 0 }} exit={{ x: 340 }}
              transition={{ type: "tween", duration: 0.2 }}
              className="fixed inset-y-0 right-0 z-50 flex xl:hidden">
              <AIPanel />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Global command palette — Ctrl/Cmd+K from anywhere. */}
      <CommandPalette />
      {/* Keyboard shortcuts overlay — press ? anywhere. */}
      <KeyboardHelp />

      <Notifications />
    </div>
  );
}
