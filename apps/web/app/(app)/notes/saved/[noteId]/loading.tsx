import { LoadingNote } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function SavedNoteLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-12 sm:px-6 md:px-8 md:pt-10">
      <LoadingNote text="Opening your saved note…" />
      <Skeleton className="mb-4 h-6 w-24 rounded-full" />
      <div className="mb-6 flex items-start gap-3">
        <Skeleton className="size-11 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="space-y-3 rounded-3xl border border-border/80 bg-card p-5 shadow-warm">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}
