import { createClient } from "@/lib/supabase/server";
import { ChatView } from "@/components/chat/chat-view";

export default async function HomePage() {
  let name: string | null = null;

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).maybeSingle();
      name = profile?.name ?? user.email ?? null;
    }
  } catch {
    name = null;
  }

  return <ChatView name={name} />;
}
