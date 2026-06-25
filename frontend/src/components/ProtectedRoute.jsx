import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import useUserStore from "../store/userStore";
import api from "../lib/api";

export default function ProtectedRoute({ children }) {
  const token = useUserStore((s) => s.token);
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);

  // If we have a token but no cached profile (e.g. logged in before this
  // feature existed), fetch the real user so greetings show their name.
  useEffect(() => {
    if (token && !user) {
      api.get("/auth/me").then((res) => setUser(res.data)).catch(() => {});
    }
  }, [token, user, setUser]);

  if (!token) return <Navigate to="/login" replace />;
  return children;
}
