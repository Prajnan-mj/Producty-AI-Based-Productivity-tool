import { useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";

const TEXT_COLORS = [
  "#e7eaed", "#8a929b", "#ffb000", "#ffc04d", "#ff4d4d", "#b07a1e",
  "#4d7c8a", "#6fb0c4", "#5a6470", "#c9ccd1", "#7fae8a", "#d98a4a",
  "#cf5b5b", "#9aa2ab", "#3a414a", "#b8bcc2",
];
const HIGHLIGHTS = [
  "rgba(255,176,0,0.22)", "rgba(255,77,77,0.20)", "rgba(77,124,138,0.26)",
  "rgba(176,122,30,0.24)", "rgba(90,100,112,0.30)", "rgba(255,192,77,0.18)",
  "rgba(231,234,237,0.10)", "rgba(138,146,155,0.18)",
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
