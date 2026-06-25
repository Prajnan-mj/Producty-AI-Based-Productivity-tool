import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { motion, useScroll, useSpring, useReducedMotion, useInView, animate } from "framer-motion";
import useUserStore from "../store/userStore";

/* ------------------------------------------------------------------ */
/* Motion helpers                                                      */
/* ------------------------------------------------------------------ */

const EASE = [0.22, 1, 0.36, 1];

function Reveal({ children, delay = 0, y = 24, className = "" }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: 0.65, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

function CountUp({ to, suffix = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [val, setVal] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!inView) return;
    if (reduce) return setVal(to);
    const c = animate(0, to, { duration: 1.4, ease: "easeOut", onUpdate: setVal });
    return () => c.stop();
  }, [inView, to, reduce]);
  return <span ref={ref} className="tabular-nums">{Math.round(val)}{suffix}</span>;
}

/* Matted-print frame so the cream sketches read as gallery art, not stock. */
function Plate({ src, alt, className = "" }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-[#f3eee4] p-1.5 shadow-[0_30px_70px_-25px_rgba(27,26,23,0.3)] ${className}`}>
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-xl object-cover" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

const STORY = [
  {
    tag: "Capture & Plan",
    title: "Paste the chaos. Get a plan.",
    body: "Drop an email, a screenshot, or a brain-dump. Producty's AI pulls out every task and deadline, then lays your day out from morning to evening — ranked by what actually matters.",
    img: "/art-working-desk.png",
    alt: "Planning the day at a desk",
  },
  {
    tag: "Learn & Grow",
    title: "Turn effort into momentum.",
    body: "Habits, goals, flashcards, and a Notion-style notebook — all in one place. Track streaks, hit milestones, and let the AI help you study and write.",
    img: "/art-knowledge-tree.png",
    alt: "Knowledge growing like a tree from books",
  },
  {
    tag: "Connect & Act",
    title: "Your calendar and inbox, handled.",
    body: "Google Calendar and Gmail flow in automatically. Actionable emails become tasks, and the AI drafts and sends replies on your behalf — you just review.",
    img: "/art-network.png",
    alt: "Two people connected by a network",
  },
];

const FEATURES = [
  { title: "Smart tasks & deadlines", body: "AI breakdowns, urgency ranking, a clear view of next.", span: "md:col-span-2" },
  { title: "Calendar & Gmail sync", body: "Live meetings, emails turned into tasks." },
  { title: "AI email writing", body: "Describe it, review the draft, send from Gmail." },
  { title: "Notion-style notes", body: "Slash commands, tables, AI writing help." },
  { title: "Focus, habits & goals", body: "Pomodoro, streaks, milestone progress.", span: "md:col-span-2" },
];

const STATS = [
  { to: 12, suffix: "+", label: "Tools in one app" },
  { to: 100, suffix: "%", label: "Free & open source" },
  { to: 70, suffix: "B", label: "LLaMA 3.3 parameters" },
  { to: 0, suffix: "", label: "Passwords stored", zero: true },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Landing() {
  const token = useUserStore((s) => s.token);
  const navigate = useNavigate();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (token) return <Navigate to="/dashboard" replace />;

  return (
    <div className="relative min-h-dvh bg-bg-base text-text-primary">
      <motion.div style={{ scaleX: progress }} className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-accent" />

      {/* Nav */}
      <header className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${scrolled ? "border-b border-border bg-bg-base/85 backdrop-blur-md" : "bg-transparent"}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-display text-xl font-extrabold tracking-tight">Producty</span>
          <nav className="hidden items-center gap-8 text-sm text-text-muted md:flex">
            <a href="#how" className="transition-colors hover:text-text-primary">How it works</a>
            <a href="#features" className="transition-colors hover:text-text-primary">Features</a>
            <Link to="/privacy" className="transition-colors hover:text-text-primary">Privacy</Link>
          </nav>
          <button onClick={() => navigate("/login")}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-text-onaccent transition hover:opacity-90">
            Sign in
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-6 pb-12 pt-36 text-center">
        <div className="pointer-events-none absolute left-1/2 top-20 -z-10 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" aria-hidden />
        <motion.span
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}
          className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/8 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> AI-powered productivity
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, ease: EASE, delay: 0.08 }}
          className="mx-auto mt-7 max-w-3xl font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
          Stop organizing.<br /><span className="text-accent">Start doing.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.18 }}
          className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-text-muted">
          Producty turns scattered tasks, emails, and deadlines into one calm plan — with an
          AI assistant that drafts your emails, breaks down your work, and rescues you when it piles up.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.28 }}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button onClick={() => navigate("/login")}
            className="group flex items-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-sm font-bold text-text-onaccent shadow-lg shadow-accent/15 transition hover:shadow-accent/30">
            Get started with Google
            <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <a href="#how" className="rounded-xl border border-border px-7 py-3.5 text-sm font-semibold text-text-primary transition hover:bg-bg-elevated">
            See how it works
          </a>
        </motion.div>

        {/* Hero showpiece — the branded sketch banner */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.4 }}
          className="mx-auto mt-16 max-w-4xl">
          <Plate src="/art-hero-banner.png" alt="Producty — working and learning" />
        </motion.div>
      </section>

      {/* How it works — alternating image / text */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <Reveal className="text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">How it works</span>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">From mess to momentum.</h2>
        </Reveal>

        <div className="mt-16 space-y-20 md:space-y-28">
          {STORY.map((s, i) => {
            const flip = i % 2 === 1;
            return (
              <div key={s.tag} className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
                <Reveal className={flip ? "md:order-2" : ""}>
                  <span className="inline-block rounded-full border border-accent/30 bg-accent/8 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">{s.tag}</span>
                  <h3 className="mt-4 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{s.title}</h3>
                  <p className="mt-4 max-w-md text-base leading-relaxed text-text-muted">{s.body}</p>
                </Reveal>
                <Reveal delay={0.1} className={flip ? "md:order-1" : ""}>
                  <Plate src={s.img} alt={s.alt} />
                </Reveal>
              </div>
            );
          })}
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-bg-surface">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-6 py-16 text-center md:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.07}>
              <p className="font-display text-4xl font-extrabold text-accent sm:text-5xl">
                {s.zero ? "0" : <CountUp to={s.to} suffix={s.suffix} />}
              </p>
              <p className="mt-2 text-sm text-text-muted">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="mb-12 grid items-center gap-8 md:grid-cols-[1.3fr_1fr]">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-accent">Everything you need</span>
            <h2 className="mt-3 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">One app. Your whole workflow.</h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-text-muted">
              No more juggling six tools. Tasks, calendar, notes, habits, and an AI assistant — together, and free.
            </p>
          </div>
          <Plate src="/art-icons.png" alt="A toolkit of productivity essentials" />
        </Reveal>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.05} className={f.span || ""}>
              <div className="group h-full rounded-2xl border border-border bg-bg-surface p-6 transition-shadow hover:shadow-[0_12px_40px_-16px_rgba(27,26,23,0.25)]">
                <div className="mb-4 grid h-9 w-9 place-items-center rounded-lg bg-accent/12">
                  <span className="h-2 w-2 rounded-full bg-accent" />
                </div>
                <h3 className="font-display text-lg font-bold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-bg-surface px-8 py-16 text-center shadow-[0_30px_80px_-30px_rgba(27,26,23,0.3)] md:py-20">
            <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/15 blur-[100px]" aria-hidden />
            <h2 className="relative font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Get your time back.</h2>
            <p className="relative mx-auto mt-4 max-w-md text-base text-text-muted">
              Sign in with Google and let the AI handle the busywork. Free, forever.
            </p>
            <button onClick={() => navigate("/login")}
              className="relative mt-8 inline-flex items-center gap-2 rounded-xl bg-accent px-8 py-4 text-sm font-bold text-text-onaccent shadow-lg shadow-accent/20 transition hover:scale-[1.02]">
              Start free with Google
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-xs text-text-muted sm:flex-row">
          <span className="font-display text-base font-extrabold text-text-primary">Producty</span>
          <span>© 2026 Producty. Built with care.</span>
          <div className="flex gap-5">
            <Link to="/privacy" className="hover:text-text-primary">Privacy</Link>
            <Link to="/terms" className="hover:text-text-primary">Terms</Link>
            <a href="mailto:mj.prajnan@gmail.com" className="hover:text-text-primary">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
