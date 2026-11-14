import { getDeadlines } from "@pluto/core/tools/get-deadlines";
import { DeadlinesView } from "@/components/deadlines/deadlines-view";
import { createSessionToolContext } from "@/components/grades/session-tool-context";

export default async function DeadlinesPage() {
  const { user, ctx } = await createSessionToolContext();
  if (!user || !ctx) {
    return null;
  }

  const data = await getDeadlines(ctx, { daysAhead: 30 });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Deadlines</h1>
        <p className="text-sm text-slate-600">Next 30 days, soonest first</p>
      </div>
      <DeadlinesView data={data} />
    </div>
  );
}