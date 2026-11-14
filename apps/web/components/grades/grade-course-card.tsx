import type { CourseGrades } from "@pluto/core/contract";
import { cn } from "@/lib/utils";

const CARD_TINTS = ["bg-peach", "bg-mint", "bg-sky-tint", "bg-butter", "bg-lilac"] as const;

function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function Meter({ percent, className }: { percent: number; className?: string }) {
  return (
    <div className={cn("h-2.5 w-full overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      <div className="h-full rounded-full bg-sunrise" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export function GradeCourseCard({ course, index = 0 }: { course: CourseGrades; index?: number }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-border/80 bg-card shadow-warm transition-transform hover:-translate-y-0.5">
      <div className={cn("px-5 pt-4 pb-3", CARD_TINTS[index % CARD_TINTS.length])}>
        <h2 className="text-base leading-tight font-extrabold break-words text-foreground">{course.courseName}</h2>
      </div>

      <div className="px-5 pt-4 pb-5">
        {course.weightedGradePercent !== null ? (
          <>
            <p className="text-sunrise text-4xl font-black tabular-nums">
              {formatPercent(course.weightedGradePercent)}%
            </p>
            <Meter percent={course.weightedGradePercent} className="mt-3" />
          </>
        ) : (
          <p className="text-lg font-bold text-muted-foreground">No graded work yet</p>
        )}
        <p className="mt-2 text-sm font-semibold text-muted-foreground">
          {course.ungradedCount === 0
            ? "All assignments graded"
            : `${course.ungradedCount} ungraded assignment${course.ungradedCount === 1 ? "" : "s"}`}
        </p>

        {course.groups.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {course.groups.map((group) => (
              <li key={group.name} className="rounded-2xl bg-muted/60 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-bold break-words text-foreground">{group.name}</span>
                  <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">
                    {group.weightPercent}% weight
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    Score:{" "}
                    <span className="font-extrabold text-foreground">
                      {group.scorePercent !== null ? `${formatPercent(group.scorePercent)}%` : "—"}
                    </span>
                  </span>
                  <span className="text-xs font-semibold">
                    {group.gradedCount} graded · {group.ungradedCount} ungraded
                  </span>
                </div>
                {group.scorePercent !== null ? <Meter percent={group.scorePercent} className="mt-2 h-1.5 bg-card" /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">No grade groups defined.</p>
        )}
      </div>
    </article>
  );
}
