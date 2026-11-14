import { Clock } from "lucide-react";
import type { Deadline } from "@pluto/core/contract";
import { formatDueDate, formatDueTime } from "./format";
import { StatusBadge } from "./status-badge";

export function DeadlineItem({ deadline }: { deadline: Deadline }) {
  const moved = deadline.previousDueAt !== null;

  return (
    <li className="rounded-3xl border border-border/80 bg-card p-4 shadow-warm transition-transform hover:-translate-y-0.5 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[0.97rem] leading-snug font-extrabold break-words text-foreground">{deadline.title}</p>
          <p className="mt-0.5 text-sm font-semibold break-words text-muted-foreground">{deadline.courseName}</p>
        </div>
        <StatusBadge status={deadline.status} />
      </div>

      <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt className="sr-only">Due</dt>
          <dd className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 font-bold text-accent-foreground">
            <Clock className="size-3.5" aria-hidden />
            {formatDueDate(deadline.dueAt)} · {formatDueTime(deadline.dueAt)}
          </dd>
          {moved ? (
            <>
              <dd className="text-muted-foreground/80 line-through">
                {formatDueDate(deadline.previousDueAt!)} · {formatDueTime(deadline.previousDueAt!)}
              </dd>
              <dd>
                <span className="rounded-full bg-butter px-2.5 py-1 text-xs font-extrabold text-amber-800">
                  Date moved
                </span>
              </dd>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-semibold">
          {deadline.points !== null ? (
            <dd>{deadline.points} pts</dd>
          ) : (
            <dd className="text-muted-foreground/80">No points listed</dd>
          )}
          {deadline.weightGroup ? <dd>· {deadline.weightGroup}</dd> : null}
        </div>
      </dl>
    </li>
  );
}
