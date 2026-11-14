import { SmsSim, type SimMessage } from "@/components/sms-sim/sms-sim";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_TEST_NUMBER = "+15555550100";

export default async function SmsSimPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  // The viewer's own client: RLS plus an explicit student filter.
  const [profile, messages] = await Promise.all([
    supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle(),
    supabase
      .from("sms_messages")
      .select("id,direction,body,created_at")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const rows: SimMessage[] = (messages.data ?? []).reverse().map((m) => ({
    id: m.id,
    direction: m.direction === "outbound" ? "outbound" : "inbound",
    body: m.body,
    createdAt: m.created_at,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">SMS simulator</h1>
        <p className="text-sm text-muted-foreground">
          Texts here run the same handler as the real Pluto number. Replies are stored, not sent.
        </p>
      </div>
      <SmsSim
        studentId={user.id}
        linkedPhone={profile.data?.phone ?? null}
        defaultNumber={profile.data?.phone ?? DEFAULT_TEST_NUMBER}
        messages={rows}
      />
    </div>
  );
}
