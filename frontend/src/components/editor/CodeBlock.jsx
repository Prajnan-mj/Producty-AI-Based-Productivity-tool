import { useState } from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";

const LANGS = ["plaintext", "javascript", "typescript", "python", "bash", "sql", "json", "html", "css", "java", "cpp", "go", "rust"];

function CodeBlockView({ node, updateAttributes }) {
  const [copied, setCopied] = useState(false);
  const lang = node.attrs.language || "plaintext";

  const copy = () => {
    navigator.clipboard.writeText(node.textContent || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <NodeViewWrapper className="relative">
      <div contentEditable={false} className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
        <select
          value={lang}
          onChange={(e) => updateAttributes({ language: e.target.value })}
          className="rounded-md border border-border bg-bg-base px-1.5 py-0.5 text-[11px] text-text-muted focus:outline-none"
        >
          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={copy} className="rounded-md border border-border bg-bg-base px-2 py-0.5 text-[11px] text-text-muted hover:text-text-primary">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
