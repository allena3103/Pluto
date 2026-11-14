import { Skeleton } from "@/components/ui/skeleton";

export default function ChatLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="ml-auto h-10 w-1/2" />
      <Skeleton className="h-10 w-3/4" />
    </div>
  );
}
