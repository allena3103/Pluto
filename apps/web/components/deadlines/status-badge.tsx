import type { DeadlineStatus } from "@pluto/core/contract";

const STYLES: Record<DeadlineStatus, string> = {
  upcoming: "bg-slate-100 text-slate-700",
  submitted: "bg-amber-100 text-amber-800",
  graded: "bg-emerald-100 text-emerald-800",
  overdue: "bg-red-100 text-red-800",
};

const LABELS: Record<DeadlineStatus, string> = {
  upcoming: "Upcoming",
  submitted: "Submitted",
  graded: "Graded",
  overdue: "Overdue",
};

export function StatusBadge({ status }: { status: DeadlineStatus }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}