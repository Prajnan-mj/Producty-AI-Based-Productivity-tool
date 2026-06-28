import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import useUserStore from "../store/userStore";
import { isAdmin } from "../lib/admin";
import { fetchAdminOverview, fetchAdminDaily, fetchAdminUsers } from "../lib/queries";

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl font-extrabold text-text-primary">{value}</p>
      {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function Admin() {
  const user = useUserStore((s) => s.user);
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(0);
  const limit = 50;

  const overview = useQuery({ queryKey: ["adminOverview"], queryFn: fetchAdminOverview, retry: false });
  const daily = useQuery({ queryKey: ["adminDaily", days], queryFn: () => fetchAdminDaily(days), retry: false });
  const users = useQuery({ queryKey: ["adminUsers", page], queryFn: () => fetchAdminUsers(limit, page * limit), retry: false });

  // Client-side guard; the server still enforces access independently.
  if (user && !isAdmin(user)) return <Navigate to="/dashboard" replace />;

  // If the server rejects us (403), show a clean message rather than a crash.
  const forbidden = overview.error?.response?.status === 403;
  if (forbidden) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-text-primary">Admin only</h1>
        <p className="mt-2 text-sm text-text-muted">You don't have access to this page.</p>
      </div>
    );
  }

  const o = overview.data;
  const chartData = (daily.data || []).map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    registered: d.registered,
    active: d.active,
  }));

  const totalPages = users.data ? Math.ceil(users.data.total / limit) : 1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-extrabold text-text-primary">Admin Analytics</h1>
        <p className="mt-1 text-sm text-text-muted">Usage and registration insights — visible only to you.</p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Users" value={o ? o.total_users : "—"} />
        <StatCard label="Active Today" value={o ? o.active_today : "—"} sub={o ? `${o.active_7d} this week` : ""} />
        <StatCard label="New Today" value={o ? o.new_today : "—"} sub={o ? `${o.new_7d} this week` : ""} />
        <StatCard label="New (30d)" value={o ? o.new_30d : "—"} sub={o ? `${o.active_30d} active 30d` : ""} />
      </div>

      {/* Daily chart */}
      <div className="mt-8 rounded-xl border border-border bg-bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-text-primary">Daily Activity</h2>
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${days === d ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        {daily.isLoading ? (
          <p className="py-12 text-center text-sm text-text-muted">Loading…</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gReg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gAct" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6F7D55" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6F7D55" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
              />
              <Area type="monotone" dataKey="active" name="Active" stroke="#6F7D55" strokeWidth={2} fill="url(#gAct)" />
              <Area type="monotone" dataKey="registered" name="Registered" stroke="var(--accent)" strokeWidth={2} fill="url(#gReg)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <div className="mt-3 flex gap-5 text-xs text-text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" /> Registered</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#6F7D55" }} /> Active</span>
        </div>
      </div>

      {/* Users table */}
      <div className="mt-8 rounded-xl border border-border bg-bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-lg font-bold text-text-primary">
            Users {users.data ? <span className="text-text-muted">({users.data.total})</span> : ""}
          </h2>
          {users.data && totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-lg px-2 py-1 text-text-muted transition hover:text-text-primary disabled:opacity-40">‹ Prev</button>
              <span className="text-xs text-text-muted">{page + 1} / {totalPages}</span>
              <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}
                className="rounded-lg px-2 py-1 text-text-muted transition hover:text-text-primary disabled:opacity-40">Next ›</button>
            </div>
          )}
        </div>

        {users.isLoading ? (
          <p className="py-12 text-center text-sm text-text-muted">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted">
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Joined</th>
                  <th className="px-5 py-3 font-semibold">Last login</th>
                  <th className="px-5 py-3 text-right font-semibold">Days active</th>
                  <th className="px-5 py-3 text-right font-semibold">Tasks</th>
                </tr>
              </thead>
              <tbody>
                {(users.data?.users || []).map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {u.picture_url ? (
                          <img src={u.picture_url} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
                            {(u.name || u.email || "?").trim().charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text-primary">{u.name || "—"}</p>
                          <p className="truncate text-xs text-text-muted">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-text-muted">{fmtDate(u.created_at)}</td>
                    <td className="px-5 py-3 text-text-muted">{fmtDateTime(u.last_login_at)}</td>
                    <td className="px-5 py-3 text-right font-mono text-text-primary">{u.days_active}</td>
                    <td className="px-5 py-3 text-right font-mono text-text-primary">{u.task_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
