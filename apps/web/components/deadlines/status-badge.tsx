import type { DeadlineStatus } from "@pluto/core/contract";

const STYLES: Record<DeadlineStatus, string> = {
  upcoming: "bg-sky-tint text-sky-800",
  submitted: "bg-butter text-amber-800",
  graded: "bg-mint text-emerald-800",
  overdue: "bg-red-100 text-red-700",
};

const LABELS: Record<DeadlineStatus, string> = {
  upcoming: "Upcoming",
  submitted: "Submitted",
  graded: "Graded",
  overdue: "Overdue",
};

export function StatusBadge({ status }: { status: DeadlineStatus }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
