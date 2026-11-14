"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, FileText, GraduationCap, CalendarClock, Settings, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

const PRIMARY_LINKS = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/grades", label: "Grades", icon: GraduationCap },
  { href: "/deadlines", label: "Deadlines", icon: CalendarClock },
] as const;

const SECONDARY_LINKS = [
  { href: "/settings/canvas", label: "Canvas", icon: Settings },
  { href: "/sms-sim", label: "SMS sim", icon: Smartphone },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "sticky bottom-0 z-10 w-full border-t border-border bg-background pb-[env(safe-area-inset-bottom)]",
        className,
      )}
      aria-label="Primary"
    >
      <ul className="flex items-stretch justify-between px-1">
        {PRIMARY_LINKS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-2 text-xs font-medium text-muted-foreground",
                  active && "text-primary",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <ul className="flex items-center justify-center gap-4 border-t border-border/60 px-2 py-1.5">
        {SECONDARY_LINKS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1 text-[11px] text-muted-foreground/80",
                  active && "text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
