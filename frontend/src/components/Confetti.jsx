import { motion } from "framer-motion";

const PASTELS = ["#7FA7F5", "#6FD0A8", "#F5C770", "#F08A8A", "#B69CF2"];

/**
 * Low-key confetti burst. Render conditionally; mounts → animates once → fades.
 * A handful of small pastel pieces drift outward and down.
 */
export default function Confetti({ count = 10 }) {
  const pieces = Array.from({ length: count }, (_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 90,
    y: -(20 + Math.random() * 40),
    rotate: Math.random() * 180,
    color: PASTELS[i % PASTELS.length],
    delay: Math.random() * 0.1,
  }));

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute h-1.5 w-1.5 rounded-[1px]"
          style={{ background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, rotate: p.rotate, scale: 0.5 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: p.delay }}
        />
      ))}
    </div>
  );
}
