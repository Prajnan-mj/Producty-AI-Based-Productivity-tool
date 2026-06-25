import { Link, Navigate, useNavigate } from "react-router-dom";
import useUserStore from "../store/userStore";

const FEATURES = [
  { title: "Smart Tasks & Deadlines", desc: "Capture tasks, track deadlines, and let AI break big work into steps." },
  { title: "Calendar & Gmail Sync", desc: "See your meetings and turn actionable emails into tasks automatically." },
  { title: "AI Assistant", desc: "Plan your day, summarize documents, and draft emails just by asking." },
  { title: "Notes & Habits", desc: "A Notion-style editor plus habit tracking and goals, all in one place." },
];

export default function Landing() {
  const token = useUserStore((s) => s.token);
  const navigate = useNavigate();

  if (token) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-dvh bg-bg-base text-text-primary">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="font-display text-xl font-extrabold">Producty</span>
        <button onClick={() => navigate("/login")}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-text-onaccent transition hover:opacity-90">
          Sign in
        </button>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-5xl px-6">
        <section className="py-16 text-center">
          <h1 className="font-display text-4xl font-extrabold leading-tight sm:text-5xl">
            Your calm command center for<br />deadlines, tasks, and goals.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-text-muted">
            Producty brings your tasks, calendar, habits, and notes together — with an
            AI assistant that plans your day, summarizes your documents, and even drafts
            your emails.
          </p>
          <button onClick={() => navigate("/login")}
            className="mt-8 rounded-xl bg-accent px-6 py-3 text-sm font-bold text-text-onaccent transition hover:opacity-90">
            Get started with Google
          </button>
        </section>

        {/* Features */}
        <section className="grid grid-cols-1 gap-4 pb-20 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-bg-surface p-6">
              <h3 className="font-display text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-xs text-text-muted sm:flex-row">
          <span>© 2026 Producty</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-text-primary">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-text-primary">Terms of Service</Link>
            <a href="mailto:mj.prajnan@gmail.com" className="hover:text-text-primary">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
