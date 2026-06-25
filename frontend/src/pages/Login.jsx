import { useState } from "react";
import { Navigate } from "react-router-dom";
import useUserStore from "../store/userStore";
import { getGoogleLoginUrl } from "../lib/queries";

export default function Login() {
  const token = useUserStore((s) => s.token);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (token) return <Navigate to="/dashboard" replace />;

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getGoogleLoginUrl();
      if (data?.authorization_url) {
        window.location.href = data.authorization_url;
      } else {
        setError("No authorization URL received from server.");
        setLoading(false);
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Could not reach the server.";
      setError(msg);
      setLoading(false);
    }
  };

  const googleButton = (
    <>
      <button onClick={handleLogin} disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-800 shadow transition hover:bg-gray-50 disabled:opacity-60">
        <svg viewBox="0 0 24 24" className="h-5 w-5">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        {loading ? "Redirecting…" : "Sign in with Google"}
      </button>
      {error && <p className="mt-4 text-xs text-accent-red">{error}</p>}
    </>
  );

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Left — artwork panel (desktop only) */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-[#f3eee4] p-10 lg:flex">
        <span className="font-display text-xl font-extrabold tracking-tight text-text-primary">Producty</span>
        <img src="/art-working-desk.png" alt="Planning the day at a desk"
          className="mx-auto w-full max-w-md rounded-2xl border border-border object-cover shadow-[0_30px_70px_-25px_rgba(27,26,23,0.35)]" />
        <p className="max-w-sm text-sm leading-relaxed text-text-muted">
          One calm place for your tasks, calendar, notes, and goals — with an AI assistant
          that plans your day and drafts your emails.
        </p>
      </div>

      {/* Right — sign-in card */}
      <div className="flex items-center justify-center bg-bg-base px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={1.5} className="h-7 w-7">
              <path d="M12 6v6l4 2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="10" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-extrabold text-text-primary">Welcome to Producty</h1>
          <p className="mt-2 text-sm text-text-muted">
            Your calm command center for deadlines, tasks, and goals.
          </p>
          <div className="mt-8">{googleButton}</div>
          <p className="mt-6 text-[11px] leading-relaxed text-text-muted">
            By continuing you agree to our{" "}
            <a href="/terms" className="text-accent hover:underline">Terms</a> and{" "}
            <a href="/privacy" className="text-accent hover:underline">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
