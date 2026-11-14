import { GraduationCap } from "lucide-react";
import { LoadingNote, PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function GradesLoading() {
  return (
    <PageShell title="Grades" description="How each class is going so far." icon={GraduationCap} tint="mint">
      <LoadingNote text="Crunching your grades…" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-3xl border border-border/80 bg-card p-5 shadow-warm">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
