// Convert a Tiptap JSON document to Markdown / plain text (client-side export).

function applyMarks(text, marks) {
  if (!marks) return text;
  let out = text;
  for (const m of marks) {
    if (m.type === "bold") out = `**${out}**`;
    else if (m.type === "italic") out = `*${out}*`;
    else if (m.type === "strike") out = `~~${out}~~`;
    else if (m.type === "code") out = `\`${out}\``;
    else if (m.type === "link") out = `[${out}](${m.attrs?.href || ""})`;
  }
  return out;
}

function inline(nodes = []) {
  return nodes.map((n) => (n.type === "text" ? applyMarks(n.text || "", n.marks) : "")).join("");
}

function listItems(node, ordered, depth) {
  const pad = "  ".repeat(depth);
  return (node.content || [])
    .map((li, i) => {
      const marker = ordered ? `${i + 1}.` : "-";
      const inner = (li.content || []).map((c) => blockToMd(c, depth + 1)).join("\n");
      // indent continuation lines
      const firstLine = inner.split("\n")[0] || "";
      const rest = inner.split("\n").slice(1).join("\n");
      return `${pad}${marker} ${firstLine}${rest ? "\n" + rest : ""}`;
    })
    .join("\n");
}

function tableToMd(node) {
  const rows = node.content || [];
  const lines = [];
  rows.forEach((row, ri) => {
    const cells = (row.content || []).map((cell) => inline((cell.content?.[0]?.content) || []).trim() || " ");
    lines.push(`| ${cells.join(" | ")} |`);
    if (ri === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  });
  return lines.join("\n");
}

function blockToMd(node, depth = 0) {
  switch (node.type) {
    case "paragraph":
      return inline(node.content);
    case "heading":
      return `${"#".repeat(node.attrs?.level || 1)} ${inline(node.content)}`;
    case "bulletList":
      return listItems(node, false, depth);
    case "orderedList":
      return listItems(node, true, depth);
    case "taskList":
      return (node.content || [])
        .map((li) => `- [${li.attrs?.checked ? "x" : " "}] ${(li.content || []).map((c) => inline(c.content)).join(" ")}`)
        .join("\n");
    case "blockquote":
      return (node.content || []).map((c) => `> ${blockToMd(c, depth)}`).join("\n");
    case "codeBlock":
      return `\`\`\`${node.attrs?.language || ""}\n${inline(node.content)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "image":
      return `![](${node.attrs?.src || ""})`;
    case "table":
      return tableToMd(node);
    case "callout":
      return `> ${node.attrs?.emoji || "💡"} ${(node.content || []).map((c) => blockToMd(c, depth)).join(" ")}`;
    case "toggle":
      return (node.content || []).map((c) => blockToMd(c, depth)).join("\n");
    default:
      return node.content ? inline(node.content) : "";
  }
}

export function tiptapToMarkdown(doc) {
  if (!doc || !doc.content) return "";
  return doc.content.map((n) => blockToMd(n)).filter((s) => s !== undefined).join("\n\n");
}

export function tiptapToText(doc) {
  if (!doc || !doc.content) return "";
  const walk = (n) => {
    if (n.type === "text") return n.text || "";
    return (n.content || []).map(walk).join(n.type === "paragraph" || n.type === "heading" ? "" : "");
  };
  return doc.content.map((n) => walk(n)).join("\n\n");
}
