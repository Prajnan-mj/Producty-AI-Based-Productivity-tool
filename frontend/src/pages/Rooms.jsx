import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { fetchRooms, createRoom, joinRoom, leaveRoom } from "../lib/queries";

function RoomCard({ room, onLeave }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display text-lg text-text-primary">{room.name}</h3>
          <p className="text-xs text-text-muted">
            Invite code: <span className="font-mono text-accent">{room.code}</span>
            <button onClick={() => { navigator.clipboard.writeText(room.code); toast.success("Code copied"); }}
              className="ml-2 text-[11px] font-semibold text-accent hover:underline">copy</button>
          </p>
        </div>
        <button onClick={() => onLeave(room.id)} className="text-[11px] text-text-muted hover:text-accent-red">Leave</button>
      </div>

      <div className="mt-4 space-y-2">
        {room.members.map((m, i) => (
          <div key={m.user_id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${m.is_you ? "bg-accent/10" : "bg-bg-elevated/50"}`}>
            <span className="w-5 text-center font-mono text-xs text-text-muted">{i + 1}</span>
            <span className="flex-1 text-sm text-text-primary">{m.name}{m.is_you && <span className="ml-1 text-[11px] text-accent">(you)</span>}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-base">
              <div className="h-full rounded-full bg-accent" style={{ width: `${m.completion_rate}%` }} />
            </div>
            <span className="w-10 text-right font-mono text-xs text-text-primary">{m.completion_rate}%</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-text-muted">Completion rate = tasks done ÷ total tasks. Everyone in the room can see it.</p>
    </motion.div>
  );
}

export default function Rooms() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const roomsQ = useQuery({ queryKey: ["rooms"], queryFn: fetchRooms });

  const createMut = useMutation({
    mutationFn: () => createRoom(name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); setName(""); toast.success("Room created"); },
    onError: () => toast.error("Couldn't create room"),
  });
  const joinMut = useMutation({
    mutationFn: () => joinRoom(code.trim().toUpperCase()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); setCode(""); toast.success("Joined room"); },
    onError: () => toast.error("No room with that code"),
  });
  const leaveMut = useMutation({
    mutationFn: leaveRoom,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rooms"] }); toast.success("Left room"); },
  });

  const rooms = roomsQ.data || [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-8 space-y-6">
      <div>
        <h1 className="font-display text-2xl text-text-primary">Accountability Rooms</h1>
        <p className="mt-1 text-sm text-text-muted">Like a study group for adulting — everyone sees everyone's completion rate.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Create a room</p>
          <div className="mt-2 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name"
              className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
            <button onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent disabled:opacity-50">Create</button>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Join with a code</p>
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 7K2QPX"
              className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 font-mono text-sm uppercase text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
            <button onClick={() => joinMut.mutate()} disabled={!code.trim() || joinMut.isPending}
              className="rounded-lg bg-bg-elevated px-4 py-2 text-sm font-semibold text-text-primary hover:brightness-110 disabled:opacity-50">Join</button>
          </div>
        </div>
      </div>

      {roomsQ.isLoading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : rooms.length === 0 ? (
        <div className="rounded-2xl border border-border bg-bg-surface p-8 text-center text-sm text-text-muted">
          You're not in any rooms yet. Create one and share the code with friends.
        </div>
      ) : (
        <div className="space-y-4">
          {rooms.map((r) => <RoomCard key={r.id} room={r} onLeave={leaveMut.mutate} />)}
        </div>
      )}
    </div>
  );
}
