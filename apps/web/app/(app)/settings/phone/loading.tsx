import { Smartphone } from "lucide-react";
import { LoadingNote, PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function PhoneLoading() {
  return (
    <PageShell title="Phone" description="Text Pluto from your phone, same brain as the chat." icon={Smartphone} tint="peach">
      <LoadingNote text="Loading your phone settings…" />
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-3xl" />
        <Skeleton className="h-40 w-full rounded-3xl" />
      </div>
    </PageShell>
  );
}
