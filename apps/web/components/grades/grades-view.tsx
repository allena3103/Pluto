import type { ToolOutput } from "@pluto/core/contract";
import { GradeCourseCard } from "./grade-course-card";

export function GradesView({ data }: { data: ToolOutput<"get_grades"> }) {
  if (data.courses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-sm text-slate-600">No courses with grades to show.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data.courses.map((course) => (
        <GradeCourseCard key={course.courseId} course={course} />
      ))}
    </div>
  );
}