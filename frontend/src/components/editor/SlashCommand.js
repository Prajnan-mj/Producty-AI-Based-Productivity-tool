import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy from "tippy.js";
import SlashMenuList from "./SlashMenuList";

// All slash-menu blocks. Each `run` receives the editor chain already focused
// with the "/query" range deleted.
const COMMANDS = [
  { title: "Text", desc: "Plain paragraph", badge: "P", keywords: "paragraph text plain", run: (c) => c.setParagraph() },
  { title: "Heading 1", desc: "Big section heading", badge: "H1", keywords: "h1 title big", run: (c) => c.setNode("heading", { level: 1 }) },
  { title: "Heading 2", desc: "Medium heading", badge: "H2", keywords: "h2 subtitle", run: (c) => c.setNode("heading", { level: 2 }) },
  { title: "Heading 3", desc: "Small heading", badge: "H3", keywords: "h3", run: (c) => c.setNode("heading", { level: 3 }) },
  { title: "Bullet List", desc: "Unordered list", badge: "•", keywords: "bullet unordered ul list", run: (c) => c.toggleBulletList() },
  { title: "Numbered List", desc: "Ordered list", badge: "1.", keywords: "numbered ordered ol list", run: (c) => c.toggleOrderedList() },
  { title: "To-do List", desc: "Checkbox list", badge: "☑", keywords: "todo task checkbox check", run: (c) => c.toggleTaskList() },
  { title: "Code Block", desc: "Syntax-highlighted code", badge: "</>", keywords: "code snippet pre", run: (c) => c.toggleCodeBlock() },
  { title: "Quote", desc: "Blockquote", badge: "“", keywords: "quote blockquote", run: (c) => c.toggleBlockquote() },
  { title: "Divider", desc: "Horizontal rule", badge: "—", keywords: "divider hr rule line", run: (c) => c.setHorizontalRule() },
  { title: "Table", desc: "3 × 3 table", badge: "▦", keywords: "table grid", run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  {
    title: "Image", desc: "Embed by URL", badge: "▣", keywords: "image picture photo embed",
    run: (c) => {
      const url = window.prompt("Image URL");
      return url ? c.setImage({ src: url }) : c;
    },
  },
  { title: "Toggle", desc: "Collapsible block", badge: "▸", keywords: "toggle collapse fold details", run: (c) => c.setToggle() },
  { title: "Callout", desc: "Highlighted note with icon", badge: "★", keywords: "callout note tip warning", run: (c) => c.setCallout() },
];

function items({ query }) {
  const q = query.toLowerCase();
  if (!q) return COMMANDS;
  return COMMANDS.filter(
    (c) => c.title.toLowerCase().includes(q) || c.keywords.includes(q)
  );
}

function renderer() {
  let component;
  let popup;

  return {
    onStart: (props) => {
      component = new ReactRenderer(SlashMenuList, {
        props: {
          items: props.items,
          command: (item) => props.command(item),
        },
        editor: props.editor,
      });
      if (!props.clientRect) return;
      popup = tippy("body", {
        getReferenceClientRect: props.clientRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: "manual",
        placement: "bottom-start",
        maxWidth: "none",
      });
    },
    onUpdate(props) {
      component?.updateProps({
        items: props.items,
        command: (item) => props.command(item),
      });
      if (props.clientRect && popup?.[0]) {
        popup[0].setProps({ getReferenceClientRect: props.clientRect });
      }
    },
    onKeyDown(props) {
      if (props.event.key === "Escape") {
        popup?.[0]?.hide();
        return true;
      }
      return component?.ref?.onKeyDown(props) ?? false;
    },
    onExit() {
      popup?.[0]?.destroy();
      component?.destroy();
    },
  };
}

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        // run the chosen block command, removing the "/query" first
        command: ({ editor, range, props }) => {
          const chain = editor.chain().focus().deleteRange(range);
          props.run(chain).run();
        },
        items,
        render: renderer,
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
