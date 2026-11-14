import { CalendarClock } from "lucide-react";
import { getDeadlines } from "@pluto/core/tools/get-deadlines";
import { DeadlinesView } from "@/components/deadlines/deadlines-view";
import { createSessionToolContext } from "@/components/grades/session-tool-context";
import { PageShell } from "@/components/page-shell";

export default async function DeadlinesPage() {
  const { user, ctx } = await createSessionToolContext();
  if (!user || !ctx) {
    return null;
  }

  const data = await getDeadlines(ctx, { daysAhead: 30 });

  return (
    <PageShell title="Deadlines" description="Next 30 days, soonest first" icon={CalendarClock} tint="butter">
      <DeadlinesView data={data} />
    </PageShell>
  );
}
