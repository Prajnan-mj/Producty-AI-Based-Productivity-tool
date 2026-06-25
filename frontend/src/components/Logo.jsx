/**
 * Producty brand mark — a terracotta rounded tile with an ivory check that
 * flicks upward into an arrow, reading as "done + momentum".
 */
export function LogoMark({ size = 32, className = "" }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[9px] bg-accent ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#F4EFE6"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: size * 0.6, height: size * 0.6 }}
      >
        <path d="M4 13l4.5 4.5L20 5" />
        <path d="M14.5 7.5H20V13" />
      </svg>
    </span>
  );
}

export function Wordmark({ className = "" }) {
  return (
    <span className={`font-display tracking-wide ${className}`}>Producty</span>
  );
}

export default function Logo({ size = 32, textClass = "text-lg text-white" }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <Wordmark className={textClass} />
    </div>
  );
}
