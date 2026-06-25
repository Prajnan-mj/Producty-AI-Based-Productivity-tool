import { motion } from "framer-motion";

const COLORS = { green: "#FFB000", amber: "#B07A1E", red: "#FF4D4D", purple: "#5A6470", blue: "#4D7C8A" };

function getColor(pct) {
  if (pct >= 80) return COLORS.green;
  if (pct >= 50) return COLORS.amber;
  return COLORS.red;
}

export default function UrgencyRing({
  percentage = 0,
  size = 80,
  strokeWidth = 6,
  color,
  label,
  sublabel,
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const fill = color || getColor(percentage);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2A2F36" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={fill} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - (circ * Math.min(percentage, 100)) / 100 }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      {label && <span className="text-sm font-medium text-text-primary font-mono">{label}</span>}
      {sublabel && <span className="text-xs text-text-muted">{sublabel}</span>}
    </div>
  );
}
