import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * The dark card shown when the user types "/". Rendered inside a tippy popup
 * by the SlashCommand extension. Exposes onKeyDown for arrow/enter handling.
 */
const SlashMenuList = forwardRef(function SlashMenuList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => setSelected(0), [items]);

  const pick = (i) => {
    const item = items[i];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((s) => (s + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        pick(selected);
        return true;
      }
      return false;
    },
  }));

  // keep the selected row in view
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!items.length) {
    return (
      <div className="w-72 rounded-xl border border-border bg-bg-surface p-3 text-sm text-text-muted shadow-2xl">
        No blocks found
      </div>
    );
  }

  return (
    <div ref={containerRef} className="max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-bg-surface p-1.5 shadow-2xl">
      {items.map((item, i) => (
        <button
          key={item.title}
          data-idx={i}
          onMouseEnter={() => setSelected(i)}
          onClick={() => pick(i)}
          className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
            i === selected ? "bg-bg-elevated" : "hover:bg-bg-elevated/60"
          }`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-base font-mono text-xs text-accent">
            {item.badge}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text-primary">{item.title}</span>
            <span className="block truncate text-[11px] text-text-muted">{item.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

export default SlashMenuList;
