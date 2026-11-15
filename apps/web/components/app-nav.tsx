"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Dialog } from "radix-ui";
import {
  Cable,
  CalendarClock,
  FileText,
  GraduationCap,
  Menu,
  MessageSquareText,
  Plug,
  Plus,
  Smartphone,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import { PlutoMascot } from "@/components/mascot/pluto-mascot";
import { SignOutButton } from "@/components/sign-out-button";
import { useStartNewChat } from "@/components/chat/new-chat";
import { cn } from "@/lib/utils";

type NavLink = { href: string; label: string; icon: LucideIcon; tint: string; sms?: boolean };

const PRIMARY_LINKS: readonly NavLink[] = [
  { href: "/notes", label: "Notes", icon: FileText, tint: "bg-sky-tint text-sky-700" },
  { href: "/grades", label: "Grades", icon: GraduationCap, tint: "bg-mint text-emerald-700" },
  { href: "/deadlines", label: "Deadlines", icon: CalendarClock, tint: "bg-butter text-amber-700" },
  { href: "/mcp", label: "Connect AI", icon: Cable, tint: "bg-lilac text-violet-700" },
];

const SETTINGS_LINKS: readonly NavLink[] = [
  { href: "/settings/canvas", label: "Canvas", icon: Plug, tint: "" },
  { href: "/settings/phone", label: "Phone", icon: Smartphone, tint: "", sms: true },
  { href: "/sms-sim", label: "SMS sim", icon: MessageSquareText, tint: "", sms: true },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandLogo({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <PlutoMascot mood="happy" size={size} animated={false} />
      <span className="text-xl font-black tracking-tight text-foreground">Pluto</span>
    </span>
  );
}

function NewChatButton({ onDone }: { onDone?: () => void }) {
  const startNewChat = useStartNewChat();
  return (
    <button
      type="button"
      onClick={() => {
        startNewChat();
        onDone?.();
      }}
      className="group flex h-11 w-full cursor-pointer items-center gap-2 rounded-full bg-sunrise px-4 text-sm font-extrabold text-white shadow-warm transition-all hover:-translate-y-px hover:shadow-warm-lg active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
    >
      <Plus className="size-4 transition-transform group-hover:rotate-90" aria-hidden />
      New chat
    </button>
  );
}

/** `judge`: the shared judge demo account, which has no SMS. */
function NavSections({ judge, onNavigate }: { judge: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const settingsLinks = judge ? SETTINGS_LINKS.filter((link) => !link.sms) : SETTINGS_LINKS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Primary" className="mt-6">
        <ul className="space-y-1">
          {PRIMARY_LINKS.map(({ href, label, icon: Icon, tint }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-full px-2 py-1.5 text-[0.95rem] font-bold transition-all focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none",
                    active
                      ? "bg-sunrise text-white shadow-warm"
                      : "text-foreground/80 hover:translate-x-0.5 hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full",
                      active ? "bg-white/25 text-white" : tint,
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label="Settings" className="mt-7">
        <p className="px-3 text-[0.7rem] font-extrabold tracking-[0.12em] text-muted-foreground/80 uppercase">
          Settings
        </p>
        <ul className="mt-2 space-y-0.5">
          {settingsLinks.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-full px-3 py-2 text-sm font-semibold transition-colors focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto pt-6">
        <SignOutButton />
      </div>
    </div>
  );
}

/** Desktop (md+) slim left sidebar. */
export function AppSidebar({ judge }: { judge: boolean }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-white/55 px-4 py-5 backdrop-blur-sm md:flex">
      <Link href="/" className="rounded-full px-2 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none">
        <BrandLogo />
      </Link>
      <div className="mt-6">
        <NewChatButton />
      </div>
      <NavSections judge={judge} />
    </aside>
  );
}

/** Mobile top bar with a slide-in drawer holding the same links. */
export function MobileTopBar({ judge }: { judge: boolean }) {
  const [open, setOpen] = useState(false);
  const startNewChat = useStartNewChat();

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-2 backdrop-blur-md md:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            aria-label="Open menu"
            className="flex size-11 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
          >
            <Menu className="size-5" aria-hidden />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[#3d2a22]/25 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(19rem,86vw)] flex-col rounded-r-[2rem] bg-background px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-warm-lg focus:outline-none data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in"
          >
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <div className="flex items-center justify-between">
              <Link href="/" onClick={() => setOpen(false)} className="rounded-full px-2">
                <BrandLogo />
              </Link>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <div className="mt-5">
              <NewChatButton onDone={() => setOpen(false)} />
            </div>
            <NavSections judge={judge} onNavigate={() => setOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Link href="/" aria-label="Pluto home" className="rounded-full px-2">
        <BrandLogo size={36} />
      </Link>

      <button
        type="button"
        aria-label="New chat"
        onClick={startNewChat}
        className="flex size-11 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
      >
        <SquarePen className="size-5" aria-hidden />
      </button>
    </header>
  );
}
