import Link from "next/link";
import { MessageSquare, FileText, GraduationCap, CalendarClock, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";

const HOME_CARDS = [
  { href: "/chat", label: "Chat", description: "Ask Pluto about your courses", icon: MessageSquare },
  { href: "/notes", label: "Notes", description: "Browse lecture notes by course", icon: FileText },
  { href: "/grades", label: "Grades", description: "See your running grade per course", icon: GraduationCap },
  { href: "/deadlines", label: "Deadlines", description: "What's due and when", icon: CalendarClock },
] as const;

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

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Welcome back</p>
        <h2 className="text-lg font-semibold text-foreground">{name ? name : "there"}</h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {HOME_CARDS.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="transition-colors hover:border-primary/40">
              <CardContent className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
