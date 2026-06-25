import { useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";

const TEXT_COLORS = [
  "#ffffff", "#b0b0b0", "#ffc815", "#ffd75e", "#e5484d", "#f08a8a",
  "#6fd0a8", "#7fe0b6", "#7fa7f5", "#8fb2fa", "#b69cf2", "#c3abfb",
  "#f5a97f", "#f7c59f", "#e0e0e0", "#888888",
];
const HIGHLIGHTS = [
  "rgba(255,200,21,0.30)", "rgba(229,72,77,0.28)", "rgba(111,208,168,0.28)",
  "rgba(127,167,245,0.28)", "rgba(182,156,242,0.28)", "rgba(245,169,127,0.28)",
  "rgba(255,255,255,0.16)", "rgba(176,176,176,0.22)",
];

function Btn({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm transition ${
        active ? "bg-accent text-text-onaccent" : "text-text-primary hover:bg-bg-elevated"
      }`}
    >
      {children}
    </button>
  );
}

export default function BubbleToolbar({ editor }) {
  const [panel, setPanel] = useState(null); // "color" | "highlight" | null

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes("link").href || "";
    const url = window.prompt("Link URL", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  return (
    <BubbleMenu editor={editor} options={{ placement: "top", offset: 8 }}>
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-bg-elevated p-1 shadow-2xl">
        <div className="flex items-center gap-0.5">
          <Btn title="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
          <Btn title="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><i>i</i></Btn>
          <Btn title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
          <Btn title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
          <Btn title="Inline code (Ctrl+E)" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>{"</>"}</Btn>
          <Btn title="Link (Ctrl+K)" active={editor.isActive("link")} onClick={setLink}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4"><path d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10.34 5.5M14 11a5 5 0 00-7.07 0L5.5 12.4a5 5 0 007.07 7.07L13.66 18.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </Btn>
          <Btn title="Text color" active={panel === "color"} onClick={() => setPanel(panel === "color" ? null : "color")}>A</Btn>
          <Btn title="Highlight (Ctrl+Shift+H)" active={editor.isActive("highlight") || panel === "highlight"} onClick={() => setPanel(panel === "highlight" ? null : "highlight")}>
            <span className="rounded-sm bg-accent/40 px-1">H</span>
          </Btn>
        </div>

        {panel === "color" && (
          <div className="flex max-w-[224px] flex-wrap gap-1 border-t border-border p-1.5">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().unsetColor().run(); setPanel(null); }}
              className="h-5 w-5 rounded border border-border text-[9px] text-text-muted">×</button>
            {TEXT_COLORS.map((c) => (
              <button key={c} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { editor.chain().focus().setColor(c).run(); setPanel(null); }}
                className="h-5 w-5 rounded border border-border" style={{ background: c }} />
            ))}
          </div>
        )}

        {panel === "highlight" && (
          <div className="flex max-w-[224px] flex-wrap gap-1 border-t border-border p-1.5">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().unsetHighlight().run(); setPanel(null); }}
              className="h-5 w-5 rounded border border-border text-[9px] text-text-muted">×</button>
            {HIGHLIGHTS.map((c) => (
              <button key={c} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { editor.chain().focus().setHighlight({ color: c }).run(); setPanel(null); }}
                className="h-5 w-5 rounded border border-border" style={{ background: c }} />
            ))}
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
