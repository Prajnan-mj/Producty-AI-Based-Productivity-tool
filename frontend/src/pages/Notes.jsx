import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  fetchFolders, createFolder, deleteFolder,
  fetchNotes, createNote, deleteNote, duplicateNote, toggleNoteFavorite, updateNote,
} from "../lib/queries";
import NoteEditor from "../components/editor/NoteEditor";

/* ---------------------------------------------------------------- */
/* Folder name modal                                                 */
/* ---------------------------------------------------------------- */

function FolderModal({ open, onClose, onCreate, parentName }) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm rounded-2xl border border-border bg-bg-surface p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-text-primary">
          New folder {parentName ? <span className="text-text-muted">in {parentName}</span> : ""}
        </h2>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onCreate(name.trim()); }}
          placeholder="Folder name"
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={() => name.trim() && onCreate(name.trim())} disabled={!name.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-text-onaccent disabled:opacity-50">Create</button>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Recursive folder node                                             */
/* ---------------------------------------------------------------- */

function FolderNode({ folder, allFolders, depth, selectedId, onSelect, onAddSub, onDelete }) {
  const children = useMemo(() => allFolders.filter((f) => f.parent_id === folder.id), [allFolders, folder.id]);
  const [open, setOpen] = useState(true);
  const active = selectedId === folder.id;

  return (
    <div>
      <div className="group flex items-center gap-1 rounded-lg pr-1" style={{ paddingLeft: depth * 12 }}>
        <button onClick={() => setOpen((o) => !o)} className="flex h-5 w-5 items-center justify-center text-text-muted">
          {children.length > 0 ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}>
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : <span className="h-1 w-1 rounded-full bg-text-muted/40" />}
        </button>
        <button onClick={() => onSelect(folder.id)}
          className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm transition ${active ? "bg-accent text-text-onaccent font-semibold" : "text-text-primary hover:bg-bg-elevated"}`}>
          {folder.name}
        </button>
        <button onClick={() => onAddSub(folder.id)} title="Add subfolder"
          className="px-1 text-text-muted opacity-0 transition hover:text-accent group-hover:opacity-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
        </button>
        <button onClick={() => onDelete(folder)} title="Delete folder"
          className="px-1 text-text-muted opacity-0 transition hover:text-accent-red group-hover:opacity-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5"><path d="M19 7l-.9 12.1A2 2 0 0116.1 21H7.9a2 2 0 01-2-1.9L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {open && children.map((c) => (
        <FolderNode key={c.id} folder={c} allFolders={allFolders} depth={depth + 1}
          selectedId={selectedId} onSelect={onSelect} onAddSub={onAddSub} onDelete={onDelete} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Note row                                                          */
/* ---------------------------------------------------------------- */

function NoteRow({ note, active, onOpen, onContext }) {
  return (
    <button onClick={() => onOpen(note.id)} onContextMenu={(e) => onContext(e, note)}
      className={`block w-full rounded-lg px-3 py-2 text-left transition ${active ? "bg-bg-elevated" : "hover:bg-bg-elevated/60"}`}>
      <p className="flex items-center gap-2 truncate text-sm font-medium text-text-primary">
        <span>{note.emoji || "📄"}</span>
        <span className="truncate">{note.title || "Untitled"}</span>
        {note.is_favorite && <span className="ml-auto text-accent">★</span>}
      </p>
    </button>
  );
}

/* ---------------------------------------------------------------- */
/* Page                                                              */
/* ---------------------------------------------------------------- */

export default function Notes() {
  const qc = useQueryClient();
  const [selectedFolder, setSelectedFolder] = useState(null); // null = all
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [folderModal, setFolderModal] = useState({ open: false, parentId: null });
  const [ctx, setCtx] = useState(null); // { x, y, note }
  const [mobileOpen, setMobileOpen] = useState(false);

  const foldersQ = useQuery({ queryKey: ["folders"], queryFn: fetchFolders });
  const notesQ = useQuery({ queryKey: ["notes"], queryFn: () => fetchNotes() });

  const folders = foldersQ.data || [];
  const allNotes = notesQ.data || [];
  const rootFolders = folders.filter((f) => !f.parent_id);
  const favorites = allNotes.filter((n) => n.is_favorite);
  const visibleNotes = selectedFolder ? allNotes.filter((n) => n.folder_id === selectedFolder) : allNotes;
  const selectedNote = allNotes.find((n) => n.id === selectedNoteId) || null;

  useEffect(() => {
    const close = () => setCtx(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const folderName = (id) => folders.find((f) => f.id === id)?.name;

  const openNote = (id) => { setSelectedNoteId(id); setMobileOpen(false); };

  // ---- mutations ----
  const createFolderMut = useMutation({
    mutationFn: createFolder,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["folders"] }); setFolderModal({ open: false, parentId: null }); toast.success("Folder created"); },
    onError: () => toast.error("Couldn't create folder"),
  });
  const deleteFolderMut = useMutation({
    mutationFn: deleteFolder,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["folders"] }); qc.invalidateQueries({ queryKey: ["notes"] }); setSelectedFolder(null); toast.success("Folder deleted"); },
  });
  const createNoteMut = useMutation({
    mutationFn: () => createNote({ title: "Untitled", content: "", folder_id: selectedFolder }),
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["notes"] }); openNote(n.id); },
  });
  const favMut = useMutation({ mutationFn: toggleNoteFavorite, onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }) });
  const dupMut = useMutation({
    mutationFn: duplicateNote,
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["notes"] }); toast.success("Duplicated"); openNote(n.id); },
  });
  const delMut = useMutation({
    mutationFn: deleteNote,
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ["notes"] }); if (selectedNoteId === id) setSelectedNoteId(null); toast.success("Note deleted"); },
  });
  const renameMut = useMutation({
    mutationFn: ({ id, title }) => updateNote(id, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  const askDeleteFolder = (folder) => { if (confirm(`Delete "${folder.name}" and everything inside it?`)) deleteFolderMut.mutate(folder.id); };

  const onContext = (e, note) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, note }); };

  const rename = (note) => {
    const t = window.prompt("Rename note", note.title || "Untitled");
    if (t != null) renameMut.mutate({ id: note.id, title: t.trim() || "Untitled" });
  };

  // Keep sidebar titles/emoji in sync with the editor without refetching.
  const onMeta = ({ id, title, emoji }) => {
    qc.setQueryData(["notes"], (old) => (old || []).map((n) => (n.id === id ? { ...n, title, emoji } : n)));
  };

  const Sidebars = (
    <>
      {/* Folder tree */}
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border p-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="font-display text-base text-text-primary">Notes</span>
          <button onClick={() => setFolderModal({ open: true, parentId: null })}
            className="rounded-md bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20">+ Folder</button>
        </div>

        {favorites.length > 0 && (
          <div className="mb-3">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Favorites</p>
            {favorites.map((n) => (
              <NoteRow key={n.id} note={n} active={selectedNoteId === n.id} onOpen={openNote} onContext={onContext} />
            ))}
          </div>
        )}

        <button onClick={() => setSelectedFolder(null)}
          className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${selectedFolder === null ? "bg-accent text-text-onaccent font-semibold" : "text-text-primary hover:bg-bg-elevated"}`}>
          All notes
        </button>

        {rootFolders.map((f) => (
          <FolderNode key={f.id} folder={f} allFolders={folders} depth={0}
            selectedId={selectedFolder} onSelect={setSelectedFolder}
            onAddSub={(pid) => setFolderModal({ open: true, parentId: pid })}
            onDelete={askDeleteFolder} />
        ))}
      </aside>

      {/* Note list */}
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border p-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            {selectedFolder ? folderName(selectedFolder) : "All notes"}
          </span>
          <button onClick={() => createNoteMut.mutate()}
            className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-text-onaccent hover:brightness-105">+ Note</button>
        </div>
        {notesQ.isLoading ? (
          <p className="px-1 py-4 text-xs text-text-muted">Loading…</p>
        ) : visibleNotes.length === 0 ? (
          <p className="px-1 py-4 text-xs text-text-muted">No notes here yet.</p>
        ) : (
          <div className="space-y-1">
            {visibleNotes.map((n) => (
              <NoteRow key={n.id} note={n} active={selectedNoteId === n.id} onOpen={openNote} onContext={onContext} />
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-[100dvh]">
      {/* Desktop sidebars */}
      <div className="hidden md:flex">{Sidebars}</div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex bg-bg-base">{Sidebars}</div>
          <div className="flex-1 bg-black/60" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Editor */}
      <div className="relative flex-1 overflow-hidden">
        <button onClick={() => setMobileOpen(true)}
          className="absolute left-16 top-3 z-20 rounded-lg bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-text-primary md:hidden">
          ☰ Notes
        </button>
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            breadcrumb={[selectedNote.folder_id ? folderName(selectedNote.folder_id) : "All notes"].filter(Boolean)}
            onMeta={onMeta}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center text-text-muted">
            <p className="text-sm">Select a note, or create a new one.</p>
            <p className="mt-1 text-xs">Type <span className="font-mono text-accent">/</span> in a note for blocks. Use the voice button (bottom-left) to dictate.</p>
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctx && (
        <div className="fixed z-[90] w-44 rounded-xl border border-border bg-bg-surface p-1 shadow-2xl"
          style={{ top: ctx.y, left: ctx.x }} onClick={(e) => e.stopPropagation()}>
          {[
            ["Rename", () => rename(ctx.note)],
            ["Duplicate", () => dupMut.mutate(ctx.note.id)],
            [ctx.note.is_favorite ? "Remove favorite" : "Add to favorites", () => favMut.mutate(ctx.note.id)],
            ["Delete", () => delMut.mutate(ctx.note.id), true],
          ].map(([label, fn, danger]) => (
            <button key={label} onClick={() => { fn(); setCtx(null); }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-bg-elevated ${danger ? "text-accent-red" : "text-text-primary"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      <FolderModal
        open={folderModal.open}
        parentName={folderModal.parentId ? folderName(folderModal.parentId) : null}
        onClose={() => setFolderModal({ open: false, parentId: null })}
        onCreate={(name) => createFolderMut.mutate({ name, parent_id: folderModal.parentId })}
      />
    </div>
  );
}
