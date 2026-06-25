import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";

function ToggleView({ node, updateAttributes }) {
  const open = node.attrs.open;
  return (
    <NodeViewWrapper className="note-toggle" data-open={open ? "true" : "false"}>
      <div className="flex select-none items-center gap-1" contentEditable={false}>
        <button onClick={() => updateAttributes({ open: !open })}
          className="flex h-5 w-5 items-center justify-center text-text-muted hover:text-text-primary" title="Toggle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}>
            <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-sm font-medium text-text-muted">Toggle</span>
      </div>
      <NodeViewContent className="toggle-content" style={{ display: open ? "block" : "none" }} />
    </NodeViewWrapper>
  );
}

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return { open: { default: true } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "toggle", class: "note-toggle" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [{ type: "paragraph" }],
          }),
    };
  },
});
