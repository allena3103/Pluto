import { CalendarClock } from "lucide-react";
import { LoadingNote, PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function DeadlinesLoading() {
  return (
    <PageShell title="Deadlines" description="Next 30 days, soonest first" icon={CalendarClock} tint="butter">
      <LoadingNote text="Checking what's due…" />
      <div className="space-y-7">
        {[0, 1].map((section) => (
          <div key={section} className="space-y-3">
            <Skeleton className="h-8 w-44 rounded-full" />
            {[0, 1].map((row) => (
              <div key={row} className="space-y-2 rounded-3xl border border-border/80 bg-card p-5 shadow-warm">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-7 w-48 rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
