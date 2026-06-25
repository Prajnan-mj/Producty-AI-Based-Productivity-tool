import { useState } from "react";
import { Navigate } from "react-router-dom";
import useUserStore from "../store/userStore";
import { getGoogleLoginUrl } from "../lib/queries";

export default function Login() {
  const token = useUserStore((s) => s.token);
  const [loading, setLoading] = useState(false);

  // Already logged in — go to dashboard
  if (token) return <Navigate to="/dashboard" replace />;

  const handleLogin = async () => {
    setLoading(true);
    try {
      const data = await getGoogleLoginUrl();
      window.location.href = data.authorization_url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-surface p-8 text-center shadow-xl">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-accent-blue/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="#4F8EF7" strokeWidth={1.5} className="h-7 w-7">
            <path d="M12 6v6l4 2" strokeLinecap="round" />
            <circle cx="12" cy="12" r="10" />
          </svg>
        </div>

        <h1 className="font-display text-2xl font-extrabold text-text-primary">Producty</h1>
        <p className="mt-2 text-sm text-text-muted">
          Your calm command center for deadlines, tasks, and goals.
        </p>

        <button onClick={handleLogin} disabled={loading}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-800 shadow transition hover:bg-gray-50 disabled:opacity-60">
          <svg viewBox="0 0 24 24" className="h-5 w-5">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          {loading ? "Redirecting…" : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}
