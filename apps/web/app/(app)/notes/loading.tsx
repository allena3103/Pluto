import { FileText } from "lucide-react";
import { LoadingNote, PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotesLoading() {
  return (
    <PageShell title="Notes" description="Your lecture notes, by course and week." icon={FileText} tint="sky">
      <LoadingNote text="Gathering your notes…" />
      <div className="space-y-6">
        {[0, 1].map((course) => (
          <div key={course} className="space-y-3 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-warm">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10" />
              <Skeleton className="h-5 w-44" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
