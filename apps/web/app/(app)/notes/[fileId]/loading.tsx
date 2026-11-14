import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NoteFileLoading() {
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Card>
        <CardContent className="space-y-3 py-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-[60vh] w-full" />
        </CardContent>
      </Card>
    </section>
  );
}
