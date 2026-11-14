import { GraduationCap } from "lucide-react";
import { getGrades } from "@pluto/core/tools/get-grades";
import { GradesView } from "@/components/grades/grades-view";
import { createSessionToolContext } from "@/components/grades/session-tool-context";
import { PageShell } from "@/components/page-shell";

export default async function GradesPage() {
  const { user, ctx } = await createSessionToolContext();
  if (!user || !ctx) {
    return null;
  }

  const data = await getGrades(ctx, {});

  return (
    <PageShell title="Grades" description="How each class is going so far." icon={GraduationCap} tint="mint">
      <GradesView data={data} />
    </PageShell>
  );
}
