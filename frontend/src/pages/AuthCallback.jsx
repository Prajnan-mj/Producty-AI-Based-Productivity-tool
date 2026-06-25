import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import useUserStore from "../store/userStore";
import api from "../lib/api";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setToken = useUserStore((s) => s.setToken);
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
      .then((res) => {
        setToken(res.data.access_token);
        navigate("/dashboard", { replace: true });
      })
      .catch(() => {
        setError("Sign-in failed. Please try again.");
        setTimeout(() => navigate("/login", { replace: true }), 2000);
      });
  }, [searchParams, setToken, navigate]);

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
