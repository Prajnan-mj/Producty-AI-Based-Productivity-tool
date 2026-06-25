import { useEffect, useRef } from "react";

const EMOJIS = [
  "📄", "📝", "📌", "✅", "💡", "⭐", "🔥", "🚀", "🎯", "📚",
  "🧠", "💼", "📅", "⏰", "🏆", "🎓", "💰", "📈", "🛠️", "🧩",
  "❤️", "😀", "😎", "🤔", "🥳", "😴", "☕", "🍕", "🌙", "☀️",
  "🌟", "⚡", "🔑", "🔒", "📎", "✏️", "🖊️", "📋", "🗂️", "🗃️",
  "🎨", "🎵", "🏃", "🧘", "🌱", "🐱", "🐶", "🌈", "🍀", "✨",
];

export default function EmojiPicker({ onSelect, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-50 mt-1 w-64 rounded-xl border border-border bg-bg-surface p-2 shadow-2xl">
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => { onSelect(e); onClose(); }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-lg hover:bg-bg-elevated">{e}</button>
        ))}
      </div>
    </div>
  );
}
