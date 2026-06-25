import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchSharedPanic } from "../lib/queries";
import { PanicPlanView } from "../components/PanicButton";

export default function SharedPanic() {
  const { token } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sharedPanic", token],
    queryFn: () => fetchSharedPanic(token),
    retry: false,
  });

  return (
    <div className="min-h-dvh bg-bg-base px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <svg viewBox="0 0 24 24" fill="none" stroke="#292929" strokeWidth={2} className="h-4 w-4"><path d="M12 6v6l4 2" strokeLinecap="round" /><circle cx="12" cy="12" r="9" /></svg>
          </div>
          <span className="font-display text-lg text-text-primary">Producty</span>
        </div>

        {isLoading && <p className="text-sm text-text-muted">Loading plan…</p>}
        {isError && <p className="text-sm text-accent-red">This plan link is invalid or expired.</p>}

        {data && (
          <div className="rounded-2xl border border-border bg-bg-surface p-6">
            {data.owner_name && (
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {data.owner_name}'s 48-hour survival plan
              </p>
            )}
            <PanicPlanView plan={data} />
          </div>
        )}

        <p className="mt-6 text-center text-xs text-text-muted">Made with Producty — turn panic into a plan.</p>
      </div>
    </div>
  );
}
