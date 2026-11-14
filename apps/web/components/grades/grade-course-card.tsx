import type { CourseGrades } from "@pluto/core/contract";

function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function GradeCourseCard({ course }: { course: CourseGrades }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{course.courseName}</h2>

      <div className="mt-3">
        {course.weightedGradePercent !== null ? (
          <p className="text-3xl font-bold tabular-nums text-slate-900">
            {formatPercent(course.weightedGradePercent)}%
          </p>
        ) : (
          <p className="text-lg font-medium text-slate-500">No graded work yet</p>
        )}
        <p className="mt-1 text-sm text-slate-600">
          {course.ungradedCount === 0
            ? "All assignments graded"
            : `${course.ungradedCount} ungraded assignment${course.ungradedCount === 1 ? "" : "s"}`}
        </p>
      </div>

      {course.groups.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {course.groups.map((group) => (
            <li key={group.name} className="flex flex-col gap-1 py-3 first:pt-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{group.name}</span>
                <span className="shrink-0 text-sm tabular-nums text-slate-600">
                  {group.weightPercent}% weight
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                <span>
                  Score:{" "}
                  <span className="font-medium text-slate-800">
                    {group.scorePercent !== null ? `${formatPercent(group.scorePercent)}%` : "—"}
                  </span>
                </span>
                <span>
                  {group.gradedCount} graded · {group.ungradedCount} ungraded
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500">No grade groups defined.</p>
      )}
    </article>
  );
}