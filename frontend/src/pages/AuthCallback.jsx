import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import useUserStore from "../store/userStore";
import api from "../lib/api";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setToken = useUserStore((s) => s.setToken);
  const setUser = useUserStore((s) => s.setUser);
  const [error, setError] = useState(null);
  const exchanged = useRef(false);

  useEffect(() => {
    // Guard against StrictMode double-mount
    if (exchanged.current) return;
    exchanged.current = true;

    const code = searchParams.get("code");
    if (!code) {
      navigate("/login", { replace: true });
      return;
    }

    api.post("/auth/google/exchange", { code })
      .then(async (res) => {
        setToken(res.data.access_token);
        // Fetch the signed-in user's real profile (name, email, picture).
        try {
          const me = await api.get("/auth/me");
          setUser(me.data);
        } catch {
          // Non-fatal — dashboard falls back to a generic greeting.
        }
        navigate("/dashboard", { replace: true });
      })
      .catch(() => {
        setError("Sign-in failed. Please try again.");
        setTimeout(() => navigate("/login", { replace: true }), 2000);
      });
  }, [searchParams, setToken, setUser, navigate]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-base">
      {error ? (
        <p className="text-sm text-accent-red">{error}</p>
      ) : (
        <p className="text-sm text-text-muted animate-pulse">Signing you in…</p>
      )}
    </div>
  );
}
