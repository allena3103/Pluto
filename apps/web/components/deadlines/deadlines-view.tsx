import type { ToolOutput } from "@pluto/core/contract";
import { EmptyState } from "@/components/page-shell";
import { DeadlineItem } from "./deadline-item";
import { groupDeadlinesByDay } from "./format";

export function DeadlinesView({ data }: { data: ToolOutput<"get_deadlines"> }) {
  if (data.deadlines.length === 0) {
    return <EmptyState title="Nothing due in the next 30 days.">Enjoy the breather!</EmptyState>;
  }

  const groups = groupDeadlinesByDay(data.deadlines);

  return (
    <div className="flex flex-col gap-7">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-3 inline-flex items-center gap-2 rounded-full bg-card px-3.5 py-1.5 text-sm font-extrabold text-foreground shadow-warm-sm">
            <span className="size-2 rounded-full bg-sunrise" aria-hidden />
            {group.heading}
          </h2>
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
