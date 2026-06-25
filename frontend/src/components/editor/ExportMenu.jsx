import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { tiptapToMarkdown, tiptapToText } from "./serialize";

function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (t) => (t || "note").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "note";
const today = () => new Date().toISOString().slice(0, 10);

export default function ExportMenu({ editor, title, contentRef }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const doc = () => editor?.getJSON();

  const exportMarkdown = () => {
    const md = `# ${title || "Untitled"}\n\n${tiptapToMarkdown(doc())}`;
    download(`${slug(title)}-${today()}.md`, md, "text/markdown");
    setOpen(false);
  };
  const exportText = () => {
    const txt = `${title || "Untitled"}\n\n${tiptapToText(doc())}`;
    download(`${slug(title)}-${today()}.txt`, txt, "text/plain");
    setOpen(false);
  };
  const copyMarkdown = async () => {
    const md = `# ${title || "Untitled"}\n\n${tiptapToMarkdown(doc())}`;
    await navigator.clipboard.writeText(md);
    toast.success("Copied as Markdown");
    setOpen(false);
  };
  const exportPDF = async () => {
    setOpen(false);
    const el = contentRef?.current;
    if (!el) return;
    const t = toast.loading("Building PDF…");
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      // Capture the full content (not just viewport).
      const canvas = await html2canvas(el, {
        backgroundColor: "#292929",
        scale: 2,
        windowWidth: el.scrollWidth,
        height: el.scrollHeight,
        windowHeight: el.scrollHeight,
      });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let left = imgH;
      let pos = 0;
      pdf.addImage(img, "PNG", 0, pos, pageW, imgH);
      left -= pageH;
      while (left > 0) {
        pos -= pageH;
        pdf.addPage();
        pdf.addImage(img, "PNG", 0, pos, pageW, imgH);
        left -= pageH;
      }
      pdf.save(`${slug(title)}-${today()}.pdf`);
      toast.success("PDF exported", { id: t });
    } catch (e) {
      toast.error("PDF export failed", { id: t });
    }
  };

  const items = [
    ["Export as PDF", exportPDF],
    ["Export as Markdown", exportMarkdown],
    ["Export as Plain Text", exportText],
    ["Copy as Markdown", copyMarkdown],
  ];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-text-primary hover:brightness-110">
        Export
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-48 rounded-xl border border-border bg-bg-surface p-1 shadow-2xl">
          {items.map(([label, fn]) => (
            <button key={label} onClick={fn}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-elevated">{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
