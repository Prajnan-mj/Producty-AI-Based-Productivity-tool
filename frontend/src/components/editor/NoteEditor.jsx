import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Typography } from "@tiptap/extension-typography";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { CharacterCount } from "@tiptap/extension-character-count";
import { common, createLowlight } from "lowlight";
import { useMutation } from "@tanstack/react-query";

import { CodeBlock } from "./CodeBlock";
import { Callout } from "./Callout";
import { Toggle } from "./Toggle";
import { SlashCommand } from "./SlashCommand";
import BubbleToolbar from "./BubbleToolbar";
import ExportMenu from "./ExportMenu";
import EditorAIPanel from "./EditorAIPanel";
import EmojiPicker from "./EmojiPicker";
import { updateNote } from "../../lib/queries";

const lowlight = createLowlight(common);

const GRADIENTS = [
  "linear-gradient(135deg,#3a2f1a,#292929)",
  "linear-gradient(135deg,#2a3340,#292929)",
  "linear-gradient(135deg,#33222e,#292929)",
  "linear-gradient(135deg,#23332b,#292929)",
  "linear-gradient(135deg,#2e2a3a,#292929)",
  "linear-gradient(135deg,#3a2424,#292929)",
];

function relativeTime(d) {
  if (!d) return "";
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
}

// Parse stored content into a Tiptap doc, wrapping legacy plain text.
function parseContent(raw) {
  if (!raw) return { type: "doc", content: [{ type: "paragraph" }] };
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.type === "doc") return obj;
  } catch { /* legacy plain text */ }
  return {
    type: "doc",
    content: String(raw).split("\n").map((line) =>
      line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" }
    ),
  };
}

export default function NoteEditor({ note, breadcrumb = [], onMeta }) {
  const [title, setTitle] = useState(note.title || "");
  const [emoji, setEmoji] = useState(note.emoji || "📄");
  const [cover, setCover] = useState(note.cover_gradient || null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showCover, setShowCover] = useState(false);
  const [status, setStatus] = useState("saved"); // saving | saved | offline
  const [lastEdited, setLastEdited] = useState(note.updated_at);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });

  const contentRef = useRef(null);
  const saveTimer = useRef(null);
  const titleRef = useRef(null);
  // Latest metadata, so the editor's once-bound onUpdate never saves stale title/emoji.
  const metaRef = useRef({ title, emoji, cover });
  useEffect(() => { metaRef.current = { title, emoji, cover }; }, [title, emoji, cover]);

  const saveMut = useMutation({
    mutationFn: (payload) => updateNote(note.id, payload),
    onSuccess: () => {
      setStatus("saved");
      setLastEdited(new Date().toISOString());
      onMeta?.({ id: note.id, title, emoji });
    },
    onError: () => {
      setStatus("offline");
      try {
        localStorage.setItem(`note-draft-${note.id}`, JSON.stringify({ title, emoji, content: editor?.getJSON() }));
      } catch { /* ignore quota */ }
    },
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // replaced by lowlight code block
        link: { openOnClick: false, autolink: true, HTMLAttributes: { class: "note-link" } },
      }),
      CodeBlock.configure({ lowlight }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
      CharacterCount,
      Callout,
      Toggle,
      SlashCommand,
      Placeholder.configure({
        placeholder: "Type '/' for commands, or just start writing…",
      }),
    ],
    content: parseContent(note.content),
    autofocus: false,
    onUpdate: ({ editor }) => {
      setCounts({ words: editor.storage.characterCount.words(), chars: editor.storage.characterCount.characters() });
      scheduleSave();
    },
    onCreate: ({ editor }) => {
      setCounts({ words: editor.storage.characterCount.words(), chars: editor.storage.characterCount.characters() });
    },
  });

  const scheduleSave = useCallback(() => {
    setStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!editor) return;
      const m = metaRef.current;
      saveMut.mutate({
        title: m.title || "Untitled",
        emoji: m.emoji,
        cover_gradient: m.cover,
        content: JSON.stringify(editor.getJSON()),
        word_count: editor.storage.characterCount.words(),
      });
    }, 2000);
  }, [editor]); // editor identity is stable; metadata read from ref

  // Save title/emoji/cover changes too.
  useEffect(() => { if (editor) scheduleSave(); }, [title, emoji, cover]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const statusLabel = { saving: "Saving…", saved: "All changes saved", offline: "Offline — saved locally" }[status];

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-2.5">
        <nav className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
          {breadcrumb.map((b, i) => (
            <span key={i} className="truncate">{b}{i < breadcrumb.length - 1 ? " / " : ""}</span>
          ))}
          <span className="truncate text-text-primary">{breadcrumb.length ? " / " : ""}{title || "Untitled"}</span>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className={`text-[11px] ${status === "offline" ? "text-accent-red" : "text-text-muted"}`}>{statusLabel}</span>
          <span className="text-[11px] text-text-muted">·</span>
          <span className="text-[11px] text-text-muted">{counts.words} words</span>
          <ExportMenu editor={editor} title={title} contentRef={contentRef} />
          <EditorAIPanel editor={editor} noteId={note.id} />
        </div>
      </div>

      {/* Scrollable page */}
      <div className="flex-1 overflow-y-auto">
        {/* Cover */}
        {cover && (
          <div className="relative h-32 w-full" style={{ background: cover }}>
            <button onClick={() => setCover(null)}
              className="absolute right-3 top-3 rounded-md bg-black/40 px-2 py-1 text-[11px] text-white hover:bg-black/60">Remove cover</button>
          </div>
        )}

        <div ref={contentRef} className="note-editor mx-auto max-w-[720px] px-6 py-8">
          {/* Header */}
          <div className="relative mb-3">
            <button onClick={() => setShowEmoji((s) => !s)} className="text-5xl leading-none hover:opacity-80">{emoji}</button>
            {showEmoji && <EmojiPicker onSelect={setEmoji} onClose={() => setShowEmoji(false)} />}
          </div>

          {!cover && (
            <div className="relative mb-2">
              <button onClick={() => setShowCover((s) => !s)} className="text-xs text-text-muted hover:text-text-primary">+ Add cover</button>
              {showCover && (
                <div className="absolute z-50 mt-1 flex gap-1.5 rounded-xl border border-border bg-bg-surface p-2 shadow-2xl">
                  {GRADIENTS.map((g) => (
                    <button key={g} onClick={() => { setCover(g); setShowCover(false); }}
                      className="h-8 w-12 rounded-md border border-border" style={{ background: g }} />
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); } }}
            rows={1}
            placeholder="Untitled"
            className="w-full resize-none bg-transparent font-display text-4xl font-bold leading-tight text-text-primary placeholder:text-text-muted/50 focus:outline-none"
          />

          <p className="mb-6 mt-1 text-[11px] text-text-muted">
            {counts.words} words · {counts.chars} characters · Edited {relativeTime(lastEdited)}
          </p>

          {editor && <BubbleToolbar editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
