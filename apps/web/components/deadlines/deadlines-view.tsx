import type { ToolOutput } from "@pluto/core/contract";
import { DeadlineItem } from "./deadline-item";
import { groupDeadlinesByDay } from "./format";

export function DeadlinesView({ data }: { data: ToolOutput<"get_deadlines"> }) {
  if (data.deadlines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-sm text-slate-600">Nothing due in the next 30 days.</p>
      </div>
    );
  }

  const groups = groupDeadlinesByDay(data.deadlines);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{group.heading}</h2>
          <ul className="flex flex-col gap-3">
            {group.items.map((deadline) => (
              <DeadlineItem key={deadline.assignmentId} deadline={deadline} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}