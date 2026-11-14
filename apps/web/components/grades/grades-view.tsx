import type { ToolOutput } from "@pluto/core/contract";
import { EmptyState } from "@/components/page-shell";
import { GradeCourseCard } from "./grade-course-card";

export function GradesView({ data }: { data: ToolOutput<"get_grades"> }) {
  if (data.courses.length === 0) {
    return (
      <EmptyState title="No courses with grades to show.">
        Once grades come in from Canvas, they&apos;ll show up here.
      </EmptyState>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {data.courses.map((course, index) => (
        <GradeCourseCard key={course.courseId} course={course} index={index} />
      ))}
    </div>
  );
}
