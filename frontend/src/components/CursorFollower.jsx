import { useEffect, useRef } from "react";

const INTERACTIVE = "a, button, [role='button'], input, select, textarea, label, [data-cursor-grow]";

export default function CursorFollower() {
  const ref = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia?.("(pointer: fine)").matches) return;

    const el = ref.current;
    if (!el) return;

    let hovering = false;

    const show = (x, y) => {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      if (!hovering) {
        hovering = true;
        el.style.opacity = "1";
      }
    };

    const hide = () => {
      hovering = false;
      el.style.opacity = "0";
    };

    const onMove = (e) => {
      if (hovering) {
        show(e.clientX, e.clientY);
      }
    };

    const onOver = (e) => {
      if (e.target.closest?.(INTERACTIVE)) {
        show(e.clientX, e.clientY);
      }
    };

    const onOut = (e) => {
      if (e.target.closest?.(INTERACTIVE) && !e.relatedTarget?.closest?.(INTERACTIVE)) {
        hide();
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseover", onOver, { passive: true });
    document.addEventListener("mouseout", onOut, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);

  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}
