import type { Deadline } from "@pluto/core/contract";
import { formatDueDate, formatDueTime } from "./format";
import { StatusBadge } from "./status-badge";

export function DeadlineItem({ deadline }: { deadline: Deadline }) {
  const moved = deadline.previousDueAt !== null;

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{deadline.title}</p>
          <p className="mt-0.5 text-sm text-slate-600">{deadline.courseName}</p>
        </div>
        <StatusBadge status={deadline.status} />
      </div>

      <dl className="mt-3 space-y-1 text-sm text-slate-600">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <dt className="sr-only">Due</dt>
          <dd className="font-medium text-slate-800">
            {formatDueDate(deadline.dueAt)} · {formatDueTime(deadline.dueAt)}
          </dd>
          {moved ? (
            <>
              <dd className="text-slate-500 line-through">
                {formatDueDate(deadline.previousDueAt!)} · {formatDueTime(deadline.previousDueAt!)}
              </dd>
              <dd>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                  Date moved
                </span>
              </dd>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {deadline.points !== null ? (
            <dd>{deadline.points} pts</dd>
          ) : (
            <dd className="text-slate-500">No points listed</dd>
          )}
          {deadline.weightGroup ? <dd>{deadline.weightGroup}</dd> : null}
        </div>
      </dl>
    </li>
  );
}