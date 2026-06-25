import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useReducedMotion,
  useInView,
  animate,
} from "framer-motion";
import Lenis from "lenis";
import useUserStore from "../store/userStore";

/* ------------------------------------------------------------------ */
/* Shared motion helpers                                               */
/* ------------------------------------------------------------------ */

const EASE = [0.22, 1, 0.36, 1];

function Reveal({ children, delay = 0, y = 28, className = "" }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/* Count-up number that fires when scrolled into view. */
function CountUp({ to, suffix = "", duration = 1.6 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [val, setVal] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setVal(to);
      return;
    }
    const controls = animate(0, to, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setVal(v),
    });
    return () => controls.stop();
  }, [inView, to, duration, reduce]);

  const display = Number.isInteger(to) ? Math.round(val) : val.toFixed(1);
  return (
    <span ref={ref} className="tabular-nums">
      {display}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Decorative app mockups (pure CSS — no screenshots needed)          */
/* ------------------------------------------------------------------ */

function MiniBar({ w, label, done }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border ${
          done ? "border-accent bg-accent" : "border-white/25"
        }`}
      >
        {done && (
          <svg viewBox="0 0 24 24" className="h-3 w-3 text-bg-base" fill="none" stroke="currentColor" strokeWidth={3}>
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={`text-[11px] ${done ? "text-text-muted line-through" : "text-text-primary"}`}>{label}</span>
      <span className="ml-auto h-1.5 rounded-full bg-white/10" style={{ width: w }} />
    </div>
  );
}

function DashboardMock() {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-bg-surface shadow-2xl shadow-black/50">
      {/* window chrome */}
      <div className="flex items-center gap-1.5 border-b border-black/40 bg-bg-elevated px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-accent-red/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
        <span className="ml-3 font-display text-xs font-bold tracking-wide text-text-primary">Producty</span>
        <span className="ml-auto h-6 w-6 rounded-full bg-accent/20" />
      </div>
      <div className="grid grid-cols-[1.1fr_1fr] gap-3 p-4">
        {/* left: today */}
        <div className="space-y-3">
          <div>
            <p className="font-display text-sm font-extrabold text-text-primary">Good morning, Alex</p>
            <p className="text-[10px] text-text-muted">Thursday · 4 tasks due</p>
          </div>
          <div className="space-y-2 rounded-xl bg-bg-base/60 p-3">
            <MiniBar w="34px" label="Ship landing page" done />
            <MiniBar w="48px" label="Reply to professor" />
            <MiniBar w="28px" label="Gym at 6pm" />
            <MiniBar w="40px" label="Draft report" />
          </div>
        </div>
        {/* right: AI + ring */}
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-bg-base/60 p-3">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-text-muted">Focus</p>
              <p className="font-display text-lg font-extrabold text-accent">72%</p>
            </div>
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-full border-4 border-white/10" />
              <div className="absolute inset-0 rounded-full border-4 border-accent border-r-transparent border-b-transparent" />
            </div>
          </div>
          <div className="rounded-xl bg-bg-base/60 p-3">
            <p className="text-[9px] uppercase tracking-wider text-accent">AI Assistant</p>
            <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
              You have a tight afternoon. Start with the report — it's the only thing with a hard deadline.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CaptureMock() {
  return (
    <div className="w-full rounded-2xl border border-white/10 bg-bg-surface p-4 shadow-2xl shadow-black/50">
      <p className="text-[9px] uppercase tracking-wider text-accent">Smart Capture</p>
      <div className="mt-2 rounded-xl bg-bg-base/60 p-3 text-[10px] leading-relaxed text-text-muted">
        "Hi team, please submit the Q3 deck by Friday 5pm and book the review room for Monday."
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Extracting tasks…
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between rounded-lg bg-bg-base/60 px-2.5 py-1.5">
          <span className="text-[10px] text-text-primary">Submit Q3 deck</span>
          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[8px] font-bold text-accent">Fri 5pm</span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-bg-base/60 px-2.5 py-1.5">
          <span className="text-[10px] text-text-primary">Book review room</span>
          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[8px] font-bold text-accent">Mon</span>
        </div>
      </div>
    </div>
  );
}

function EmailMock() {
  return (
    <div className="w-full rounded-2xl border border-white/10 bg-bg-surface p-4 shadow-2xl shadow-black/50">
      <p className="text-[9px] uppercase tracking-wider text-accent">AI Email</p>
      <div className="mt-2 rounded-lg bg-bg-base/60 px-2.5 py-2 text-[10px] text-text-muted">
        "Email Sarah to reschedule our 3pm to Friday"
      </div>
      <div className="mt-2 space-y-1.5 rounded-xl border border-white/5 bg-bg-base/40 p-2.5">
        <p className="text-[10px] text-text-muted">To: <span className="text-text-primary">sarah@acme.com</span></p>
        <p className="text-[10px] text-text-muted">Subject: <span className="text-text-primary">Moving our Thursday sync</span></p>
        <p className="text-[10px] leading-relaxed text-text-primary/90">
          Hi Sarah, something came up at 3pm Thursday — could we move to Friday at the same time? Thanks!
        </p>
      </div>
      <div className="mt-2 flex justify-end">
        <span className="rounded-lg bg-accent px-3 py-1 text-[10px] font-bold text-bg-base">Send</span>
      </div>
    </div>
  );
}

function PanicMock() {
  return (
    <div className="w-full rounded-2xl border border-accent-red/30 bg-bg-surface p-4 shadow-2xl shadow-black/50">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent-red" />
        <p className="text-[9px] uppercase tracking-wider text-accent-red">Panic Mode · 48h survival plan</p>
      </div>
      <div className="mt-3 space-y-2">
        {["Finish lab report — 3h", "Study chapters 4–5 — 2h", "Email TA for extension — 10m"].map((t, i) => (
          <div key={t} className="flex items-center gap-2.5 rounded-lg bg-bg-base/60 px-2.5 py-2">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-bg-base">
              {i + 1}
            </span>
            <span className="text-[10px] text-text-primary">{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "What it does" scroll sections                                      */
/* ------------------------------------------------------------------ */

const STORY = [
  {
    tag: "Capture",
    title: "Paste the chaos. Get a plan.",
    body: "Drop an email, a screenshot, a PDF, or a brain-dump. Producty's AI pulls out every task, deadline, and action — and files it where it belongs.",
    Mock: CaptureMock,
  },
  {
    tag: "Plan",
    title: "Your day, organized before you wake up.",
    body: "Tasks, meetings, and deadlines flow into one calm dashboard. The AI builds a morning-to-evening plan ranked by what actually matters today.",
    Mock: DashboardMock,
  },
  {
    tag: "Act",
    title: "Write and send emails just by asking.",
    body: "“Email Sarah to reschedule.” The AI drafts it in your voice, you review, you send — straight from Gmail, without leaving the app.",
    Mock: EmailMock,
  },
  {
    tag: "Survive",
    title: "Overwhelmed? Hit Panic Mode.",
    body: "When everything is on fire, get an instant 48-hour survival plan that strips your list down to what you can realistically finish — and a shareable link to stay accountable.",
    Mock: PanicMock,
  },
];

function StorySection({ item, index }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [60, -60]);
  const flip = index % 2 === 1;

  return (
    <div ref={ref} className="grid items-center gap-10 py-16 md:grid-cols-2 md:gap-16 md:py-24">
      <Reveal className={flip ? "md:order-2" : ""}>
        <span className="inline-block rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
          {item.tag}
        </span>
        <h3 className="mt-4 font-display text-3xl font-extrabold leading-tight text-text-primary sm:text-4xl">
          {item.title}
        </h3>
        <p className="mt-4 max-w-md text-base leading-relaxed text-text-muted">{item.body}</p>
      </Reveal>

      <motion.div style={{ y }} className={flip ? "md:order-1" : ""}>
        <Reveal delay={0.1}>
          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-accent/10 blur-3xl" />
            <item.Mock />
          </div>
        </Reveal>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bento feature grid                                                  */
/* ------------------------------------------------------------------ */

const BENTO = [
  { title: "Notion-style notes", desc: "Rich editor with slash commands, tables, and AI writing help.", span: "md:col-span-2" },
  { title: "Habit & goal tracking", desc: "Streaks, rings, milestones." },
  { title: "Calendar sync", desc: "Live Google Calendar, auto-categorized." },
  { title: "Focus timer", desc: "Pomodoro that knows what to work on." },
  { title: "Flashcards", desc: "Generated from any document." },
  { title: "Countdown mode", desc: "Exams & interviews with AI prep plans.", span: "md:col-span-2" },
];

function BentoGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {BENTO.map((b, i) => (
        <Reveal key={b.title} delay={i * 0.05} className={b.span || ""}>
          <div className="group h-full rounded-2xl border border-white/10 bg-bg-surface p-6 transition-colors hover:border-accent/40">
            <div className="mb-4 h-10 w-10 rounded-xl bg-accent/15 transition-transform group-hover:scale-110">
              <div className="grid h-full w-full place-items-center text-accent">
                <span className="h-2 w-2 rounded-full bg-accent" />
              </div>
            </div>
            <h4 className="font-display text-lg font-bold text-text-primary">{b.title}</h4>
            <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{b.desc}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Capability marquee                                                  */
/* ------------------------------------------------------------------ */

const MARQUEE = [
  "Tasks", "Deadlines", "Calendar", "Gmail", "AI Plans", "Notes", "Habits",
  "Goals", "Focus", "Panic Mode", "Flashcards", "Documents", "Bills", "Mood",
];

function Marquee() {
  const reduce = useReducedMotion();
  const items = [...MARQUEE, ...MARQUEE];
  return (
    <div className="relative overflow-hidden border-y border-white/5 py-5">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-bg-base to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-bg-base to-transparent" />
      <motion.div
        className="flex w-max gap-8"
        animate={reduce ? {} : { x: ["0%", "-50%"] }}
        transition={{ duration: 28, ease: "linear", repeat: Infinity }}
      >
        {items.map((m, i) => (
          <span key={i} className="flex items-center gap-8 text-lg font-medium text-text-muted/60">
            {m}
            <span className="h-1 w-1 rounded-full bg-accent/50" />
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Landing() {
  const token = useUserStore((s) => s.token);
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  // Scroll progress bar.
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  // Hero parallax.
  const heroRef = useRef(null);
  const { scrollYProgress: heroScroll } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const glowY = useTransform(heroScroll, [0, 1], reduce ? ["0%", "0%"] : ["0%", "40%"]);
  const mockY = useTransform(heroScroll, [0, 1], reduce ? [0, 0] : [0, 120]);
  const mockRotate = useTransform(heroScroll, [0, 1], reduce ? [0, 0] : [0, -4]);

  // Lenis smooth scroll for the marketing page.
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    let raf;
    const loop = (t) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [reduce]);

  // Scrolled state for nav blur.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (token) return <Navigate to="/dashboard" replace />;

  const headline = ["Stop", "organizing.", "Start", "doing."];

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg-base text-text-primary">
      {/* Scroll progress bar */}
      <motion.div
        style={{ scaleX: progress }}
        className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-accent"
      />

      {/* Nav */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
          scrolled ? "border-b border-white/5 bg-bg-base/80 backdrop-blur-md" : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-display text-xl font-extrabold tracking-wide">Producty</span>
          <nav className="hidden items-center gap-8 text-sm text-text-muted md:flex">
            <a href="#how" className="transition-colors hover:text-text-primary">How it works</a>
            <a href="#features" className="transition-colors hover:text-text-primary">Features</a>
            <Link to="/privacy" className="transition-colors hover:text-text-primary">Privacy</Link>
          </nav>
          <button
            onClick={() => navigate("/login")}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent transition hover:opacity-90"
          >
            Sign in
          </button>
        </div>
      </header>

      {/* Hero */}
      <section ref={heroRef} className="relative mx-auto flex min-h-dvh max-w-6xl flex-col items-center justify-center px-6 pt-24 text-center">
        {/* animated glow orbs */}
        <motion.div
          style={{ y: glowY }}
          className="pointer-events-none absolute inset-0 -z-10"
          aria-hidden
        >
          <div className="absolute left-1/2 top-24 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-accent/20 blur-[120px]" />
          <div className="absolute right-10 top-1/2 h-72 w-72 rounded-full bg-accent/10 blur-[100px]" />
          <div className="absolute left-10 bottom-10 h-64 w-64 rounded-full bg-accent/10 blur-[100px]" />
        </motion.div>

        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-accent"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          AI-powered productivity
        </motion.span>

        <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl">
          {headline.map((word, i) => (
            <motion.span
              key={i}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.15 + i * 0.1 }}
              className={`inline-block ${i >= 2 ? "text-accent" : ""} ${i % 2 === 1 ? "mr-0" : "mr-[0.25em]"}`}
            >
              {word}
              {i === 1 && <br />}
              {i < 3 && i !== 1 ? " " : ""}
            </motion.span>
          ))}
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}
          className="mt-6 max-w-xl text-lg leading-relaxed text-text-muted"
        >
          Producty turns scattered tasks, emails, and deadlines into one calm plan —
          and an AI assistant that drafts your emails, breaks down your work, and
          rescues you when it all piles up.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.75 }}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <button
            onClick={() => navigate("/login")}
            className="group flex items-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-sm font-bold text-text-onaccent shadow-lg shadow-accent/20 transition hover:shadow-accent/40"
          >
            Get started with Google
            <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <a
            href="#how"
            className="rounded-xl border border-white/15 px-7 py-3.5 text-sm font-semibold text-text-primary transition hover:border-white/30 hover:bg-white/5"
          >
            See how it works
          </a>
        </motion.div>

        {/* Floating dashboard mock with parallax */}
        <motion.div
          style={{ y: mockY, rotate: mockRotate }}
          initial={{ opacity: 0, y: 60, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, ease: EASE, delay: 0.5 }}
          className="mt-16 w-full max-w-2xl"
        >
          <DashboardMock />
        </motion.div>

        {/* scroll cue */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="mt-10 flex flex-col items-center gap-2 text-text-muted"
        >
          <span className="text-[10px] uppercase tracking-[0.2em]">Scroll</span>
          <motion.span
            animate={reduce ? {} : { y: [0, 6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            className="block h-8 w-5 rounded-full border border-white/20"
          >
            <span className="mx-auto mt-1.5 block h-1.5 w-1 rounded-full bg-accent" />
          </motion.span>
        </motion.div>
      </section>

      {/* Marquee */}
      <Marquee />

      {/* How it works — scroll story */}
      <section id="how" className="mx-auto max-w-6xl px-6">
        <Reveal className="py-16 text-center md:py-24">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">How it works</span>
          <h2 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">
            From mess to momentum,<br />in four moves.
          </h2>
        </Reveal>
        {STORY.map((item, i) => (
          <StorySection key={item.tag} item={item} index={i} />
        ))}
      </section>

      {/* Stats */}
      <section className="border-y border-white/5 bg-bg-surface/30">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-6 py-16 text-center md:grid-cols-4">
          {[
            { to: 12, suffix: "+", label: "Tools in one app" },
            { to: 100, suffix: "%", label: "Free & open source" },
            { to: 70, suffix: "B", label: "LLaMA 3.3 params" },
            { to: 0, suffix: "", label: "Passwords stored", zero: true },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 0.08}>
              <p className="font-display text-4xl font-extrabold text-accent sm:text-5xl">
                {s.zero ? "0" : <CountUp to={s.to} suffix={s.suffix} />}
              </p>
              <p className="mt-2 text-sm text-text-muted">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Bento features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <Reveal className="mb-12 text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">Everything you need</span>
          <h2 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">
            One app. Your whole workflow.
          </h2>
        </Reveal>
        <BentoGrid />
      </section>

      {/* Final CTA */}
      <section className="relative mx-auto max-w-6xl px-6 pb-28">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-bg-surface px-8 py-16 text-center md:py-20">
            <div className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-accent/20 blur-[100px]" />
            <h2 className="relative font-display text-4xl font-extrabold sm:text-5xl">
              Get your time back.
            </h2>
            <p className="relative mx-auto mt-4 max-w-md text-base text-text-muted">
              Sign in with Google and let the AI handle the busywork. Free, forever.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="relative mt-8 inline-flex items-center gap-2 rounded-xl bg-accent px-8 py-4 text-sm font-bold text-text-onaccent shadow-lg shadow-accent/30 transition hover:scale-[1.03]"
            >
              Start free with Google
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5">
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
