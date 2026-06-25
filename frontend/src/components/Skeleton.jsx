export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-lg bg-bg-elevated ${className}`} />;
}

export function CardSkeleton({ lines = 3 }) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-5 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
