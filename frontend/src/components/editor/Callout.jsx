import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";

const EMOJIS = ["💡", "⚠️", "✅", "❌", "📌"];

function CalloutView({ node, updateAttributes }) {
  const emoji = node.attrs.emoji || "💡";
  const cycle = () => {
    const i = EMOJIS.indexOf(emoji);
    updateAttributes({ emoji: EMOJIS[(i + 1) % EMOJIS.length] });
  };
  return (
    <NodeViewWrapper className="note-callout">
      <span className="callout-emoji" contentEditable={false} onClick={cycle} title="Click to change icon">{emoji}</span>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return { emoji: { default: "💡" } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "note-callout" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { emoji: attrs.emoji || "💡" },
            content: [{ type: "paragraph" }],
          }),
    };
  },
});
