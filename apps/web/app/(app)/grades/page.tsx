import { getGrades } from "@pluto/core/tools/get-grades";
import { GradesView } from "@/components/grades/grades-view";
import { createSessionToolContext } from "@/components/grades/session-tool-context";

export default async function GradesPage() {
  const { user, ctx } = await createSessionToolContext();
  if (!user || !ctx) {
    return null;
  }

  const data = await getGrades(ctx, {});

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">Grades</h1>
      <GradesView data={data} />
    </div>
  );
}